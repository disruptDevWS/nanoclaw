/**
 * Read-only verification of the Scout top-opportunity hygiene pass against
 * treasurevalleylocksmith.com's REAL (pre-fix) top_opportunities data.
 * Logic below is copied verbatim from scripts/pipeline-generate.ts (commit 02ff70d).
 * No DB writes, no prospect mutation.
 */
import { createClient } from '@supabase/supabase-js';
import { callClaude } from '/home/forgegrowth/forge-os-pipeline/scripts/anthropic-client.js';
import * as fs from 'fs';

// Minimal .env loader (avoid importing pipeline-generate's CLI module)
for (const line of fs.readFileSync('/home/forgegrowth/forge-os-pipeline/.env', 'utf-8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

// ── Copied from pipeline-generate.ts ──
const US_STATE_NAMES = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','District of Columbia','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'];
const STATE_ABBREVS = ['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
const ALL_STATE_TOKENS = new Set([
  ...US_STATE_NAMES.map((s) => s.toLowerCase()),
  ...STATE_ABBREVS.map((s) => s.toLowerCase()),
]);

function buildOpportunityKey(kw: string): string {
  const tokens = kw
    .toLowerCase()
    .trim()
    .split(/[\s-]+/)
    .filter((t) => !ALL_STATE_TOKENS.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
  return tokens.sort().join(' ') || kw.toLowerCase().trim();
}

function collapseOpportunityVariants<T extends { keyword: string; volume: number }>(
  entries: T[],
): Array<T & { variant_count: number }> {
  const map = new Map<string, T & { variant_count: number }>();
  for (const e of entries) {
    const key = buildOpportunityKey(e.keyword);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...e, variant_count: 1 });
    } else {
      existing.variant_count++;
    }
  }
  return [...map.values()];
}

async function screenOpportunityKeywords<T extends { keyword: string }>(
  candidates: T[],
  businessName: string,
  domain: string,
  topicPatterns: string[],
  targetGeos: Array<{ state: string; metros: string[] }>,
): Promise<T[]> {
  if (candidates.length === 0) return candidates;
  const geoDesc =
    targetGeos
      .map((g) => (g.metros.length > 0 ? `${g.state} (${g.metros.join(', ')})` : g.state))
      .join('; ') || 'national (no geo restriction)';
  const numbered = candidates.map((c, i) => `${i}: ${c.keyword}`).join('\n');

  const prompt = `You are screening keyword opportunities before they appear in a report sent to a business owner. Flag any keyword that would make the report look like automated junk.

Business: ${businessName} (${domain})
Services: ${topicPatterns.join(', ')}
Target markets: ${geoDesc}

Keywords:
${numbered}

Flag a keyword ONLY if:
(a) it references a city, region, or place clearly OUTSIDE the target markets (e.g., a California city for an Idaho business). Treat named multi-city regions (e.g., "Tri-Valley", "Inland Empire", "Silicon Valley") as outside the target markets unless one clearly matches; or
(b) it contains the name of a specific OTHER business or brand (not a generic service term), or
(c) it is not a plausible customer search for the services listed.

Do NOT flag keywords merely for being generic, low volume, or missing a geo qualifier.

Respond with ONLY a JSON array of the flagged entries, e.g. [{"index": 3, "reason": "references Mill Valley, California"}]. If nothing should be flagged, respond with [].`;

  const raw = await callClaude(prompt, { model: 'sonnet', phase: 'scout_opportunity_screen' });
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return candidates;
  const flagged = JSON.parse(match[0]);
  if (!Array.isArray(flagged)) return candidates;
  const dropIdx = new Set(
    flagged
      .map((f: any) => (typeof f === 'number' ? f : f?.index))
      .filter((n: any) => Number.isInteger(n) && n >= 0 && n < candidates.length),
  );
  if (dropIdx.size === 0 || dropIdx.size >= candidates.length) return candidates;
  console.log('\nLLM screen dropped:');
  for (const [i, c] of candidates.entries()) {
    if (dropIdx.has(i)) {
      const reason = flagged.find((f: any) => f?.index === i)?.reason ?? '';
      console.log(`  ✗ "${c.keyword}"  (${reason})`);
    }
  }
  return candidates.filter((_, i) => !dropIdx.has(i));
}

// ── Run against real TVL data (read-only) ──
async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: p, error } = await sb
    .from('prospects')
    .select('name, domain, target_geos, scout_scope_json')
    .eq('domain', 'treasurevalleylocksmith.com')
    .single();
  if (error) throw error;

  const opps: Array<{ keyword: string; topic: string; volume: number; cpc: number }> =
    p.scout_scope_json.gap_summary.top_opportunities;
  console.log(`BEFORE (${opps.length} rows):`);
  for (const o of opps) console.log(`  ${o.keyword}  (vol ${o.volume})`);

  const collapsed = collapseOpportunityVariants([...opps].sort((a, b) => b.volume - a.volume));
  console.log(`\nAfter variant collapse (${collapsed.length} rows):`);
  for (const o of collapsed) console.log(`  ${o.keyword}  (vol ${o.volume}${o.variant_count > 1 ? `, +${o.variant_count - 1} variants` : ''})`);

  // Geo filter: TVL targets Idaho
  const targetGeos = [{ state: 'Idaho', metros: ['Meridian', 'Boise', 'Eagle', 'Nampa', 'Caldwell', 'Star'] }];
  const targetStateNames = new Set(['idaho']);
  const nonTargetStates = US_STATE_NAMES.map((s) => s.toLowerCase()).filter((s) => !targetStateNames.has(s));
  const geoFiltered = collapsed.filter((g) => {
    const padded = ` ${g.keyword.toLowerCase()} `;
    return !nonTargetStates.some((s) => padded.includes(` ${s} `));
  });
  console.log(`\nAfter geo filter (${geoFiltered.length} rows)${geoFiltered.length < collapsed.length ? ' — dropped: ' + collapsed.filter((g) => !geoFiltered.includes(g)).map((g) => g.keyword).join(', ') : ''}`);

  const screened = await screenOpportunityKeywords(geoFiltered, p.name, p.domain, ['locksmith', 'car locksmith', 'mobile locksmith', 'lock installation', 'key fob replacement'], targetGeos);
  console.log(`\nFINAL (${screened.length} rows):`);
  for (const o of screened) console.log(`  ✓ ${o.keyword}  (vol ${o.volume})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
