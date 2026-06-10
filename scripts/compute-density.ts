#!/usr/bin/env npx tsx
/**
 * compute-density.ts — Phase 4c: Coverage Density + Cannibalization Detection
 *
 * Per cluster:
 *   - density_score: % of the cluster's keywords semantically covered by the
 *     client's existing content (site-wide headings + page title|h1 corpus)
 *   - competitor_density_score: same vs the cluster's competitor headings
 *   Denormalized onto audit_clusters (same pattern as Phase 4b coverage_score).
 *
 * Cannibalization: client page pairs ranking in the same cluster whose
 * title+h1+meta embeddings exceed 0.90 similarity → cannibalization_warnings
 * (DELETE + INSERT, current state only).
 *
 * Runs after Phase 4b, before Gap (Phase 5), so Gap can consume the scores.
 * Zero page-fetch cost: reuses competitor_sections + Dwight crawl data.
 *
 * Usage:
 *   npx tsx scripts/compute-density.ts --domain <domain> --user-email <email> \
 *     [--threshold 0.80] [--skip-cannibalization]
 *
 * Environment:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY (for embeddings)
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  computeCoverageDensity,
  DENSITY_THRESHOLD,
  type CorpusText,
  type DensityKeyword,
} from '../src/agents/density/coverage-density.js';
import {
  detectCannibalization,
  normalizeUrl,
} from '../src/agents/density/cannibalization.js';
import { loadPageMeta } from '../src/agents/density/crawl-meta.js';

// ── CLI parsing ──

function parseArgs(): {
  domain: string;
  userEmail: string;
  threshold: number;
  skipCannibalization: boolean;
} {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    }
  }
  if (!flags.domain || !flags['user-email']) {
    console.error('Usage: npx tsx scripts/compute-density.ts --domain <domain> --user-email <email> [--threshold 0.80] [--skip-cannibalization]');
    process.exit(1);
  }
  const threshold = flags.threshold ? parseFloat(flags.threshold) : DENSITY_THRESHOLD;
  if (Number.isNaN(threshold) || threshold <= 0 || threshold >= 1) {
    console.error(`Invalid --threshold "${flags.threshold}" — expected a value between 0 and 1`);
    process.exit(1);
  }
  return {
    domain: flags.domain,
    userEmail: flags['user-email'],
    threshold,
    skipCannibalization: flags['skip-cannibalization'] === 'true',
  };
}

// ── Environment ──

function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const vars: Record<string, string> = {};
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
      vars[key] = val;
    }
    return { ...vars, ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v != null) as [string, string][]) };
  }
  return Object.fromEntries(Object.entries(process.env).filter(([, v]) => v != null)) as Record<string, string>;
}

// ── Helpers ──

function headingContentId(prefix: 'client' | 'comp', key: string, heading: string): string {
  return `${prefix}:${key}:${heading.toLowerCase().trim().replace(/\s+/g, '_').slice(0, 80)}`;
}

// ── Main ──

async function main() {
  const { domain, userEmail, threshold, skipCannibalization } = parseArgs();
  const env = loadEnv();

  // Propagate env for embeddings service
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || env.SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY;

  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set (required for embeddings)');

  const sb = createClient(supabaseUrl, supabaseKey);

  // 1. Find the audit
  const { data: audit } = await sb
    .from('audits')
    .select('id, domain')
    .eq('domain', domain)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!audit) {
    console.error(`No audit found for domain ${domain}`);
    process.exit(1);
  }

  const auditId = audit.id;
  console.log(`\n=== Phase 4c: Coverage Density + Cannibalization ===`);
  console.log(`  Audit: ${auditId} (${domain}, user ${userEmail})`);
  console.log(`  Density threshold: ${threshold}`);

  // 2. Load clusters
  const { data: clusters } = await sb
    .from('audit_clusters')
    .select('canonical_key, canonical_topic')
    .eq('audit_id', auditId);

  if (!clusters || clusters.length === 0) {
    console.log('  No audit_clusters found. Skipping Phase 4c.');
    return;
  }
  console.log(`  ${clusters.length} clusters`);

  // 3. Paginated fetch: keywords with canonical_key
  const keywords: Array<{ id: string; keyword: string; canonical_key: string; ranking_url: string | null }> = [];
  {
    const PAGE_SIZE = 1000;
    let offset = 0;
    while (true) {
      const { data: page } = await sb
        .from('audit_keywords')
        .select('id, keyword, canonical_key, ranking_url')
        .eq('audit_id', auditId)
        .not('canonical_key', 'is', null)
        .range(offset, offset + PAGE_SIZE - 1);
      if (!page || page.length === 0) break;
      keywords.push(...(page as any[]));
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }
  console.log(`  ${keywords.length} keywords with canonical_key`);

  // 4. Paginated fetch: competitor_sections (client + competitor headings, Phase 4b output)
  const sections: Array<{ canonical_key: string; heading_text: string; is_client: boolean }> = [];
  {
    const PAGE_SIZE = 1000;
    let offset = 0;
    while (true) {
      const { data: page } = await sb
        .from('competitor_sections')
        .select('canonical_key, heading_text, is_client')
        .eq('audit_id', auditId)
        .range(offset, offset + PAGE_SIZE - 1);
      if (!page || page.length === 0) break;
      sections.push(...(page as any[]));
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }
  console.log(`  ${sections.length} competitor_sections rows (${sections.filter((s) => s.is_client).length} client)`);

  // 5. Load page metadata (disk CSV primary, agent_technical_pages fallback)
  const { pages: pageMeta, source: metaSource } = await loadPageMeta(sb, auditId, domain);
  console.log(`  ${pageMeta.size} crawled pages loaded (source: ${metaSource})`);

  // 6. Build the site-wide client corpus:
  //    all client headings (any cluster) + one "{title} | {h1}" per crawled page
  const clientCorpus: CorpusText[] = [];
  const seenClientHeadings = new Set<string>();
  for (const s of sections) {
    if (!s.is_client) continue;
    const norm = s.heading_text.toLowerCase().trim().replace(/\s+/g, ' ');
    if (seenClientHeadings.has(norm)) continue;
    seenClientHeadings.add(norm);
    clientCorpus.push({
      text: s.heading_text,
      contentId: headingContentId('client', s.canonical_key, s.heading_text),
    });
  }
  for (const [normUrl, meta] of pageMeta) {
    const text = [meta.title, meta.h1].map((s) => (s ?? '').trim()).filter(Boolean).join(' | ');
    if (!text) continue;
    clientCorpus.push({ text, contentId: `client_page:${normUrl}` });
  }
  console.log(`  Client corpus: ${clientCorpus.length} texts (${seenClientHeadings.size} headings + page titles)`);

  // Group keywords + competitor headings by cluster
  const keywordsByCluster = new Map<string, DensityKeyword[]>();
  for (const k of keywords) {
    const arr = keywordsByCluster.get(k.canonical_key) ?? [];
    arr.push({ id: k.id, keyword: k.keyword });
    keywordsByCluster.set(k.canonical_key, arr);
  }

  const compByCluster = new Map<string, CorpusText[]>();
  {
    const seen = new Set<string>();
    for (const s of sections) {
      if (s.is_client) continue;
      const norm = `${s.canonical_key}::${s.heading_text.toLowerCase().trim().replace(/\s+/g, ' ')}`;
      if (seen.has(norm)) continue;
      seen.add(norm);
      const arr = compByCluster.get(s.canonical_key) ?? [];
      arr.push({
        text: s.heading_text,
        contentId: headingContentId('comp', s.canonical_key, s.heading_text),
      });
      compByCluster.set(s.canonical_key, arr);
    }
  }

  // 7. Per cluster: compute density + denormalize onto audit_clusters
  console.log('\n  Computing coverage density...');
  let scored = 0;
  let skipped = 0;
  const allBorderline: Array<{ cluster: string; keyword: string; match: string; similarity: number }> = [];

  for (const cluster of clusters) {
    const key = cluster.canonical_key;
    if (!key) continue;

    const result = await computeCoverageDensity(
      key,
      keywordsByCluster.get(key) ?? [],
      clientCorpus,
      compByCluster.get(key) ?? [],
      threshold,
    );

    for (const b of result.borderline) {
      allBorderline.push({ cluster: key, keyword: b.keyword, match: b.best_client_match, similarity: b.similarity });
    }

    if (result.density_status !== 'scored') {
      console.log(`    ${key}: ${result.density_status}`);
      skipped++;
      continue;
    }

    const compLabel = result.competitor_density_score != null ? `${result.competitor_density_score}%` : 'n/a';
    console.log(`    ${key}: client ${result.density_score}% vs competitor ${compLabel} (${result.covered_keywords}/${result.keyword_count} keywords)`);

    const { error } = await (sb as any)
      .from('audit_clusters')
      .update({
        density_score: result.density_score,
        competitor_density_score: result.competitor_density_score,
        density_updated_at: new Date().toISOString(),
      })
      .eq('audit_id', auditId)
      .eq('canonical_key', key);

    if (error) {
      console.log(`  Warning: audit_clusters density update failed for ${key}: ${error.message}`);
    } else {
      scored++;
    }
  }

  console.log(`  Density: ${scored} clusters scored, ${skipped} skipped`);

  // Borderline log for threshold tuning (0.72–0.83 band)
  if (allBorderline.length > 0) {
    console.log(`\n  Borderline matches (${allBorderline.length}) for threshold tuning:`);
    for (const b of allBorderline.slice(0, 30)) {
      console.log(`    [${b.similarity.toFixed(3)}] ${b.cluster} :: "${b.keyword}" ↔ "${b.match}"`);
    }
    if (allBorderline.length > 30) console.log(`    ... and ${allBorderline.length - 30} more`);
  }

  // 8. Cannibalization detection
  if (skipCannibalization) {
    console.log('\n  Skipping cannibalization detection (--skip-cannibalization)');
    console.log(`\n  Phase 4c complete`);
    return;
  }

  console.log('\n  Detecting cannibalization...');
  const clientHost = normalizeUrl(domain).split('/')[0];

  const clusterUrls = new Map<string, string[]>();
  for (const k of keywords) {
    if (!k.ranking_url) continue;
    const norm = normalizeUrl(k.ranking_url);
    if (!norm.startsWith(clientHost)) continue; // client pages only
    const arr = clusterUrls.get(k.canonical_key) ?? [];
    arr.push(norm);
    clusterUrls.set(k.canonical_key, arr);
  }

  const multiUrlClusters = [...clusterUrls.entries()].filter(([, urls]) => new Set(urls).size >= 2);
  console.log(`  ${multiUrlClusters.length} clusters with 2+ distinct client URLs`);

  const pairs = await detectCannibalization(new Map(multiUrlClusters), pageMeta);

  // Replace warnings: DELETE then batch INSERT (current state only)
  const { error: delErr } = await (sb as any)
    .from('cannibalization_warnings')
    .delete()
    .eq('audit_id', auditId);
  if (delErr) console.log(`  Warning: failed to clear cannibalization_warnings: ${delErr.message}`);

  if (pairs.length > 0) {
    const rows = pairs.map((p) => ({
      audit_id: auditId,
      canonical_key: p.canonical_key,
      page_a_url: p.page_a_url,
      page_b_url: p.page_b_url,
      similarity: p.similarity,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await (sb as any).from('cannibalization_warnings').insert(batch);
      if (error) console.log(`  Warning: cannibalization_warnings insert failed: ${error.message}`);
    }
    console.log(`  ${pairs.length} cannibalization pairs flagged:`);
    for (const p of pairs.slice(0, 10)) {
      console.log(`    [${p.similarity.toFixed(3)}] ${p.canonical_key}: ${p.page_a_url} ↔ ${p.page_b_url}`);
    }
  } else {
    console.log('  No cannibalization conflicts detected');
  }

  console.log(`\n  Phase 4c complete: ${scored} clusters scored, ${pairs.length} cannibalization warnings`);
}

main().catch((err) => {
  console.error('Phase 4c failed:', err);
  process.exit(1);
});
