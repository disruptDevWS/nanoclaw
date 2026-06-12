#!/usr/bin/env npx tsx
/**
 * detect-reeval-candidates.ts — A1: NavBoost re-evaluation candidate detection.
 *
 * Read-only analysis. Flags pages ranking 8–25 on KD<30 keywords whose cluster
 * has grown >2x since the page was published — candidates for republish under a
 * new URL + 301 to trigger NavBoost re-evaluation against current authority.
 * Writes audits/{domain}/analysis/reeval_candidates.{json,md}.
 *
 * Usage:
 *   npx tsx scripts/detect-reeval-candidates.ts --domain idahomedicalacademy.com
 *   Flags: --min-pos 8 --max-pos 25 --max-kd 30 --min-growth 2.0 --min-age-months 6 --min-impressions 0
 *
 * Environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import {
  detectReevalCandidates,
  normalizePath,
  DEFAULT_REEVAL_OPTIONS,
  ReevalKeyword,
  ClusterSnapshot,
  ReevalCandidate,
} from '../src/analysis/reeval-candidates.js';
import {
  loadEnv,
  createSb,
  parseFlags,
  resolveAuditByDomain,
  fetchAll,
  writeAnalysisArtifact,
  todayStr,
} from './analysis-shared.js';

function buildMarkdown(domain: string, candidates: ReevalCandidate[], optionsUsed: object): string {
  let md = `# NavBoost Re-Evaluation Candidates — ${domain}\n\n`;
  md += `Generated: ${todayStr()}\n`;
  md += `Thresholds: \`${JSON.stringify(optionsUsed)}\`\n\n`;
  if (candidates.length === 0) {
    md += `No candidates found.\n`;
    return md;
  }
  md += `Republish each candidate under a new URL with improved content + 301 from the old URL. `;
  md += `Do NOT republish pages at position 1–5; do NOT republish without a 301 or without content improvement.\n\n`;
  md += `| Page | Primary keyword | Pos | KD | Cluster | Growth | Published | Impressions | Est. lift |\n`;
  md += `|---|---|---|---|---|---|---|---|---|\n`;
  for (const c of candidates) {
    const growth = `${c.growth_factor}x${c.growth_is_lower_bound ? ' (lower bound)' : ''} (${c.cluster_count_at_publish}→${c.cluster_count_now})`;
    md += `| ${c.page_path} | ${c.primary_keyword} | ${c.primary_keyword_position} | ${c.primary_keyword_kd} | ${c.canonical_key ?? ''} | ${growth} | ${c.publish_date ?? 'pre-tracking'} | ${c.impressions ?? '—'} | ${c.estimated_lift} |\n`;
  }
  return md;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const domain = flags.domain;
  if (!domain) {
    console.error('Usage: npx tsx scripts/detect-reeval-candidates.ts --domain <domain>');
    process.exit(1);
  }

  const options = {
    minPos: Number(flags['min-pos'] ?? DEFAULT_REEVAL_OPTIONS.minPos),
    maxPos: Number(flags['max-pos'] ?? DEFAULT_REEVAL_OPTIONS.maxPos),
    maxKd: Number(flags['max-kd'] ?? DEFAULT_REEVAL_OPTIONS.maxKd),
    minGrowth: Number(flags['min-growth'] ?? DEFAULT_REEVAL_OPTIONS.minGrowth),
    minAgeMonths: Number(flags['min-age-months'] ?? DEFAULT_REEVAL_OPTIONS.minAgeMonths),
    minImpressions: Number(flags['min-impressions'] ?? DEFAULT_REEVAL_OPTIONS.minImpressions),
    now: new Date(),
  };

  const env = loadEnv();
  const sb = createSb(env);
  const audit = await resolveAuditByDomain(sb, domain);
  console.log(`\n=== Re-evaluation candidates: ${domain} (audit ${audit.id}) ===\n`);

  // 1) Keywords with KD + position
  const keywords = await fetchAll<ReevalKeyword>(
    sb,
    'audit_keywords',
    'keyword, rank_pos, keyword_difficulty, canonical_key, ranking_url, search_volume, is_brand',
    (q) => q.eq('audit_id', audit.id),
  );

  // 2) Cluster size history
  const snapRows = await fetchAll<{ canonical_key: string; snapshot_date: string; keyword_count: number | null }>(
    sb,
    'cluster_performance_snapshots',
    'canonical_key, snapshot_date, keyword_count',
    (q) => q.eq('audit_id', audit.id).order('snapshot_date', { ascending: true }),
  );
  const clusterHistory = new Map<string, ClusterSnapshot[]>();
  for (const row of snapRows) {
    if (!row.canonical_key || row.keyword_count === null) continue;
    if (!clusterHistory.has(row.canonical_key)) clusterHistory.set(row.canonical_key, []);
    clusterHistory.get(row.canonical_key)!.push({
      snapshot_date: row.snapshot_date,
      keyword_count: row.keyword_count,
    });
  }

  // 3) Publish dates from execution_pages (published_at preferred; created_at is
  //    brief-creation time — legacy fallback only)
  const pages = await fetchAll<{ url_slug: string | null; published_at: string | null; created_at: string | null }>(
    sb,
    'execution_pages',
    'url_slug, published_at, created_at',
    (q) => q.eq('audit_id', audit.id),
  );
  const publishDates = new Map<string, string>();
  for (const p of pages) {
    if (!p.url_slug) continue;
    const date = p.published_at ?? p.created_at;
    if (date) publishDates.set(normalizePath(p.url_slug), date.slice(0, 10));
  }

  // 4) Latest GSC page snapshot for impressions context
  const { data: latestSnap } = await (sb as any)
    .from('gsc_page_snapshots')
    .select('snapshot_date')
    .eq('audit_id', audit.id)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const gscByPath = new Map<string, { impressions: number; avg_position: number }>();
  if (latestSnap?.snapshot_date) {
    const gscRows = await fetchAll<{ page_url: string; impressions: number; avg_position: number }>(
      sb,
      'gsc_page_snapshots',
      'page_url, impressions, avg_position',
      (q) => q.eq('audit_id', audit.id).eq('snapshot_date', latestSnap.snapshot_date),
    );
    // page_url stores PATHS (e.g. /emt-seattle), not full URLs
    for (const row of gscRows) {
      gscByPath.set(normalizePath(row.page_url), {
        impressions: row.impressions,
        avg_position: row.avg_position,
      });
    }
  }

  console.log(
    `  Inputs: ${keywords.length} keywords, ${clusterHistory.size} clusters with history, ` +
      `${publishDates.size} pages with dates, ${gscByPath.size} GSC paths (${latestSnap?.snapshot_date ?? 'no GSC snapshot'})`,
  );

  const candidates = detectReevalCandidates(keywords, clusterHistory, publishDates, gscByPath, options);

  if (candidates.length === 0) {
    console.log(`  No re-evaluation candidates at current thresholds.`);
  } else {
    console.log(`  ${candidates.length} candidate(s):`);
    for (const c of candidates) {
      console.log(
        `    ${c.page_path} — "${c.primary_keyword}" pos ${c.primary_keyword_position}, KD ${c.primary_keyword_kd}, ` +
          `growth ${c.growth_factor}x${c.growth_is_lower_bound ? ' (lower bound)' : ''}, ${c.estimated_lift}`,
      );
    }
  }

  const { now: _now, ...optionsUsed } = options;
  const artifact = {
    domain,
    audit_id: audit.id,
    generated_at: todayStr(),
    options: optionsUsed,
    candidates,
  };
  const jsonPath = writeAnalysisArtifact(
    domain,
    'reeval_candidates',
    artifact,
    buildMarkdown(domain, candidates, optionsUsed),
  );
  console.log(`\n  Written: ${jsonPath} (+ .md)\n`);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}\n`);
  process.exit(1);
});
