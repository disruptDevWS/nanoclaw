#!/usr/bin/env npx tsx
/**
 * detect-starter-expansion.ts — D1 lifecycle: flag starter pages for expansion
 * or deprioritization based on GSC impressions.
 *
 * Read-only analysis (disk-first — no DB writes). Starter pages (page_brief
 * page_mode='starter', low-authority mode) are thin test pages; this script
 * checks which published ones earned impressions:
 * - EXPAND: impressions ≥ threshold → invest in full content
 * - DEPRIORITIZE: zero impressions after the patience window → keyword is dead
 * - WAIT: too young, or impressions below threshold but non-zero
 * Writes audits/{domain}/analysis/starter_expansion.{json,md}.
 *
 * Usage:
 *   npx tsx scripts/detect-starter-expansion.ts --domain <domain>
 *   Flags: --min-impressions 30 (expansion threshold over the latest GSC window)
 *          --deprioritize-after-days 56 (zero-impression patience window)
 *
 * Environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { normalizePath } from '../src/analysis/reeval-candidates.js';
import {
  loadEnv,
  createSb,
  parseFlags,
  resolveAuditByDomain,
  fetchAll,
  writeAnalysisArtifact,
  todayStr,
} from './analysis-shared.js';

interface StarterPageStatus {
  url_slug: string;
  status: string;
  published_at: string | null;
  age_days: number | null;
  impressions: number | null; // latest GSC snapshot; null = no GSC row
  clicks: number | null;
  avg_position: number | null;
  verdict: 'expand' | 'deprioritize' | 'wait' | 'not_published';
  reason: string;
}

function buildMarkdown(domain: string, rows: StarterPageStatus[], opts: object, snapshotDate: string | null): string {
  let md = `# Starter Page Expansion Review — ${domain}\n\n`;
  md += `Generated: ${todayStr()} | GSC snapshot: ${snapshotDate ?? 'none'} | Thresholds: \`${JSON.stringify(opts)}\`\n\n`;
  if (rows.length === 0) {
    md += `No starter pages found (page_brief.page_mode='starter').\n`;
    return md;
  }
  md += `| Page | Status | Age (days) | Impressions | Clicks | Position | Verdict | Reason |\n`;
  md += `|---|---|---|---|---|---|---|---|\n`;
  for (const r of rows) {
    md += `| /${r.url_slug} | ${r.status} | ${r.age_days ?? '—'} | ${r.impressions ?? '—'} | ${r.clicks ?? '—'} | ${r.avg_position ?? '—'} | **${r.verdict.toUpperCase()}** | ${r.reason} |\n`;
  }
  md += `\nEXPAND = invest in full content (Google confirmed demand). DEPRIORITIZE = keyword earned nothing in the patience window. WAIT = too young or inconclusive.\n`;
  return md;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const domain = flags.domain;
  if (!domain) {
    console.error('Usage: npx tsx scripts/detect-starter-expansion.ts --domain <domain>');
    process.exit(1);
  }
  const minImpressions = Number(flags['min-impressions'] ?? 30);
  const deprioritizeAfterDays = Number(flags['deprioritize-after-days'] ?? 56);

  const env = loadEnv();
  const sb = createSb(env);
  const audit = await resolveAuditByDomain(sb, domain);
  console.log(`\n=== Starter page expansion review: ${domain} (audit ${audit.id}) ===\n`);

  const pages = await fetchAll<{
    url_slug: string;
    status: string;
    published_at: string | null;
    published_url: string | null;
    page_brief: any;
  }>(
    sb,
    'execution_pages',
    'url_slug, status, published_at, published_url, page_brief',
    (q) => q.eq('audit_id', audit.id).eq('page_brief->>page_mode', 'starter'),
  );
  console.log(`  ${pages.length} starter page(s)`);

  // Latest GSC snapshot (page_url stores PATHS)
  const { data: latestSnap } = await (sb as any)
    .from('gsc_page_snapshots')
    .select('snapshot_date')
    .eq('audit_id', audit.id)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  const gscByPath = new Map<string, { impressions: number; clicks: number; avg_position: number }>();
  if (latestSnap?.snapshot_date) {
    const gscRows = await fetchAll<{ page_url: string; impressions: number; clicks: number; avg_position: number }>(
      sb,
      'gsc_page_snapshots',
      'page_url, impressions, clicks, avg_position',
      (q) => q.eq('audit_id', audit.id).eq('snapshot_date', latestSnap.snapshot_date),
    );
    for (const row of gscRows) {
      gscByPath.set(normalizePath(row.page_url), {
        impressions: row.impressions,
        clicks: row.clicks,
        avg_position: row.avg_position,
      });
    }
  }

  const now = new Date();
  const rows: StarterPageStatus[] = pages.map((p) => {
    const isPublished = p.status === 'published' || p.published_at !== null;
    const path = normalizePath(p.published_url ? p.published_url : `/${p.url_slug.replace(/^\/+/, '')}`);
    const gsc = gscByPath.get(path) ?? null;
    const ageDays = p.published_at
      ? Math.floor((now.getTime() - new Date(p.published_at).getTime()) / 86_400_000)
      : null;

    let verdict: StarterPageStatus['verdict'];
    let reason: string;
    if (!isPublished) {
      verdict = 'not_published';
      reason = 'still in the content queue — nothing to measure yet';
    } else if (gsc && gsc.impressions >= minImpressions) {
      verdict = 'expand';
      reason = `${gsc.impressions} impressions ≥ ${minImpressions} — Google confirmed demand`;
    } else if ((gsc?.impressions ?? 0) === 0 && ageDays !== null && ageDays >= deprioritizeAfterDays) {
      verdict = 'deprioritize';
      reason = `zero impressions after ${ageDays} days (patience window ${deprioritizeAfterDays})`;
    } else {
      verdict = 'wait';
      reason =
        ageDays === null
          ? 'published but publish date unknown — re-check next cycle'
          : `${gsc?.impressions ?? 0} impressions at ${ageDays} days — inconclusive`;
    }

    return {
      url_slug: p.url_slug.replace(/^\/+/, ''),
      status: p.status,
      published_at: p.published_at ? p.published_at.slice(0, 10) : null,
      age_days: ageDays,
      impressions: gsc?.impressions ?? (isPublished ? 0 : null),
      clicks: gsc?.clicks ?? (isPublished ? 0 : null),
      avg_position: gsc?.avg_position ?? null,
      verdict,
      reason,
    };
  });

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  Verdicts: ${JSON.stringify(counts)}`);
  for (const r of rows.filter((x) => x.verdict === 'expand' || x.verdict === 'deprioritize')) {
    console.log(`    ${r.verdict.toUpperCase()}: /${r.url_slug} — ${r.reason}`);
  }

  const opts = { minImpressions, deprioritizeAfterDays };
  const artifact = {
    domain,
    audit_id: audit.id,
    generated_at: todayStr(),
    gsc_snapshot_date: latestSnap?.snapshot_date ?? null,
    options: opts,
    pages: rows,
  };
  const jsonPath = writeAnalysisArtifact(
    domain,
    'starter_expansion',
    artifact,
    buildMarkdown(domain, rows, opts, latestSnap?.snapshot_date ?? null),
  );
  console.log(`\n  Written: ${jsonPath} (+ .md)\n`);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}\n`);
  process.exit(1);
});
