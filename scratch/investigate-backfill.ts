#!/usr/bin/env npx tsx
/**
 * Investigate pages without canonical_key backfill
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

async function run() {
  // Get pages without canonical_key
  const { data: noKey, error: nkErr } = await sb
    .from('execution_pages')
    .select('url_slug, silo, status, source')
    .eq('audit_id', AUDIT_ID)
    .neq('status', 'deprecated')
    .is('canonical_key', null);
  if (nkErr) { console.error('noKey error:', nkErr); return; }

  console.log(`Pages without canonical_key: ${noKey!.length}\n`);
  for (const p of noKey!) {
    const pk = (p as any);
    console.log(`  ${pk.url_slug} | silo=${pk.silo} | source=${pk.source}`);
  }

  // Check how many total non-deprecated pages exist by source
  const { data: all } = await sb
    .from('execution_pages')
    .select('source, canonical_key, status')
    .eq('audit_id', AUDIT_ID)
    .neq('status', 'deprecated');

  const bySource: Record<string, { total: number; withKey: number }> = {};
  for (const p of all!) {
    const src = (p as any).source || 'unknown';
    if (!bySource[src]) bySource[src] = { total: 0, withKey: 0 };
    bySource[src].total++;
    if ((p as any).canonical_key) bySource[src].withKey++;
  }
  console.log('\nBackfill by source:');
  for (const [src, { total, withKey }] of Object.entries(bySource)) {
    console.log(`  ${src}: ${withKey}/${total} (${((withKey / total) * 100).toFixed(1)}%)`);
  }

  // Compare to prior pipeline run's backfill rate (check baseline)
  const baselinePages = JSON.parse(
    fs.readFileSync(
      path.join(
        import.meta.dirname,
        'pre-promotion-snapshots',
        'ima-2026-04-20',
        'execution_pages.json'
      ),
      'utf-8'
    )
  );
  const baselineTotal = baselinePages.filter(
    (p: any) => p.status !== 'deprecated'
  ).length;
  const baselineWithKey = baselinePages.filter(
    (p: any) => p.status !== 'deprecated' && p.canonical_key !== null
  ).length;
  console.log(
    `\nBaseline backfill: ${baselineWithKey}/${baselineTotal} (${((baselineWithKey / baselineTotal) * 100).toFixed(1)}%)`
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
