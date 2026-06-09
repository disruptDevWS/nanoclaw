#!/usr/bin/env npx tsx
/**
 * backfill-snapshots.ts — Backfill historical monthly GSC + GA4 snapshots.
 *
 * Pulls calendar-month data from Google APIs and writes to Supabase snapshot
 * tables with the month's last day as snapshot_date. This gives the dashboard
 * clean month-over-month period comparisons.
 *
 * Usage:
 *   npx tsx scripts/backfill-snapshots.ts --domain <domain> --months 6
 *   npx tsx scripts/backfill-snapshots.ts --domain idahomedicalacademy.com --months 4
 *   npx tsx scripts/backfill-snapshots.ts --domain summitmedicalacademy.com --months 4 --skip-gsc
 *
 * Flags:
 *   --domain <domain>   Domain to backfill (required)
 *   --months <N>        Number of complete past months to backfill (default: 6)
 *   --skip-gsc          Skip GSC backfill
 *   --skip-ga4          Skip GA4 backfill
 *   --dry-run           Print date ranges without fetching
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================================
// .env loader
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
  return Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>;
}

// ============================================================
// CLI args
// ============================================================

function parseArgs() {
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

  if (!flags.domain) {
    console.error('Usage: npx tsx scripts/backfill-snapshots.ts --domain <domain> [--months N] [--skip-gsc] [--skip-ga4] [--dry-run]');
    process.exit(1);
  }

  return {
    domain: flags.domain,
    months: parseInt(flags.months || '6'),
    skipGsc: flags['skip-gsc'] === 'true',
    skipGa4: flags['skip-ga4'] === 'true',
    dryRun: flags['dry-run'] === 'true',
  };
}

// ============================================================
// Month range generator
// ============================================================

interface MonthRange {
  startDate: string;  // YYYY-MM-DD (1st of month)
  endDate: string;    // YYYY-MM-DD (last day of month)
  snapshotDate: string; // same as endDate
  label: string;      // e.g., "Jan 2026"
}

function generateMonthRanges(count: number): MonthRange[] {
  const ranges: MonthRange[] = [];
  const now = new Date();

  for (let i = count; i >= 1; i--) {
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed

    // Go back i months
    const d = new Date(year, month - i, 1);
    const startDate = d.toISOString().slice(0, 10);

    // Last day of that month
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const endDate = lastDay.toISOString().slice(0, 10);

    const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

    ranges.push({ startDate, endDate, snapshotDate: endDate, label });
  }

  return ranges;
}

// ============================================================
// Main
// ============================================================

async function main() {
  const cliArgs = parseArgs();
  const env = loadEnv();

  // Set env vars for google-auth.ts
  if (env.GOOGLE_ADC_JSON) process.env.GOOGLE_ADC_JSON = env.GOOGLE_ADC_JSON;
  if (env.GOOGLE_APPLICATION_CREDENTIALS) process.env.GOOGLE_APPLICATION_CREDENTIALS = env.GOOGLE_APPLICATION_CREDENTIALS;

  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');

  const sb = createClient(supabaseUrl, supabaseKey);

  // Resolve audit
  const { data: audit } = await (sb as any)
    .from('audits')
    .select('id, domain, status')
    .eq('domain', cliArgs.domain)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!audit) throw new Error(`No completed audit found for domain: ${cliArgs.domain}`);
  console.log(`\n=== Backfill Snapshots: ${cliArgs.domain} (audit ${audit.id}) ===\n`);

  // Check existing snapshot dates to avoid duplicates
  const { data: existingGsc } = await (sb as any)
    .from('gsc_page_snapshots')
    .select('snapshot_date')
    .eq('audit_id', audit.id);
  const existingGscDates = new Set((existingGsc ?? []).map((r: any) => r.snapshot_date));

  const { data: existingGa4 } = await (sb as any)
    .from('ga4_page_snapshots')
    .select('snapshot_date')
    .eq('audit_id', audit.id);
  const existingGa4Dates = new Set((existingGa4 ?? []).map((r: any) => r.snapshot_date));

  const months = generateMonthRanges(cliArgs.months);
  console.log(`  Months to backfill: ${months.map((m) => m.label).join(', ')}`);
  console.log(`  Existing GSC dates: ${[...existingGscDates].sort().join(', ') || 'none'}`);
  console.log(`  Existing GA4 dates: ${[...existingGa4Dates].sort().join(', ') || 'none'}`);
  console.log();

  if (cliArgs.dryRun) {
    for (const m of months) {
      const gscSkip = existingGscDates.has(m.snapshotDate) ? ' (SKIP — exists)' : '';
      const ga4Skip = existingGa4Dates.has(m.snapshotDate) ? ' (SKIP — exists)' : '';
      console.log(`  ${m.label}: ${m.startDate} → ${m.endDate} | snapshot: ${m.snapshotDate}${gscSkip}${ga4Skip}`);
    }
    console.log('\n  Dry run — no data fetched.\n');
    return;
  }

  // Import fetch functions
  const { runGscFetch } = await import('./fetch-gsc-data.js');
  const { runGa4Fetch, runGa4EventFetch } = await import('./fetch-ga4-data.js');

  const outputBase = path.resolve(process.cwd(), 'audits', cliArgs.domain, 'backfill');

  for (const m of months) {
    console.log(`--- ${m.label} (${m.startDate} → ${m.endDate}) ---`);

    const dateOverride = { startDate: m.startDate, endDate: m.endDate, snapshotDate: m.snapshotDate };

    // GSC
    if (!cliArgs.skipGsc) {
      if (existingGscDates.has(m.snapshotDate)) {
        console.log(`  [gsc] Skipping — snapshot ${m.snapshotDate} already exists`);
      } else {
        const outputDir = path.join(outputBase, m.snapshotDate);
        const success = await runGscFetch(cliArgs.domain, audit.id, outputDir, sb, dateOverride);
        console.log(`  [gsc] ${success ? 'Done' : 'Skipped (no connection or data)'}`);
      }
    }

    // GA4 pages
    if (!cliArgs.skipGa4) {
      if (existingGa4Dates.has(m.snapshotDate)) {
        console.log(`  [ga4] Skipping — snapshot ${m.snapshotDate} already exists`);
      } else {
        const ga4DateOverride = { startDate: m.startDate, endDate: m.endDate };
        const ga4Data = await runGa4Fetch(audit.id, [], sb, ga4DateOverride);

        if (ga4Data.length > 0) {
          // Upsert ga4_page_snapshots
          const records = ga4Data.map((p: any) => ({
            audit_id: audit.id,
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
            const { error } = await (sb as any)
              .from('ga4_page_snapshots')
              .upsert(batch, { onConflict: 'audit_id,snapshot_date,page_url' });
            if (error) console.warn(`  [ga4] upsert failed: ${error.message}`);
          }
          console.log(`  [ga4] Upserted ${records.length} page snapshots`);
        } else {
          console.log(`  [ga4] No data returned`);
        }

        // GA4 events
        const ga4Events = await runGa4EventFetch(audit.id, sb, ga4DateOverride);
        if (ga4Events.length > 0) {
          const eventRecords = ga4Events.map((e: any) => ({
            audit_id: audit.id,
            snapshot_date: m.snapshotDate,
            event_name: e.event_name,
            channel_group: e.channel_group,
            event_count: e.event_count,
            event_revenue: e.event_revenue,
          }));

          const { error } = await (sb as any)
            .from('ga4_event_snapshots')
            .upsert(eventRecords, { onConflict: 'audit_id,snapshot_date,event_name,channel_group' });
          if (error) console.warn(`  [ga4-events] upsert failed: ${error.message}`);
          console.log(`  [ga4-events] Upserted ${eventRecords.length} event snapshots`);
        }
      }
    }

    // Brief pause between months to avoid rate limits
    await new Promise((r) => setTimeout(r, 3000));
    console.log();
  }

  console.log('=== Backfill complete ===\n');
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}\n`);
  process.exit(1);
});
