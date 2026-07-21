/**
 * ima-backfill-monthly-snapshots.ts — one-off backfill of clean calendar-month
 * GSC + GA4 snapshots for Idaho Medical Academy, so the /performance dashboard
 * renders a clean "Jun 1–30 vs May 1–31" period comparison.
 *
 * The dashboard derives period labels from the snapshot_date (a month-end date
 * like 2026-06-30 → "Jun 1–30"). The standard trackers stamp "today" with a
 * trailing-28-day window, which never lines up with calendar months. This script
 * pulls true calendar-month data and stamps the month-end date.
 *
 * Writes: gsc_page_snapshots, ga4_page_snapshots, ga4_event_snapshots.
 * Pre-existing rows at the target snapshot_date are deleted first (the existing
 * 05-31 rows were trailing-28-day windows, not calendar May).
 *
 * Usage:
 *   npx tsx scripts/ima-backfill-monthly-snapshots.ts [--dry]
 *   --dry : fetch + report counts only, no Supabase writes/deletes.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runGscFetch } from './fetch-gsc-data.js';
import { runGa4Fetch, runGa4EventFetch } from './fetch-ga4-data.js';

const AUDIT_ID = '08409ae8-28ab-4a34-b92c-2c92f73e5af7';
const DOMAIN = 'idahomedicalacademy.com';
const DRY = process.argv.includes('--dry');

const MONTHS = [
  { label: 'May 2026', startDate: '2026-05-01', endDate: '2026-05-31', snapshotDate: '2026-05-31' },
  { label: 'June 2026', startDate: '2026-06-01', endDate: '2026-06-30', snapshotDate: '2026-06-30' },
];

function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env');
  const env: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return { ...process.env } as Record<string, string>;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[t.slice(0, i).trim()] = v;
  }
  return env;
}

const env = loadEnv();
const sb: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const AUDITS_BASE = path.resolve(process.cwd(), 'audits', DOMAIN, 'research');

async function backfillGa4Pages(m: (typeof MONTHS)[number]) {
  const ga4Data = await runGa4Fetch(AUDIT_ID, [], sb, { startDate: m.startDate, endDate: m.endDate });
  console.log(`  [ga4-pages] ${m.label}: fetched ${ga4Data.length} pages`);
  if (DRY || ga4Data.length === 0) return ga4Data.length;

  await sb.from('ga4_page_snapshots').delete().eq('audit_id', AUDIT_ID).eq('snapshot_date', m.snapshotDate);
  const records = ga4Data.map((p) => ({
    audit_id: AUDIT_ID,
    snapshot_date: m.snapshotDate,
    page_url: p.page_url,
    total_sessions: p.total_sessions,
    total_conversions: p.total_conversions,
    total_revenue: p.total_revenue,
    organic_sessions: p.organic_sessions,
    organic_engaged_sessions: p.organic_engaged_sessions,
    organic_engagement_rate: p.organic_engagement_rate,
    organic_conversions: p.organic_conversions,
    organic_avg_session_dur: p.organic_avg_session_dur,
    organic_cr: p.organic_cr,
  }));
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    const { error } = await sb.from('ga4_page_snapshots').upsert(batch, { onConflict: 'audit_id,snapshot_date,page_url' });
    if (error) throw new Error(`ga4_page_snapshots upsert failed: ${error.message}`);
  }
  console.log(`  [ga4-pages] ${m.label}: wrote ${records.length} rows @ ${m.snapshotDate}`);
  return records.length;
}

async function backfillGa4Events(m: (typeof MONTHS)[number]) {
  const events = await runGa4EventFetch(AUDIT_ID, sb, { startDate: m.startDate, endDate: m.endDate });
  console.log(`  [ga4-events] ${m.label}: fetched ${events.length} event/channel rows`);
  if (DRY || events.length === 0) return events.length;

  await sb.from('ga4_event_snapshots').delete().eq('audit_id', AUDIT_ID).eq('snapshot_date', m.snapshotDate);
  const records = events.map((e) => ({
    audit_id: AUDIT_ID,
    snapshot_date: m.snapshotDate,
    event_name: e.event_name,
    channel_group: e.channel_group,
    event_count: e.event_count,
    event_revenue: e.event_revenue,
  }));
  const { error } = await sb.from('ga4_event_snapshots').upsert(records, { onConflict: 'audit_id,snapshot_date,event_name,channel_group' });
  if (error) throw new Error(`ga4_event_snapshots upsert failed: ${error.message}`);
  console.log(`  [ga4-events] ${m.label}: wrote ${records.length} rows @ ${m.snapshotDate}`);
  return records.length;
}

async function backfillGsc(m: (typeof MONTHS)[number]) {
  // runGscFetch handles its own delete-by-conflict upsert (audit_id,snapshot_date,page_url).
  // Delete first so stale pages at this snapshot_date don't linger.
  if (!DRY) {
    await sb.from('gsc_page_snapshots').delete().eq('audit_id', AUDIT_ID).eq('snapshot_date', m.snapshotDate);
  }
  const outDir = path.join(AUDITS_BASE, m.snapshotDate);
  if (!DRY) fs.mkdirSync(outDir, { recursive: true });
  if (DRY) {
    console.log(`  [gsc] ${m.label}: DRY — skipping runGscFetch write (would pull ${m.startDate}..${m.endDate} @ ${m.snapshotDate})`);
    return true;
  }
  const ok = await runGscFetch(DOMAIN, AUDIT_ID, outDir, sb, {
    startDate: m.startDate,
    endDate: m.endDate,
    snapshotDate: m.snapshotDate,
  });
  console.log(`  [gsc] ${m.label}: runGscFetch ${ok ? 'OK' : 'no-op'} @ ${m.snapshotDate}`);
  return ok;
}

async function main() {
  console.log(`=== IMA monthly snapshot backfill (${DRY ? 'DRY RUN' : 'LIVE'}) ===`);
  console.log(`audit_id=${AUDIT_ID} domain=${DOMAIN}\n`);
  for (const m of MONTHS) {
    console.log(`--- ${m.label} (${m.startDate} .. ${m.endDate}, stamp ${m.snapshotDate}) ---`);
    await backfillGsc(m);
    await backfillGa4Pages(m);
    await backfillGa4Events(m);
    console.log('');
  }
  console.log('Done.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e); process.exit(1); });
