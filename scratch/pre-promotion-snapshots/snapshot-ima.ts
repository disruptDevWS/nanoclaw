#!/usr/bin/env npx tsx
/**
 * Snapshot IMA's current state (pre-Phase-2.4 hybrid promotion)
 * as the baseline for post-promotion comparison.
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
    return env;
  }
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val !== undefined) env[key] = val;
  }
  return env;
}

const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const AUDIT_ID = '08409ae8-28ab-4a34-b92c-2c92f73e5af7';
const OUT_DIR = path.join(import.meta.dirname, 'ima-2026-04-20');

async function run() {
  console.log('Snapshotting IMA pre-promotion baseline...\n');

  // 1. audit_keywords — full dump
  const allKeywords: any[] = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data, error } = await sb
      .from('audit_keywords')
      .select(
        'id, keyword, canonical_key, canonical_topic, cluster, classification_method, similarity_score, shadow_canonical_key, shadow_canonical_topic'
      )
      .eq('audit_id', AUDIT_ID)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      .order('id');
    if (error) throw error;
    if (!data || data.length === 0) break;
    allKeywords.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  fs.writeFileSync(
    path.join(OUT_DIR, 'audit_keywords.json'),
    JSON.stringify(allKeywords, null, 2)
  );
  console.log(`audit_keywords: ${allKeywords.length} rows`);

  // 2. Distinct canonical_keys
  const distinctKeys = new Set(allKeywords.map((k) => k.canonical_key));
  console.log(`Distinct canonical_keys: ${distinctKeys.size}`);
  console.log('Keys:', [...distinctKeys].sort().join(', '));

  // 3. Classification method distribution
  const methodDist: Record<string, number> = {};
  for (const kw of allKeywords) {
    const m = kw.classification_method || 'null';
    methodDist[m] = (methodDist[m] || 0) + 1;
  }
  console.log('\nClassification methods:', JSON.stringify(methodDist, null, 2));

  // 4. audit_clusters
  const { data: clusters, error: clErr } = await sb
    .from('audit_clusters')
    .select('*')
    .eq('audit_id', AUDIT_ID);
  if (clErr) throw clErr;
  fs.writeFileSync(
    path.join(OUT_DIR, 'audit_clusters.json'),
    JSON.stringify(clusters, null, 2)
  );
  console.log(`\naudit_clusters: ${clusters!.length} rows`);

  // 5. execution_pages
  const { data: pages, error: pgErr } = await sb
    .from('execution_pages')
    .select('id, url_slug, canonical_key, silo, status, source')
    .eq('audit_id', AUDIT_ID);
  if (pgErr) throw pgErr;
  fs.writeFileSync(
    path.join(OUT_DIR, 'execution_pages.json'),
    JSON.stringify(pages, null, 2)
  );
  console.log(`execution_pages: ${pages!.length} rows`);

  // 6. cluster_strategy
  const { data: strategies, error: stErr } = await sb
    .from('cluster_strategy')
    .select('*')
    .eq('audit_id', AUDIT_ID);
  if (stErr) throw stErr;
  fs.writeFileSync(
    path.join(OUT_DIR, 'cluster_strategy.json'),
    JSON.stringify(strategies, null, 2)
  );
  console.log(`cluster_strategy: ${strategies!.length} rows`);

  // 7. cluster_performance_snapshots
  const { data: perf, error: pfErr } = await sb
    .from('cluster_performance_snapshots')
    .select('*')
    .eq('audit_id', AUDIT_ID);
  if (pfErr) throw pfErr;
  fs.writeFileSync(
    path.join(OUT_DIR, 'cluster_performance_snapshots.json'),
    JSON.stringify(perf, null, 2)
  );
  console.log(`cluster_performance_snapshots: ${perf!.length} rows`);

  // 8. Committed page details
  const committedPages = (pages || []).filter(
    (p: any) => p.status === 'in_progress' || p.status === 'published'
  );
  console.log(
    `\nCommitted pages (in_progress/published): ${committedPages.length}`
  );
  for (const p of committedPages) {
    console.log(
      `  - ${(p as any).url_slug} | status=${(p as any).status} | source=${(p as any).source} | canonical_key=${(p as any).canonical_key} | silo=${(p as any).silo}`
    );
  }

  // 9. Summary
  const summary = {
    timestamp: new Date().toISOString(),
    audit_id: AUDIT_ID,
    domain: 'idahomedicalacademy.com',
    keyword_count: allKeywords.length,
    distinct_canonical_keys: distinctKeys.size,
    canonical_keys: [...distinctKeys].sort(),
    classification_methods: methodDist,
    cluster_count: clusters!.length,
    execution_pages_count: pages!.length,
    committed_pages: committedPages.map((p: any) => ({
      url_slug: p.url_slug,
      status: p.status,
      source: p.source,
      canonical_key: p.canonical_key,
      silo: p.silo,
    })),
    cluster_strategy_count: strategies!.length,
    performance_snapshots_count: perf!.length,
    note: 'Pre-Phase-2.4 hybrid promotion baseline. All keywords are classification_method=NULL (legacy origin). First fresh-evaluation hybrid run — no prior hybrid state.',
  };
  fs.writeFileSync(
    path.join(OUT_DIR, 'baseline-summary.json'),
    JSON.stringify(summary, null, 2)
  );

  // 10. Human-readable baseline-metrics.md
  const md = `# IMA Pre-Promotion Baseline — ${summary.timestamp}

## Audit
- **Domain:** idahomedicalacademy.com
- **Audit ID:** ${AUDIT_ID}

## Counts

| Table | Rows |
|-------|------|
| audit_keywords | ${allKeywords.length} |
| audit_clusters | ${clusters!.length} |
| execution_pages | ${pages!.length} |
| cluster_strategy | ${strategies!.length} |
| cluster_performance_snapshots | ${perf!.length} |

## Classification Methods (pre-promotion)

| Method | Count |
|--------|-------|
${Object.entries(methodDist)
  .map(([m, c]) => `| ${m} | ${c} |`)
  .join('\n')}

## Distinct Canonical Keys (${distinctKeys.size})

${[...distinctKeys].sort().map((k) => `- \`${k}\``).join('\n')}

## Committed Pages

${
  committedPages.length === 0
    ? '_None_'
    : committedPages
        .map(
          (p: any) =>
            `- \`${p.url_slug}\` — status=${p.status}, source=${p.source}, canonical_key=${p.canonical_key}, silo=${p.silo}`
        )
        .join('\n')
}

## Notes

- All 1,100 keywords have \`classification_method = NULL\` (legacy origin)
- First hybrid run will freshly evaluate all keywords (no locking — priorHybridSnapshot will be empty)
- Phase 2.3c contamination fix is present but NOT load-bearing this run
- \`emt_training\` canonical_key on committed page is already orphaned (no keyword has this key)
`;
  fs.writeFileSync(path.join(OUT_DIR, 'baseline-metrics.md'), md);
  console.log('\nBaseline metrics written to baseline-metrics.md');
  console.log('\nDone.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
