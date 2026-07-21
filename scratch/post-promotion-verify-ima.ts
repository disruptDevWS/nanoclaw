#!/usr/bin/env npx tsx
/**
 * Post-promotion validation for IMA Phase 2.4
 * Compares current DB state against pre-promotion baseline.
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
  return Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined)
  ) as Record<string, string>;
}

const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const AUDIT_ID = '08409ae8-28ab-4a34-b92c-2c92f73e5af7';
const BASELINE_DIR = path.join(
  import.meta.dirname,
  'pre-promotion-snapshots',
  'ima-2026-04-20'
);

async function run() {
  const baseline = JSON.parse(
    fs.readFileSync(path.join(BASELINE_DIR, 'baseline-summary.json'), 'utf-8')
  );
  const halts: string[] = [];

  console.log('=== IMA Phase 2.4 Post-Promotion Validation ===\n');

  // 4a. Cluster count and key comparison
  console.log('--- 4a. Cluster Count & Key Comparison ---');
  const allKeywords: any[] = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data, error } = await sb
      .from('audit_keywords')
      .select(
        'id, keyword, canonical_key, canonical_topic, cluster, classification_method, similarity_score, arbitration_reason'
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

  const postKeys = new Set(allKeywords.map((k: any) => k.canonical_key));
  const preKeys = new Set(baseline.canonical_keys as string[]);

  const survived = [...postKeys].filter((k) => preKeys.has(k));
  const deprecated = [...preKeys].filter((k) => !postKeys.has(k));
  const newKeys = [...postKeys].filter((k) => !preKeys.has(k));

  console.log(`  Keywords: ${allKeywords.length} (baseline: ${baseline.keyword_count})`);
  console.log(`  Distinct canonical_keys: ${postKeys.size} (baseline: ${preKeys.size})`);
  console.log(`  Survived: ${survived.length}`);
  console.log(`  Deprecated (pre-only): ${deprecated.length}`);
  if (deprecated.length > 0) console.log(`    ${deprecated.sort().join(', ')}`);
  console.log(`  New (post-only): ${newKeys.length}`);
  if (newKeys.length > 0) console.log(`    ${newKeys.sort().join(', ')}`);

  const { data: clusters } = await sb
    .from('audit_clusters')
    .select('*')
    .eq('audit_id', AUDIT_ID);
  console.log(`  audit_clusters: ${clusters!.length} (baseline: ${baseline.cluster_count})`);

  // 4b. Classification method distribution
  console.log('\n--- 4b. Classification Method Distribution ---');
  const methodDist: Record<string, number> = {};
  for (const kw of allKeywords) {
    const m = (kw as any).classification_method || 'null';
    methodDist[m] = (methodDist[m] || 0) + 1;
  }
  for (const [m, c] of Object.entries(methodDist).sort(
    ([, a], [, b]) => b - a
  )) {
    console.log(`  ${m}: ${c}`);
  }
  if (methodDist['prior_assignment_locked'] && methodDist['prior_assignment_locked'] > 0) {
    console.log('  NOTE: prior_assignment_locked > 0 — UNEXPECTED for first hybrid run');
  } else {
    console.log('  prior_assignment_locked = 0 — EXPECTED (no prior hybrid state)');
  }

  // 4c. Committed page check
  console.log('\n--- 4c. Committed Page Check ---');
  const { data: committedPage } = await sb
    .from('execution_pages')
    .select('id, url_slug, canonical_key, silo, status, source')
    .eq('audit_id', AUDIT_ID)
    .eq('url_slug', 'how-to-become-an-emt-in-idaho')
    .single();

  if (!committedPage) {
    halts.push('HALT: Committed page how-to-become-an-emt-in-idaho NOT FOUND');
    console.log('  HALT: Committed page NOT FOUND');
  } else {
    const cp = committedPage as any;
    console.log(`  url_slug: ${cp.url_slug}`);
    console.log(`  status: ${cp.status}`);
    console.log(`  source: ${cp.source}`);
    console.log(`  canonical_key: ${cp.canonical_key} (was: emt_training)`);
    console.log(`  silo: ${cp.silo}`);
    if (cp.status !== 'in_progress') {
      halts.push(
        `HALT: Committed page status changed from in_progress to ${cp.status}`
      );
    }
    if (cp.source !== 'michael') {
      halts.push(
        `HALT: Committed page source changed from michael to ${cp.source}`
      );
    }
  }

  // 4d. Performance snapshots preserved
  console.log('\n--- 4d. Performance Snapshots Preserved ---');
  const { data: perf } = await sb
    .from('cluster_performance_snapshots')
    .select('id')
    .eq('audit_id', AUDIT_ID);
  console.log(
    `  cluster_performance_snapshots: ${perf!.length} (baseline: ${baseline.performance_snapshots_count})`
  );
  if (perf!.length < baseline.performance_snapshots_count) {
    halts.push(
      `HALT: Performance snapshots decreased from ${baseline.performance_snapshots_count} to ${perf!.length}`
    );
  }

  // 4e. Cluster strategy deprecation
  console.log('\n--- 4e. Cluster Strategy ---');
  const { data: strategies } = await sb
    .from('cluster_strategy')
    .select('id, canonical_key, status')
    .eq('audit_id', AUDIT_ID);
  console.log(
    `  cluster_strategy: ${strategies!.length} (baseline: ${baseline.cluster_strategy_count})`
  );
  if (strategies!.length > 0) {
    for (const s of strategies!) {
      console.log(
        `    ${(s as any).canonical_key}: status=${(s as any).status}`
      );
    }
  }

  // 4f. Execution pages backfill
  console.log('\n--- 4f. Execution Pages Backfill ---');
  const { data: execPages } = await sb
    .from('execution_pages')
    .select('id, url_slug, canonical_key, silo, status, source')
    .eq('audit_id', AUDIT_ID)
    .neq('status', 'deprecated');
  const withKey = (execPages || []).filter(
    (p: any) => p.canonical_key !== null
  );
  const total = execPages!.length;
  console.log(`  Total non-deprecated pages: ${total}`);
  console.log(
    `  Pages with canonical_key: ${withKey.length} (${((withKey.length / total) * 100).toFixed(1)}%)`
  );
  if (total > 0 && withKey.length / total < 0.6) {
    halts.push(
      `HALT: Backfill rate ${((withKey.length / total) * 100).toFixed(1)}% < 60%`
    );
  }

  // 4g. Pam keyword-join readiness
  console.log('\n--- 4g. Pam Keyword-Join Readiness ---');
  const pagesWithKey = (execPages || []).filter(
    (p: any) => p.canonical_key !== null && p.status !== 'deprecated'
  );

  let healthy = 0;
  let degraded = 0;
  let fallback = 0;
  const fallbackPages: string[] = [];

  for (const ep of pagesWithKey) {
    const p = ep as any;
    const { count } = await sb
      .from('audit_keywords')
      .select('*', { count: 'exact', head: true })
      .eq('audit_id', AUDIT_ID)
      .eq('cluster', p.silo);
    if (count === 0) {
      fallback++;
      fallbackPages.push(p.url_slug);
    } else if (count! < 5) {
      degraded++;
    } else {
      healthy++;
    }
  }
  console.log(
    `  Healthy (5+ keywords): ${healthy}  Degraded (<5): ${degraded}  Fallback (0): ${fallback}`
  );
  if (fallbackPages.length > 0) {
    console.log(`  Fallback pages: ${fallbackPages.join(', ')}`);
  }

  // Summary
  console.log('\n=== VALIDATION SUMMARY ===');
  if (halts.length > 0) {
    console.log('\nHALT CONDITIONS FIRED:');
    for (const h of halts) {
      console.log(`  ${h}`);
    }
    console.log('\nOUTCOME: HALT — investigation required');
  } else {
    console.log('\nAll checks passed. No halt conditions fired.');
    console.log('OUTCOME: PASS');
  }

  // Write results
  const results = {
    timestamp: new Date().toISOString(),
    audit_id: AUDIT_ID,
    keyword_count: allKeywords.length,
    distinct_canonical_keys: postKeys.size,
    baseline_canonical_keys: preKeys.size,
    survived_keys: survived.length,
    deprecated_keys: deprecated,
    new_keys: newKeys,
    cluster_count: clusters!.length,
    baseline_cluster_count: baseline.cluster_count,
    classification_methods: methodDist,
    committed_page: committedPage,
    performance_snapshots: perf!.length,
    baseline_performance_snapshots: baseline.performance_snapshots_count,
    cluster_strategy_count: strategies!.length,
    execution_pages_total: total,
    execution_pages_with_key: withKey.length,
    backfill_rate: ((withKey.length / total) * 100).toFixed(1) + '%',
    pam_readiness: { healthy, degraded, fallback, fallback_pages: fallbackPages },
    halts,
    outcome: halts.length > 0 ? 'HALT' : 'PASS',
  };
  fs.writeFileSync(
    path.join(
      import.meta.dirname,
      'pre-promotion-snapshots',
      'ima-2026-04-20',
      'post-promotion-validation.json'
    ),
    JSON.stringify(results, null, 2)
  );
  console.log(
    '\nResults written to scratch/pre-promotion-snapshots/ima-2026-04-20/post-promotion-validation.json'
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
