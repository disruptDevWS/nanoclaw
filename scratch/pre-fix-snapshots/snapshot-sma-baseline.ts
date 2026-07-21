#!/usr/bin/env npx tsx
/**
 * Snapshot SMA's current state (post-Phase-2.3b, pre-Phase-2.3c re-run)
 * as the accepted baseline for the confidence check.
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const AUDIT_ID = 'c07eb21d-3120-4242-8754-361a429a6f2c';
const OUT_DIR = path.join(import.meta.dirname, 'sma-2026-04-20');

async function run() {
  console.log('Snapshotting SMA current state as accepted baseline...\n');

  // 1. audit_keywords — full dump
  const { data: keywords, error: kwErr } = await sb
    .from('audit_keywords')
    .select('id, keyword, canonical_key, canonical_topic, cluster, classification_method, similarity_score, shadow_canonical_key, shadow_canonical_topic')
    .eq('audit_id', AUDIT_ID);
  if (kwErr) throw kwErr;
  fs.writeFileSync(path.join(OUT_DIR, 'audit_keywords_baseline.json'), JSON.stringify(keywords, null, 2));
  console.log(`audit_keywords: ${keywords!.length} rows`);

  // 2. Distinct canonical_keys
  const distinctKeys = new Set(keywords!.map((k: any) => k.canonical_key));
  console.log(`Distinct canonical_keys: ${distinctKeys.size}`);
  console.log('Keys:', [...distinctKeys].sort().join(', '));

  // 3. Classification method distribution
  const methodDist: Record<string, number> = {};
  for (const kw of keywords!) {
    const m = (kw as any).classification_method || 'null';
    methodDist[m] = (methodDist[m] || 0) + 1;
  }
  console.log('\nClassification methods:', JSON.stringify(methodDist, null, 2));

  // 4. audit_clusters
  const { data: clusters } = await sb
    .from('audit_clusters')
    .select('*')
    .eq('audit_id', AUDIT_ID);
  fs.writeFileSync(path.join(OUT_DIR, 'audit_clusters_baseline.json'), JSON.stringify(clusters, null, 2));
  console.log(`\naudit_clusters: ${clusters!.length} rows`);

  // 5. execution_pages
  const { data: pages } = await sb
    .from('execution_pages')
    .select('id, url_slug, canonical_key, silo, status, source')
    .eq('audit_id', AUDIT_ID);
  fs.writeFileSync(path.join(OUT_DIR, 'execution_pages_baseline.json'), JSON.stringify(pages, null, 2));
  console.log(`execution_pages: ${pages!.length} rows`);

  // 6. cluster_performance_snapshots
  const { data: perf } = await sb
    .from('cluster_performance_snapshots')
    .select('*')
    .eq('audit_id', AUDIT_ID);
  fs.writeFileSync(path.join(OUT_DIR, 'cluster_performance_snapshots_baseline.json'), JSON.stringify(perf, null, 2));
  console.log(`cluster_performance_snapshots: ${perf!.length} rows`);

  // 7. Summary
  const summary = {
    timestamp: new Date().toISOString(),
    audit_id: AUDIT_ID,
    keyword_count: keywords!.length,
    distinct_canonical_keys: distinctKeys.size,
    canonical_keys: [...distinctKeys].sort(),
    classification_methods: methodDist,
    cluster_count: clusters!.length,
    execution_pages_count: pages!.length,
    performance_snapshots_count: perf!.length,
    note: 'Post-Phase-2.3b accepted baseline. 14 distinct keys (includes 2 from legacy contamination during failed attempt 2). This is the new baseline — not a regression target.',
  };
  fs.writeFileSync(path.join(OUT_DIR, 'baseline-summary.json'), JSON.stringify(summary, null, 2));
  console.log('\nBaseline summary written.');
  console.log('\nDone.');
}

run().catch((e) => { console.error(e); process.exit(1); });
