#!/usr/bin/env npx tsx
/**
 * backfill-optimization-scores.ts — One-time backfill of
 * agent_technical_pages.optimization_profile / optimization_score (migration 037)
 * for audits crawled BEFORE the scoring layer shipped (2026-07-04).
 *
 * No re-crawl needed: scoreCrawlRow() consumes exactly the fields syncDwight
 * already persisted as structured columns (+ crawl_data overflow). This script
 * reconstructs the pseudo-CSV row shape from those columns and scores in place.
 *
 * Usage:
 *   npx tsx scripts/backfill-optimization-scores.ts            # only rows with NULL score
 *   npx tsx scripts/backfill-optimization-scores.ts --all      # recompute everything
 *   npx tsx scripts/backfill-optimization-scores.ts --dry-run  # report, no writes
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { scoreCrawlRow } from '../src/agents/page-audit/score-page.js';

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
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
    return env;
  }
  return Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>;
}

async function main() {
  const all = process.argv.includes('--all');
  const dryRun = process.argv.includes('--dry-run');
  const env = loadEnv();
  const sb = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

  // Paginated fetch
  const rows: any[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  while (true) {
    let q = (sb as any)
      .from('agent_technical_pages')
      .select('id, audit_id, url, status_code, word_count, title, h1, meta_description, indexability, inlinks_count, outlinks_count, crawl_data')
      .order('id')
      .range(offset, offset + PAGE_SIZE - 1);
    if (!all) q = q.is('optimization_score', null);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  console.log(`[backfill] ${rows.length} rows to score${all ? ' (--all)' : ' (NULL score only)'}${dryRun ? ' [DRY RUN]' : ''}`);

  const byAudit = new Map<string, { count: number; scoreSum: number }>();
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    await Promise.all(
      batch.map(async (r) => {
        const cd = (r.crawl_data ?? {}) as Record<string, any>;
        // Reconstruct the pseudo-CSV shape scoreCrawlRow expects
        const pseudoRow: Record<string, string> = {
          'Status Code': r.status_code != null ? String(r.status_code) : '',
          'Indexability': r.indexability ?? '',
          'Title 1': r.title ?? '',
          'Meta Description 1': r.meta_description ?? '',
          'H1-1': r.h1 ?? '',
          'Word Count': r.word_count != null ? String(r.word_count) : '',
          'Inlinks': r.inlinks_count != null ? String(r.inlinks_count) : '',
          'Outlinks': r.outlinks_count != null ? String(r.outlinks_count) : '',
          'Canonical Link Element 1': String(cd['Canonical Link Element 1'] ?? ''),
          'Schema Type 1': String(cd['Schema Type 1'] ?? cd['Schema.org Type 1'] ?? ''),
        };
        const profile = scoreCrawlRow(pseudoRow);

        const agg = byAudit.get(r.audit_id) ?? { count: 0, scoreSum: 0 };
        agg.count++;
        agg.scoreSum += profile.score;
        byAudit.set(r.audit_id, agg);

        if (dryRun) return;
        const { error } = await (sb as any)
          .from('agent_technical_pages')
          .update({ optimization_profile: profile, optimization_score: profile.score })
          .eq('id', r.id);
        if (error) {
          failed++;
          console.warn(`[backfill] update failed for ${r.url}: ${error.message}`);
        } else {
          updated++;
        }
      }),
    );
    if ((i / 20) % 10 === 0 && i > 0) console.log(`[backfill] ${i}/${rows.length}...`);
  }

  console.log(`[backfill] Done: ${updated} updated, ${failed} failed, ${byAudit.size} audits`);
  for (const [auditId, agg] of byAudit) {
    console.log(`  ${auditId}: ${agg.count} pages, avg floor ${(agg.scoreSum / agg.count).toFixed(1)}`);
  }
}

main().catch((err) => {
  console.error(`[backfill] FATAL: ${err.message}`);
  process.exit(1);
});
