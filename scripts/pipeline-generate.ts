#!/usr/bin/env npx tsx
/**
 * pipeline-generate.ts — Generate agent artifacts for the post-audit pipeline.
 *
 * Subcommands:
 *   jim      — Compute aggregations from Supabase audit_keywords + claude --print narrative → audit_snapshots
 *   michael  — Generate architecture_blueprint.md via claude --print → write to disk (sync-to-dashboard syncs)
 *   dwight   — Insert scheduled_task into NanoClaw SQLite → Docker container runs Screaming Frog
 *
 * Usage:
 *   npx tsx scripts/pipeline-generate.ts jim --domain <domain> --user-email <email>
 *   npx tsx scripts/pipeline-generate.ts michael --domain <domain> --user-email <email>
 *   npx tsx scripts/pipeline-generate.ts dwight --domain <domain>
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as child_process from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const require = createRequire(import.meta.url);

// ============================================================
// .env loader (same pattern as sync-to-dashboard)
// ============================================================

function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf-8');
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

// ============================================================
// CLI parsing
// ============================================================

interface CliArgs {
  subcommand: 'jim' | 'michael' | 'dwight';
  domain: string;
  userEmail?: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const subcommand = args[0] as CliArgs['subcommand'];
  if (!['jim', 'michael', 'dwight'].includes(subcommand)) {
    console.error('Usage: npx tsx scripts/pipeline-generate.ts <jim|michael|dwight> --domain <domain> [--user-email <email>]');
    process.exit(1);
  }

  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      }
    }
  }

  if (!flags.domain) {
    console.error('--domain is required');
    process.exit(1);
  }

  return { subcommand, domain: flags.domain, userEmail: flags['user-email'] };
}

// ============================================================
// Helpers
// ============================================================

const AUDITS_BASE = path.resolve(process.cwd(), 'audits');

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function callClaude(prompt: string, model = 'sonnet', timeoutMs = 600_000): string {
  const claudeBin = process.env.CLAUDE_BIN || '/home/forgegrowth/.local/share/fnm/node-versions/v22.22.0/installation/bin/claude';
  const childEnv = { ...process.env };
  delete childEnv.CLAUDECODE;
  return child_process.execSync(
    `${claudeBin} --print --max-turns 1 --model ${model}`,
    { input: prompt, encoding: 'utf-8', timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, env: childEnv },
  );
}

function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  return fenced ? fenced[1].trim() : text.trim();
}

async function resolveAudit(sb: SupabaseClient, domain: string, userEmail: string) {
  const { data: userData } = await sb.auth.admin.listUsers();
  const user = userData?.users?.find((u: any) => u.email === userEmail);
  if (!user) throw new Error(`User not found: ${userEmail}`);

  const { data: audit } = await sb
    .from('audits')
    .select('*')
    .eq('domain', domain)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!audit) throw new Error(`No audit found for ${domain} / ${userEmail}`);
  return { audit, userId: user.id };
}

// ============================================================
// Phase 1: Jim Enrichment
// ============================================================

async function runJim(sb: SupabaseClient, auditId: string, domain: string) {
  console.log('  Querying audit_keywords from Supabase...');

  const { data: allKw, error: kwErr } = await sb
    .from('audit_keywords')
    .select('keyword, rank_pos, search_volume, cpc, ranking_url, intent, intent_type, is_near_miss, is_top_10, is_striking_distance, is_brand, current_traffic, cluster')
    .eq('audit_id', auditId);

  if (kwErr) throw new Error(`Failed to query keywords: ${kwErr.message}`);
  const keywords = (allKw ?? []) as any[];
  if (keywords.length === 0) {
    console.log('  No keywords found — skipping Jim enrichment');
    return;
  }
  console.log(`  ${keywords.length} keywords loaded`);

  // --- Keyword Overview ---
  const totalKeywords = keywords.length;
  const totalVolume = keywords.reduce((s, k) => s + (k.search_volume ?? 0), 0);
  const rankedKw = keywords.filter((k) => k.rank_pos > 0);
  const avgPosition = rankedKw.length > 0
    ? Math.round((rankedKw.reduce((s, k) => s + k.rank_pos, 0) / rankedKw.length) * 10) / 10
    : 0;
  const etv = keywords.reduce((s, k) => s + (k.current_traffic ?? 0), 0);
  const top10Count = keywords.filter((k) => k.rank_pos >= 1 && k.rank_pos <= 10).length;
  const nearMissCount = keywords.filter((k) => k.is_near_miss).length;

  // Top 10 non-branded
  const top10NonBranded = keywords
    .filter((k) => k.rank_pos >= 1 && k.rank_pos <= 10 && !k.is_brand)
    .sort((a, b) => (b.search_volume ?? 0) - (a.search_volume ?? 0))
    .slice(0, 10)
    .map((k) => ({ keyword: k.keyword, position: k.rank_pos, volume: k.search_volume }));

  const keywordOverview = {
    total_keywords: totalKeywords,
    total_volume: totalVolume,
    avg_position: avgPosition,
    etv: Math.round(etv * 100) / 100,
    top_10_count: top10Count,
    near_miss_count: nearMissCount,
    top_10_non_branded: top10NonBranded,
  };

  // --- Position Distribution ---
  const buckets = [
    { range: '1-3', min: 1, max: 3 },
    { range: '4-10', min: 4, max: 10 },
    { range: '11-20', min: 11, max: 20 },
    { range: '21-50', min: 21, max: 50 },
    { range: '51-100', min: 51, max: 100 },
  ];
  const positionDistribution = buckets.map((b) => {
    const count = rankedKw.filter((k) => k.rank_pos >= b.min && k.rank_pos <= b.max).length;
    return { range: b.range, count, pct: rankedKw.length > 0 ? Math.round((count / rankedKw.length) * 1000) / 10 : 0 };
  });

  // --- Branded Split ---
  const domainRoot = domain.replace(/\.(com|net|org|io|co|biz)$/i, '').replace(/[^a-z]/gi, ' ').trim().toLowerCase();
  const rootWords = domainRoot.split(/\s+/).filter((w) => w.length > 2);
  const isBranded = (kw: string) => {
    const lower = kw.toLowerCase();
    return rootWords.some((w) => lower.includes(w));
  };

  const branded = keywords.filter((k) => k.is_brand || isBranded(k.keyword));
  const nonBranded = keywords.filter((k) => !k.is_brand && !isBranded(k.keyword));
  const brandedSplit = {
    branded: {
      count: branded.length,
      volume: branded.reduce((s, k) => s + (k.search_volume ?? 0), 0),
      avg_position: branded.length > 0
        ? Math.round((branded.reduce((s, k) => s + (k.rank_pos ?? 0), 0) / branded.length) * 10) / 10
        : 0,
    },
    non_branded: {
      count: nonBranded.length,
      volume: nonBranded.reduce((s, k) => s + (k.search_volume ?? 0), 0),
      avg_position: nonBranded.length > 0
        ? Math.round((nonBranded.reduce((s, k) => s + (k.rank_pos ?? 0), 0) / nonBranded.length) * 10) / 10
        : 0,
    },
  };

  // --- Intent Breakdown ---
  const intentMap = new Map<string, { count: number; volume: number }>();
  for (const k of keywords) {
    const intent = (k.intent_type ?? k.intent ?? 'unknown').toLowerCase();
    const existing = intentMap.get(intent) ?? { count: 0, volume: 0 };
    existing.count++;
    existing.volume += k.search_volume ?? 0;
    intentMap.set(intent, existing);
  }
  const intentBreakdown = Array.from(intentMap.entries())
    .map(([intent, data]) => ({
      intent: intent.charAt(0).toUpperCase() + intent.slice(1),
      count: data.count,
      volume: data.volume,
      pct_volume: totalVolume > 0 ? Math.round((data.volume / totalVolume) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.volume - a.volume);

  // --- Top Ranking URLs ---
  const urlMap = new Map<string, { keywords: number; volume: number }>();
  for (const k of keywords) {
    if (!k.ranking_url) continue;
    const existing = urlMap.get(k.ranking_url) ?? { keywords: 0, volume: 0 };
    existing.keywords++;
    existing.volume += k.search_volume ?? 0;
    urlMap.set(k.ranking_url, existing);
  }
  const topRankingUrls = Array.from(urlMap.entries())
    .map(([url, data]) => ({ url, keywords: data.keywords, volume: data.volume }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 20);

  // --- Striking Distance ---
  const strikingDistance = keywords
    .filter((k) => k.rank_pos >= 11 && k.rank_pos <= 20)
    .sort((a, b) => (b.search_volume ?? 0) - (a.search_volume ?? 0))
    .slice(0, 25)
    .map((k) => ({
      keyword: k.keyword,
      volume: k.search_volume ?? 0,
      position: k.rank_pos,
      cpc: k.cpc ?? null,
      intent: k.intent ?? 'unknown',
    }));

  // --- Competitor Analysis ---
  const { data: compData } = await sb
    .from('audit_topic_competitors')
    .select('competitor_domain, appearances, total_keywords, avg_position, avg_etv')
    .eq('audit_id', auditId)
    .order('appearances', { ascending: false })
    .limit(15);

  const competitorAnalysis = (compData ?? []).map((c: any, i: number) => ({
    rank: i + 1,
    domain: c.competitor_domain,
    overlap_pct: totalKeywords > 0 ? Math.round((c.appearances / totalKeywords) * 1000) / 10 : 0,
    shared_keywords: c.appearances,
    total_keywords: c.total_keywords ?? 0,
    avg_position: c.avg_position ?? 0,
    etv: c.avg_etv ?? 0,
  }));

  const competitorSummary = {
    client_keywords: totalKeywords,
    client_avg_position: avgPosition,
    client_etv: Math.round(etv),
    competitor_avg_keywords: competitorAnalysis.length > 0
      ? Math.round(competitorAnalysis.reduce((s, c) => s + c.total_keywords, 0) / competitorAnalysis.length)
      : 0,
    competitor_avg_position: competitorAnalysis.length > 0
      ? Math.round((competitorAnalysis.reduce((s, c) => s + c.avg_position, 0) / competitorAnalysis.length) * 10) / 10
      : 0,
    competitor_avg_etv: competitorAnalysis.length > 0
      ? Math.round(competitorAnalysis.reduce((s, c) => s + c.etv, 0) / competitorAnalysis.length)
      : 0,
  };

  // --- Claude narrative (content gaps + takeaways) ---
  console.log('  Generating narrative via claude --print...');
  const narrativePrompt = `You are Jim, The Scout — a search intelligence analyst. Given this SEO data summary for ${domain}, produce JSON with two arrays:

1. "content_gap_observations": 5-8 strategic observations about content gaps and opportunities. Each is a single sentence.
2. "key_takeaways": 4-6 section takeaways, each an object with "section" (short label) and "takeaway" (1-2 sentences).

## Data Summary
- ${totalKeywords} total keywords, ${totalVolume} total monthly volume
- Average position: ${avgPosition}
- Top 10 keywords: ${top10Count} (${nearMissCount} near-miss at positions 11-20)
- Branded: ${branded.length} keywords, Non-branded: ${nonBranded.length}
- Intent: ${intentBreakdown.map((i) => `${i.intent}: ${i.count}`).join(', ')}
- Top URLs by volume: ${topRankingUrls.slice(0, 5).map((u) => `${u.url} (${u.keywords} kw, ${u.volume} vol)`).join('; ')}
- Striking distance (pos 11-20): ${strikingDistance.slice(0, 10).map((s) => `"${s.keyword}" vol=${s.volume} pos=${s.position}`).join('; ')}
- Top competitors: ${competitorAnalysis.slice(0, 5).map((c) => `${c.domain} (${c.shared_keywords} shared)`).join('; ')}

CRITICAL: Respond with raw JSON only. Do NOT wrap in markdown code fences. No \`\`\`json blocks. Just the bare JSON object starting with {.`;

  let contentGapObservations: string[] = [];
  let keyTakeaways: Array<{ section: string; takeaway: string }> = [];
  try {
    const narrativeResult = callClaude(narrativePrompt, 'haiku');
    const parsed = JSON.parse(stripCodeFences(narrativeResult));
    contentGapObservations = parsed.content_gap_observations ?? [];
    keyTakeaways = parsed.key_takeaways ?? [];
    console.log(`  Narrative: ${contentGapObservations.length} observations, ${keyTakeaways.length} takeaways`);
  } catch (err: any) {
    console.warn(`  Warning: narrative generation failed (${err.message}) — continuing without`);
  }

  // --- Build research_summary.md for disk reference ---
  const summaryMd = buildResearchSummaryMd(domain, keywordOverview, positionDistribution, brandedSplit, intentBreakdown, topRankingUrls, competitorAnalysis, competitorSummary, strikingDistance, contentGapObservations, keyTakeaways);
  const summaryDir = path.join(AUDITS_BASE, domain, 'research', todayStr());
  fs.mkdirSync(summaryDir, { recursive: true });
  fs.writeFileSync(path.join(summaryDir, 'research_summary.md'), summaryMd, 'utf-8');
  console.log(`  Written research_summary.md to ${path.relative(process.cwd(), summaryDir)}/`);

  // --- Insert audit_snapshots ---
  const { data: existingSnapshot } = await sb
    .from('audit_snapshots')
    .select('snapshot_version')
    .eq('audit_id', auditId)
    .eq('agent_name', 'jim')
    .order('snapshot_version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const snapshotVersion = ((existingSnapshot as any)?.snapshot_version ?? 0) + 1;

  const { data: run } = await sb.from('agent_runs').insert({
    audit_id: auditId,
    agent_name: 'jim',
    run_date: todayStr(),
    status: 'completed',
    snapshot_version: snapshotVersion,
    metadata: { keyword_count: totalKeywords, near_miss_count: nearMissCount, source: 'pipeline-generate' },
  }).select('id').single();

  const agentRunId = run?.id ?? null;

  await sb.from('audit_snapshots').insert({
    audit_id: auditId,
    agent_name: 'jim',
    snapshot_version: snapshotVersion,
    agent_run_id: agentRunId,
    row_count: totalKeywords,
    research_summary_markdown: summaryMd,
    keyword_overview: keywordOverview,
    position_distribution: positionDistribution,
    branded_split: brandedSplit,
    intent_breakdown: intentBreakdown,
    top_ranking_urls: topRankingUrls,
    competitor_analysis: competitorAnalysis,
    competitor_summary: competitorSummary,
    striking_distance: strikingDistance,
    content_gap_observations: contentGapObservations,
    key_takeaways: keyTakeaways,
  });

  await sb.from('audits').update({ research_snapshot_at: new Date().toISOString() }).eq('id', auditId);

  console.log(`  Jim enrichment complete — snapshot v${snapshotVersion}, run ${agentRunId}`);
}

function buildResearchSummaryMd(
  domain: string,
  overview: any,
  posDist: any[],
  branded: any,
  intent: any[],
  topUrls: any[],
  competitors: any[],
  compSummary: any,
  striking: any[],
  gaps: string[],
  takeaways: Array<{ section: string; takeaway: string }>,
): string {
  const lines: string[] = [];
  lines.push(`# Research Summary — ${domain}`);
  lines.push(`\n**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Source:** pipeline-generate.ts (aggregated from Supabase audit_keywords)\n`);

  lines.push('## 1. Keyword Overview\n');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total ranked keywords | ${overview.total_keywords} |`);
  lines.push(`| Total search volume | ${overview.total_volume}/mo |`);
  lines.push(`| Average position | ${overview.avg_position} |`);
  lines.push(`| Estimated traffic value | ${Math.round(overview.etv)}/mo |`);
  lines.push(`| Top 10 keywords | ${overview.top_10_count} |`);
  lines.push(`| Near-miss (11-20) | ${overview.near_miss_count} |`);

  lines.push('\n### Position Distribution\n');
  lines.push('| Range | Count | % |');
  lines.push('|-------|-------|---|');
  for (const p of posDist) {
    lines.push(`| ${p.range} | ${p.count} | ${p.pct}% |`);
  }

  lines.push('\n### Branded vs Non-Branded\n');
  lines.push('| Segment | Count | Volume | Avg Position |');
  lines.push('|---------|-------|--------|-------------|');
  lines.push(`| Branded | ${branded.branded.count} | ${branded.branded.volume}/mo | ${branded.branded.avg_position} |`);
  lines.push(`| Non-branded | ${branded.non_branded.count} | ${branded.non_branded.volume}/mo | ${branded.non_branded.avg_position} |`);

  lines.push('\n## 3. Intent Breakdown\n');
  lines.push('| Intent | Count | Volume | % Volume |');
  lines.push('|--------|-------|--------|----------|');
  for (const i of intent) {
    lines.push(`| ${i.intent} | ${i.count} | ${i.volume} | ${i.pct_volume}% |`);
  }

  lines.push('\n## 4. Top Ranking URLs\n');
  lines.push('| URL | Keywords | Volume |');
  lines.push('|-----|----------|--------|');
  for (const u of topUrls) {
    lines.push(`| ${u.url} | ${u.keywords} | ${u.volume} |`);
  }

  lines.push('\n## 5. Competitor Analysis\n');
  lines.push('### Direct Local Competitors\n');
  lines.push('| Rank | Domain | Overlap % | Shared | Total Keywords | Avg Pos | ETV |');
  lines.push('|------|--------|-----------|--------|---------------|---------|-----|');
  for (const c of competitors) {
    lines.push(`| ${c.rank} | ${c.domain} | ${c.overlap_pct}% | ${c.shared_keywords} | ${c.total_keywords} | ${c.avg_position} | $${c.etv} |`);
  }

  lines.push(`\n### ${domain} Position\n`);
  lines.push('| Metric | Client | Competitor Avg |');
  lines.push('|--------|--------|---------------|');
  lines.push(`| Keywords | ${compSummary.client_keywords} | ${compSummary.competitor_avg_keywords} |`);
  lines.push(`| Avg Position | ${compSummary.client_avg_position} | ${compSummary.competitor_avg_position} |`);
  lines.push(`| ETV | $${compSummary.client_etv} | $${compSummary.competitor_avg_etv} |`);

  lines.push('\n## 6. Striking Distance Keywords\n');
  lines.push('| Keyword | Volume | Position | CPC | Intent |');
  lines.push('|---------|--------|----------|-----|--------|');
  for (const s of striking) {
    lines.push(`| ${s.keyword} | ${s.volume} | ${s.position} | ${s.cpc != null ? `$${s.cpc}` : 'N/A'} | ${s.intent} |`);
  }

  if (gaps.length > 0) {
    lines.push('\n## 8. Content Gap Observations\n');
    gaps.forEach((g, i) => lines.push(`${i + 1}. **${g}**`));
  }

  if (takeaways.length > 0) {
    lines.push('\n## Key Takeaways\n');
    for (const t of takeaways) {
      lines.push(`**${t.section}:** ${t.takeaway}\n`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// Phase 2: Michael Architecture
// ============================================================

async function runMichael(sb: SupabaseClient, auditId: string, domain: string) {
  console.log('  Gathering context from Supabase...');

  // Audit metadata
  const { data: audit } = await sb
    .from('audits')
    .select('domain, service_key, market_city, market_state')
    .eq('id', auditId)
    .single();
  if (!audit) throw new Error('Audit metadata not found');

  // All keywords
  const { data: kwData } = await sb
    .from('audit_keywords')
    .select('keyword, rank_pos, search_volume, intent, intent_type, ranking_url, canonical_topic, cluster, is_near_miss, cpc')
    .eq('audit_id', auditId)
    .order('search_volume', { ascending: false });
  const keywords = (kwData ?? []) as any[];

  // All clusters
  const { data: clusterData } = await sb
    .from('audit_clusters')
    .select('topic, total_volume, est_revenue_low, est_revenue_high, sample_keywords, near_miss_positions')
    .eq('audit_id', auditId)
    .order('est_revenue_high', { ascending: false });
  const clusters = (clusterData ?? []) as any[];

  // Existing page URLs (deduplicated from ranking_url)
  const existingUrls = [...new Set(
    keywords
      .map((k) => k.ranking_url)
      .filter(Boolean)
      .map((u: string) => {
        try { return new URL(u).pathname; } catch { return u; }
      }),
  )];

  console.log(`  Context: ${keywords.length} keywords, ${clusters.length} clusters, ${existingUrls.length} existing URLs`);

  // Build compact keyword table (top 100 by volume for prompt efficiency)
  const topKeywords = keywords.slice(0, 100);
  const kwTable = topKeywords
    .map((k) => `${k.keyword} | ${k.rank_pos} | ${k.search_volume} | ${k.intent ?? k.intent_type ?? ''} | ${k.ranking_url ?? ''} | ${k.cluster ?? ''}`)
    .join('\n');

  const clusterTable = clusters
    .map((c) => `${c.topic} | ${c.total_volume} | $${c.est_revenue_low}-$${c.est_revenue_high} | ${(c.sample_keywords ?? []).slice(0, 3).join(', ')}`)
    .join('\n');

  const prompt = `You are Michael, The Architect — an information architecture and semantic content strategist.

## Task
Generate a complete site architecture blueprint for ${audit.domain} (${audit.service_key} in ${audit.market_city}, ${audit.market_state}).

## Keyword Data (top 100 by volume)
Keyword | Position | Volume | Intent | Ranking URL | Cluster
${kwTable}

## Revenue Clusters (by opportunity)
Topic | Volume | Revenue Range | Sample Keywords
${clusterTable}

## Existing Pages on Site
${existingUrls.join('\n')}

## Output Format — CRITICAL
You MUST produce output in this EXACT format. The parser depends on these heading patterns:

### Start with:
\`\`\`
## Executive Summary
[2-3 paragraphs analyzing current state and recommended architecture]
\`\`\`

### Then for each silo (3-7 silos):
\`\`\`
### Silo N: [Silo Name]
[1-2 sentence description]

| URL Slug | Status | Silo | Role | Primary Keyword | Volume | Action |
|----------|--------|------|------|-----------------|--------|--------|
| service-slug | new/exists | Silo Name | pillar/cluster/support | target keyword | 1234 | create/optimize |
\`\`\`

### Then:
\`\`\`
## Cannibalization Warnings
[Any keyword cannibalization issues between pages]

## Internal Linking Strategy
[Silo-based linking recommendations]
\`\`\`

## Rules
1. URL slugs: lowercase, hyphenated, no leading slash (e.g. "plumber-boise" not "/plumber-boise")
2. Status: "new" for pages to create, "exists" for pages already on the site (match against existing URLs above)
3. Each silo needs exactly 1 pillar page + 2-8 cluster/support pages
4. 3-7 silos total, organized by service category and intent
5. Primary keyword must come from the keyword data — use exact keyword text
6. Volume must match the keyword data
7. Action: "create" for new pages, "optimize" for existing pages
8. Every high-volume cluster topic should map to at least one page
9. Group related keywords into silos by semantic similarity and service category
10. Prioritize near-miss keywords (positions 11-20) — these have the fastest ROI`;

  console.log('  Generating architecture blueprint via claude --print...');
  const result = callClaude(prompt, 'sonnet');
  console.log(`  Blueprint: ${result.length} chars`);

  // Write to disk
  const outDir = path.join(AUDITS_BASE, domain, 'architecture', todayStr());
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'architecture_blueprint.md'), result, 'utf-8');
  console.log(`  Written architecture_blueprint.md to ${path.relative(process.cwd(), outDir)}/`);
}

// ============================================================
// Phase 3: Dwight Trigger
// ============================================================

function triggerDwight(domain: string) {
  const dbPath = path.resolve(process.cwd(), 'store', 'messages.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error(`NanoClaw database not found at ${dbPath} — is NanoClaw initialized?`);
  }

  // Dynamic import would be cleaner but better-sqlite3 is sync anyway
  const Database = require('better-sqlite3');
  const nanoDb = new Database(dbPath);

  const taskId = crypto.randomUUID();
  const now = new Date().toISOString();
  const date = todayStr();

  nanoDb.prepare(`
    INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, schedule_type, schedule_value, context_mode, next_run, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    taskId,
    'main',
    '12086021716@s.whatsapp.net',
    `Run a complete technical SEO audit for ${domain}. Use Screaming Frog CLI to crawl the site. Save all exports to the auditor directory: audits/${domain}/auditor/${date}/. Then generate AUDIT_REPORT.md analyzing the crawl data with prioritized fixes, agentic readiness scorecard, and technical issue categories.`,
    'once',
    now,
    'group',
    now,
    'active',
    now,
  );

  nanoDb.close();
  console.log(`  NanoClaw task created: ${taskId}`);
  console.log(`  Dwight will run via Docker when NanoClaw scheduler picks it up`);
  console.log(`  Output expected at: audits/${domain}/auditor/${date}/`);
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = parseArgs();
  const env = loadEnv();

  if (args.subcommand === 'dwight') {
    triggerDwight(args.domain);
    return;
  }

  // Jim and Michael need Supabase
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
  }
  if (!args.userEmail) {
    console.error('--user-email is required for jim and michael');
    process.exit(1);
  }

  const sb = createClient(supabaseUrl, serviceRoleKey);
  const { audit } = await resolveAudit(sb, args.domain, args.userEmail);
  console.log(`  Audit: ${audit.id} (${audit.status})`);

  switch (args.subcommand) {
    case 'jim':
      await runJim(sb, audit.id, args.domain);
      break;
    case 'michael':
      await runMichael(sb, audit.id, args.domain);
      break;
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message ?? err);
  process.exit(1);
});
