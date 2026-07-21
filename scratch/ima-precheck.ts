#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const AID = '08409ae8-28ab-4a34-b92c-2c92f73e5af7';

async function run() {
  // Active clusters
  const { data: clusters } = await sb.from('audit_clusters').select('canonical_key, status, keyword_count').eq('audit_id', AID).order('keyword_count', { ascending: false });
  console.log('=== AUDIT CLUSTERS ===');
  for (const c of clusters!) console.log(`  ${(c as any).canonical_key} | status=${(c as any).status ?? 'null'} | kw=${(c as any).keyword_count}`);
  console.log(`Total: ${clusters!.length}`);

  // Cluster strategy
  const { data: strats } = await sb.from('cluster_strategy').select('canonical_key, status').eq('audit_id', AID);
  console.log('\n=== CLUSTER STRATEGY ===');
  for (const s of strats!) console.log(`  ${(s as any).canonical_key} | status=${(s as any).status ?? 'null'}`);
  console.log(`Total: ${strats!.length}`);

  // Performance snapshots
  const { data: perf } = await sb.from('cluster_performance_snapshots').select('canonical_key, snapshot_date, authority_score').eq('audit_id', AID);
  console.log('\n=== PERFORMANCE SNAPSHOTS ===');
  const keys = new Set(perf!.map((p: any) => p.canonical_key));
  console.log(`Distinct keys: ${keys.size}, Total rows: ${perf!.length}`);
  for (const k of [...keys].sort()) {
    const rows = perf!.filter((p: any) => p.canonical_key === k);
    console.log(`  ${k}: ${rows.length} snapshots`);
  }

  // Committed pages
  const { data: pages } = await sb.from('execution_pages').select('url_slug, canonical_key, silo, status, source, published_at').eq('audit_id', AID).neq('status', 'not_started');
  console.log('\n=== COMMITTED PAGES (status != not_started) ===');
  for (const p of pages!) console.log(`  ${(p as any).url_slug} | ${(p as any).status} | src=${(p as any).source} | ck=${(p as any).canonical_key}`);
  console.log(`Total committed: ${pages!.length}`);

  // Check execution_pages with cluster_strategy or manual source
  const { data: csPages } = await sb.from('execution_pages').select('url_slug, status, source').eq('audit_id', AID).in('source', ['cluster_strategy', 'manual']);
  console.log(`\n=== CLUSTER_STRATEGY/MANUAL SOURCE PAGES ===`);
  console.log(`Total: ${csPages!.length}`);
  for (const p of csPages!) console.log(`  ${(p as any).url_slug} | ${(p as any).status} | ${(p as any).source}`);

  // Shadow key overlap with legacy
  const { data: kwSample } = await sb.from('audit_keywords')
    .select('canonical_key, shadow_canonical_key')
    .eq('audit_id', AID)
    .limit(1100);
  const legacyKeys = new Set(kwSample!.map((k: any) => k.canonical_key));
  const shadowKeys = new Set(kwSample!.map((k: any) => k.shadow_canonical_key).filter(Boolean));
  const overlap = [...legacyKeys].filter(k => shadowKeys.has(k));
  const legacyOnly = [...legacyKeys].filter(k => !shadowKeys.has(k));
  const shadowOnly = [...shadowKeys].filter(k => !legacyKeys.has(k));
  console.log(`\n=== KEY OVERLAP ===`);
  console.log(`Legacy keys: ${legacyKeys.size}, Shadow keys: ${shadowKeys.size}`);
  console.log(`Overlap (in both): ${overlap.length}`);
  console.log(`Legacy only (will be deprecated): ${legacyOnly.length}`);
  console.log(`Shadow only (new): ${shadowOnly.length}`);
  console.log(`\nLegacy-only keys: ${legacyOnly.sort().join(', ')}`);
  console.log(`\nShadow-only keys: ${shadowOnly.sort().join(', ')}`);
}

run().catch(e => { console.error(e); process.exit(1); });
