#!/usr/bin/env npx tsx
/**
 * backfill-keyword-difficulty.ts — One-time backfill of audit_keywords.keyword_difficulty
 * from raw DataForSEO ranked_keywords.json artifacts on disk (migration 036).
 *
 * For each domain (or all domains with artifacts), parses the LATEST
 * audits/{domain}/research/{date}/ranked_keywords.json, builds a keyword→KD map,
 * and fills keyword_difficulty on matching audit_keywords rows where it is NULL.
 * Rows without a matching artifact keyword (keyword_research seeds, synthetic
 * keywords) are left NULL — that is expected.
 *
 * Usage:
 *   npx tsx scripts/backfill-keyword-difficulty.ts                 # all domains with artifacts
 *   npx tsx scripts/backfill-keyword-difficulty.ts --domain idahomedicalacademy.com
 *   npx tsx scripts/backfill-keyword-difficulty.ts --dry-run
 *
 * Environment variables (from .env or process.env):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const AUDITS_BASE = path.resolve(process.cwd(), 'audits');

// ============================================================
// .env loader (same pattern as track-rankings.ts)
// ============================================================

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
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val !== undefined) env[key] = val;
  }
  return env;
}

// ============================================================
// Artifact discovery + parsing
// ============================================================

function rankedKeywordsFiles(domain: string): string[] {
  const researchDir = path.join(AUDITS_BASE, domain, 'research');
  if (!fs.existsSync(researchDir)) return [];
  return fs
    .readdirSync(researchDir)
    .filter((d) => fs.existsSync(path.join(researchDir, d, 'ranked_keywords.json')))
    .sort()
    .map((d) => path.join(researchDir, d, 'ranked_keywords.json'));
}

// Merge all artifact dates oldest→newest so the newest KD wins, while keywords
// that dropped out of the latest pull keep their last-known KD.
function buildKdMap(filePaths: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const filePath of filePaths) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const items: any[] = raw?.tasks?.[0]?.result?.[0]?.items ?? [];
    for (const item of items) {
      const keyword = item?.keyword_data?.keyword;
      const kd = item?.keyword_data?.keyword_properties?.keyword_difficulty;
      if (typeof keyword === 'string' && keyword && typeof kd === 'number') {
        map.set(keyword, Math.round(kd));
      }
    }
  }
  return map;
}

// ============================================================
// Backfill
// ============================================================

async function backfillDomain(
  sb: SupabaseClient,
  domain: string,
  dryRun: boolean,
): Promise<void> {
  const kwFiles = rankedKeywordsFiles(domain);
  if (kwFiles.length === 0) {
    console.log(`  [${domain}] no ranked_keywords.json artifact — skipping`);
    return;
  }

  const kdMap = buildKdMap(kwFiles);
  console.log(`  [${domain}] ${kdMap.size} keywords with KD across ${kwFiles.length} artifact(s)`);
  if (kdMap.size === 0) return;

  const { data: audits, error: auditErr } = await sb
    .from('audits')
    .select('id')
    .eq('domain', domain);
  if (auditErr) throw new Error(`audits lookup failed for ${domain}: ${auditErr.message}`);
  if (!audits || audits.length === 0) {
    console.log(`  [${domain}] no audits in DB — skipping`);
    return;
  }

  for (const audit of audits) {
    // Paginated fetch (PostgREST max-rows=1000)
    const rows: Array<{ id: string; keyword: string; keyword_difficulty: number | null }> = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await (sb as any)
        .from('audit_keywords')
        .select('id, keyword, keyword_difficulty')
        .eq('audit_id', audit.id)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`audit_keywords fetch failed for ${audit.id}: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }

    // Group ids by KD value so each distinct KD is one batched update
    const idsByKd = new Map<number, string[]>();
    let alreadySet = 0;
    let unmatched = 0;
    for (const row of rows) {
      const kd = kdMap.get(row.keyword);
      if (kd === undefined) {
        unmatched++;
        continue;
      }
      if (row.keyword_difficulty !== null) {
        alreadySet++;
        continue;
      }
      if (!idsByKd.has(kd)) idsByKd.set(kd, []);
      idsByKd.get(kd)!.push(row.id);
    }

    const toUpdate = Array.from(idsByKd.values()).reduce((s, ids) => s + ids.length, 0);
    console.log(
      `  [${domain}] audit ${audit.id}: ${rows.length} rows — ${toUpdate} to update, ${alreadySet} already set, ${unmatched} no artifact match (expected for seeds/synthetic)`,
    );

    if (dryRun || toUpdate === 0) continue;

    let updated = 0;
    for (const [kd, ids] of idsByKd) {
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const { error } = await (sb as any)
          .from('audit_keywords')
          .update({ keyword_difficulty: kd })
          .in('id', chunk);
        if (error) {
          console.warn(`  [${domain}] update failed (kd=${kd}, ${chunk.length} ids): ${error.message}`);
        } else {
          updated += chunk.length;
        }
      }
    }
    console.log(`  [${domain}] audit ${audit.id}: updated ${updated} rows`);
  }
}

// ============================================================
// CLI entry point
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const domainIdx = args.indexOf('--domain');
  const domainFilter = domainIdx >= 0 ? args[domainIdx + 1] : null;
  const dryRun = args.includes('--dry-run');

  const env = loadEnv();
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  const sb = createClient(supabaseUrl, supabaseKey);

  const domains = domainFilter
    ? [domainFilter]
    : fs
        .readdirSync(AUDITS_BASE)
        .filter((d) => fs.statSync(path.join(AUDITS_BASE, d)).isDirectory())
        .filter((d) => rankedKeywordsFiles(d).length > 0)
        .sort();

  console.log(`\n=== Keyword difficulty backfill (${dryRun ? 'DRY RUN' : 'live'}) — ${domains.length} domain(s) ===\n`);
  for (const domain of domains) {
    await backfillDomain(sb, domain, dryRun);
  }
  console.log('\nDone.\n');
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}\n`);
  process.exit(1);
});
