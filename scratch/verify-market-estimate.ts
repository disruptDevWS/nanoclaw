/**
 * Live verification of the market-value estimate path: real callClaude with
 * webSearch (server-side tool), real prompt (copied verbatim from
 * pipeline-generate.ts @ this commit), real upsert into market_value_estimates.
 * Test case: locksmith / Boise, Idaho — the vertical+region that produced the
 * absurd CPC×200 "$2,488 customer value" before the fix.
 */
import { createClient } from '@supabase/supabase-js';
import { callClaude, initAnthropicClient } from '../scripts/anthropic-client.js';
import * as fs from 'fs';

for (const line of fs.readFileSync('/home/forgegrowth/forge-os-pipeline/.env', 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
initAnthropicClient(process.env.ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY!);

const SCOUT_REVENUE_ESTIMATES: Record<string, { acv_low: number; acv_high: number; cr: number; label: string }> = {
  hvac: { acv_low: 800, acv_high: 5000, cr: 0.02, label: 'service job' },
  plumbing: { acv_low: 400, acv_high: 3000, cr: 0.02, label: 'service job' },
  restoration: { acv_low: 2000, acv_high: 8000, cr: 0.02, label: 'restoration job' },
  pest_control: { acv_low: 200, acv_high: 800, cr: 0.03, label: 'treatment' },
  cleaning: { acv_low: 150, acv_high: 500, cr: 0.03, label: 'booking' },
  medical_training: { acv_low: 1200, acv_high: 2000, cr: 0.015, label: 'enrollment' },
};

async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const verticalKey = 'locksmith';
  const regionKey = 'boise_idaho';
  const regionLabel = 'Boise, Idaho';
  const serviceDescription = 'locksmith (services: locksmith, car locksmith, mobile locksmith, lock installation, key fob replacement)';

  const anchors = Object.entries(SCOUT_REVENUE_ESTIMATES)
    .map(([k, v]) => `- ${k}: $${v.acv_low}-$${v.acv_high} per ${v.label}, ~${(v.cr * 100).toFixed(1)}% conversion`)
    .join('\n');

  const prompt = `You are estimating the typical revenue per job/customer for a local service business, for use in a conservative revenue-opportunity model shown to the business owner. Use web search to find published cost/pricing data (industry cost guides such as HomeAdvisor/Angi true-cost pages, trade publications, pricing surveys) for this service in or near this region.

Service: ${serviceDescription}
Region: ${regionLabel}

Calibration anchors from other local-service verticals (national averages):
${anchors}

Rules:
- Be conservative: use the typical/median job, not premium or emergency-only pricing. The owner knows their own numbers; an inflated value discredits the whole report.
- If region-specific data is unavailable, use national data and say so in "basis".
- "cr" is the fraction of website visitors who become customers; stay within 0.01-0.03 unless you find strong published evidence otherwise.
- "basis" is one plain-language sentence a business owner would read under a revenue table, e.g. "Based on published cost-guide rates for locksmith services in the Boise, Idaho area."

Respond with ONLY a JSON object:
{"acv_low": <number>, "acv_mid": <number>, "acv_high": <number>, "cr": <number>, "value_label": "<short unit, e.g. service call>", "basis": "<one sentence>", "confidence": "high|medium|low", "sources": [{"url": "...", "title": "..."}]}`;

  console.log('Calling Claude with web search...');
  const t0 = Date.now();
  const raw = await callClaude(prompt, { model: 'sonnet', phase: 'market_value_estimate', webSearch: { maxUses: 4 } });
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s\n--- raw ---\n${raw}\n-----------`);

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON in response');
  const est = JSON.parse(match[0]);
  const mid = Number(est.acv_mid);
  if (!Number.isFinite(mid) || mid <= 0) throw new Error(`invalid acv_mid: ${est.acv_mid}`);
  const cr = Math.min(Math.max(Number(est.cr) || 0.02, 0.005), 0.05);

  const row = {
    vertical_key: verticalKey,
    region_key: regionKey,
    acv_low: Number.isFinite(Number(est.acv_low)) && est.acv_low > 0 && est.acv_low <= mid ? Number(est.acv_low) : null,
    acv_mid: mid,
    acv_high: Number.isFinite(Number(est.acv_high)) && est.acv_high >= mid ? Number(est.acv_high) : null,
    cr,
    value_label: String(est.value_label || 'job').trim(),
    basis: String(est.basis || '').slice(0, 500) || null,
    sources: Array.isArray(est.sources) ? est.sources.slice(0, 5) : null,
    confidence: typeof est.confidence === 'string' ? est.confidence : null,
    estimated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('market_value_estimates').upsert(row, { onConflict: 'vertical_key,region_key' });
  if (error) throw error;
  console.log(`\nUpserted: ACV=$${mid} (${row.acv_low}-${row.acv_high}) per ${row.value_label}, cr=${cr}`);
  console.log(`Basis: ${row.basis}`);
  console.log(`Sources: ${(row.sources ?? []).map((s: any) => s.url).join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
