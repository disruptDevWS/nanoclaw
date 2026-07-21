#!/usr/bin/env npx tsx
/**
 * Verify SMA post-re-run state matches the accepted baseline.
 * This is a confidence check, not a validation gate.
 */
import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const AUDIT_ID = 'c07eb21d-3120-4242-8754-361a429a6f2c';
const BASELINE_DIR = path.join(import.meta.dirname, 'sma-2026-04-20');

async function run() {
  console.log('Verifying SMA post-re-run state against baseline...\n');

  // Load baseline
  const baselineKw = JSON.parse(fs.readFileSync(path.join(BASELINE_DIR, 'audit_keywords_baseline.json'), 'utf-8'));
  const baselineMap = new Map<string, any>();
  for (const kw of baselineKw) baselineMap.set(kw.id, kw);

  // Fetch current
  const { data: currentKw } = await sb
    .from('audit_keywords')
    .select('id, keyword, canonical_key, canonical_topic, cluster, classification_method, similarity_score')
    .eq('audit_id', AUDIT_ID);

  // Compare canonical_keys
  let driftCount = 0;
  const drifted: any[] = [];
  for (const curr of currentKw!) {
    const base = baselineMap.get(curr.id);
    if (!base) {
      console.warn(`  NEW keyword (not in baseline): ${curr.keyword}`);
      continue;
    }
    if (curr.canonical_key !== base.canonical_key) {
      driftCount++;
      drifted.push({
        keyword: curr.keyword,
        baseline_key: base.canonical_key,
        current_key: curr.canonical_key,
      });
    }
  }

  console.log(`Keywords compared: ${currentKw!.length}`);
  console.log(`Canonical_key drift: ${driftCount}`);

  if (drifted.length > 0) {
    console.log('\nDrifted keywords:');
    for (const d of drifted) {
      console.log(`  "${d.keyword}": ${d.baseline_key} → ${d.current_key}`);
    }
  }

  // Distinct keys
  const currentKeys = new Set(currentKw!.map((k: any) => k.canonical_key));
  const baselineKeys = new Set(baselineKw.map((k: any) => k.canonical_key));
  console.log(`\nDistinct canonical_keys: baseline=${baselineKeys.size}, current=${currentKeys.size}`);

  // Classification methods
  const methods: Record<string, number> = {};
  for (const kw of currentKw!) {
    const m = (kw as any).classification_method || 'null';
    methods[m] = (methods[m] || 0) + 1;
  }
  console.log('Classification methods:', JSON.stringify(methods));

  // Clusters
  const { data: clusters } = await sb
    .from('audit_clusters')
    .select('canonical_key, keyword_count')
    .eq('audit_id', AUDIT_ID)
    .order('keyword_count', { ascending: false });
  console.log(`\nClusters: ${clusters!.length}`);
  for (const c of clusters!) {
    console.log(`  ${(c as any).canonical_key}: ${(c as any).keyword_count} keywords`);
  }

  // Performance snapshots preserved?
  const { data: perf } = await sb
    .from('cluster_performance_snapshots')
    .select('id')
    .eq('audit_id', AUDIT_ID);
  console.log(`\nPerformance snapshots: ${perf!.length} (baseline: 13)`);

  console.log(`\n=== CONFIDENCE CHECK: ${driftCount === 0 ? 'PASS' : 'DRIFT DETECTED'} ===`);
}

run().catch((e) => { console.error(e); process.exit(1); });
