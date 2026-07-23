/**
 * ima-yoy-gsc-pull.ts — Ad-hoc GSC Search Analytics pull for IMA YoY trend analysis.
 *
 * Four pulls against searchanalytics.query (the API has no compare mode, so each
 * period is its own call):
 *
 *   Pull 1 — trend, period B:  dimensions ["query"], last complete ~91 days
 *   Pull 2 — trend, period A:  dimensions ["query"], same calendar dates in 2025
 *   Pull 3 — mapping, period B: dimensions ["query","page"], period-B dates
 *   Pull 4 — migration dating: dimensions ["date"], ~2026-03-01 → present
 *
 * All pulls: type "web", country = usa, dataState "final", rowLimit 25000,
 * paginated on startRow until a page returns fewer than 25000 rows.
 *
 * Usage:
 *   npx tsx scripts/ima-yoy-gsc-pull.ts [--audit-id <uuid>] [--end-date YYYY-MM-DD]
 *
 * Output: audits/ima-yoy-gsc/ — raw JSON (concatenated rows) + flattened CSV per pull.
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getServiceAccountAccessToken, getAnalyticsConnection } from './google-auth.js';

// ============================================================
// Config
// ============================================================

const IMA_AUDIT_ID = '08409ae8-28ab-4a34-b92c-2c92f73e5af7';
const OUTPUT_DIR = path.resolve(process.cwd(), 'audits', 'ima-yoy-gsc');
const ROW_LIMIT = 25000;

/** Period B nominal window (overridden downward if final data lags). */
const PERIOD_B_NOMINAL_END = '2026-07-19';
const PERIOD_DAYS = 91; // inclusive, so start = end - 90 days

/** Pull 4 daily-series window. */
const DAILY_START = '2026-03-01';

// ============================================================
// CLI + env
// ============================================================

function parseArgs(): { auditId: string; endDate: string | null } {
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
  return {
    auditId: flags['audit-id'] || IMA_AUDIT_ID,
    endDate: flags['end-date'] || null,
  };
}

function loadEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env');
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val !== undefined) env[key] = val;
  }
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
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
  }
  return env;
}

// ============================================================
// Date helpers (UTC, no timezone drift)
// ============================================================

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Same calendar month/day, one year earlier. */
function shiftYear(dateStr: string, years: number): string {
  const [y, m, d] = dateStr.split('-');
  return `${Number(y) + years}-${m}-${d}`;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// ============================================================
// GSC query (paginated)
// ============================================================

interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

const US_FILTER = {
  dimensionFilterGroups: [
    {
      filters: [{ dimension: 'country', operator: 'equals', expression: 'usa' }],
    },
  ],
};

async function queryGsc(
  propertyUrl: string,
  token: string,
  body: Record<string, unknown>,
  label: string,
): Promise<GscRow[]> {
  const apiBase = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    propertyUrl,
  )}/searchAnalytics/query`;

  const all: GscRow[] = [];
  let startRow = 0;

  while (true) {
    const resp = await fetch(apiBase, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...body, rowLimit: ROW_LIMIT, startRow }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`[${label}] GSC query failed (${resp.status}) at startRow=${startRow}: ${errText}`);
    }

    const data = await resp.json();
    const rows: GscRow[] = data.rows ?? [];
    all.push(...rows);
    console.log(`    startRow=${startRow} → ${rows.length} rows (total ${all.length})`);

    if (rows.length < ROW_LIMIT) break;
    startRow += ROW_LIMIT;
  }

  return all;
}

// ============================================================
// Output helpers
// ============================================================

function escapeCsv(val: string | number): string {
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Write both raw JSON (GSC row shape, untouched) and a flattened CSV.
 * `dimNames` labels the `keys` array positions as CSV columns.
 */
function writeOutputs(name: string, dimNames: string[], rows: GscRow[], meta: Record<string, unknown>) {
  const jsonPath = path.join(OUTPUT_DIR, `${name}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ meta, rowCount: rows.length, rows }, null, 2));

  const headers = [...dimNames, 'clicks', 'impressions', 'ctr', 'position'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const cells = [
      ...dimNames.map((_, i) => escapeCsv(r.keys[i] ?? '')),
      r.clicks,
      r.impressions,
      // ctr as a raw ratio, matching the API — not a percentage
      r.ctr,
      r.position,
    ];
    lines.push(cells.join(','));
  }
  const csvPath = path.join(OUTPUT_DIR, `${name}.csv`);
  fs.writeFileSync(csvPath, lines.join('\n'));

  console.log(`  Written: ${name}.json + ${name}.csv (${rows.length} rows)`);
}

// ============================================================
// Main
// ============================================================

async function main() {
  const { auditId, endDate: endDateOverride } = parseArgs();
  const env = loadEnv();

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  }

  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const conn = await getAnalyticsConnection(sb, auditId);
  if (!conn?.gsc_property_url) {
    throw new Error(`No active GSC property on analytics_connections for audit ${auditId}`);
  }
  const propertyUrl = conn.gsc_property_url;
  console.log(`GSC property: ${propertyUrl} (domain ${conn.domain})`);

  const token = await getServiceAccountAccessToken([
    'https://www.googleapis.com/auth/webmasters.readonly',
  ]);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ----------------------------------------------------------
  // Probe: last date dataState "final" actually returns
  // ----------------------------------------------------------
  console.log('\n=== Probe: last final date ===');
  const probeRows = await queryGsc(
    propertyUrl,
    token,
    {
      startDate: addDays(todayUtc(), -30),
      endDate: todayUtc(),
      dimensions: ['date'],
      type: 'web',
      dataState: 'final',
      ...US_FILTER,
    },
    'probe',
  );
  const finalDates = probeRows.map((r) => r.keys[0]).sort();
  const lastFinal = finalDates[finalDates.length - 1];
  if (!lastFinal) throw new Error('Probe returned no dated rows — cannot determine final-data boundary.');
  console.log(`  Last final date: ${lastFinal}`);

  // Period B ends at the nominal date, or earlier if final data lags behind it.
  const periodBEnd = endDateOverride ?? (lastFinal < PERIOD_B_NOMINAL_END ? lastFinal : PERIOD_B_NOMINAL_END);
  const periodBStart = addDays(periodBEnd, -(PERIOD_DAYS - 1));
  const periodAEnd = shiftYear(periodBEnd, -1);
  const periodAStart = shiftYear(periodBStart, -1);

  console.log(`\nPeriod B: ${periodBStart} → ${periodBEnd} (${PERIOD_DAYS} days)`);
  console.log(`Period A: ${periodAStart} → ${periodAEnd} (same calendar dates, 2025)`);

  // ----------------------------------------------------------
  // Pull 1 — trend, period B
  // ----------------------------------------------------------
  console.log('\n=== Pull 1: query trend, period B ===');
  const pull1 = await queryGsc(
    propertyUrl,
    token,
    {
      startDate: periodBStart,
      endDate: periodBEnd,
      dimensions: ['query'],
      type: 'web',
      dataState: 'final',
      ...US_FILTER,
    },
    'pull1',
  );
  writeOutputs('pull1-queries-periodB', ['query'], pull1, {
    pull: 'trend period B',
    dimensions: ['query'],
    startDate: periodBStart,
    endDate: periodBEnd,
    type: 'web',
    country: 'usa',
    dataState: 'final',
    property: propertyUrl,
  });

  // ----------------------------------------------------------
  // Pull 2 — trend, period A (YoY)
  // ----------------------------------------------------------
  console.log('\n=== Pull 2: query trend, period A (2025) ===');
  const pull2 = await queryGsc(
    propertyUrl,
    token,
    {
      startDate: periodAStart,
      endDate: periodAEnd,
      dimensions: ['query'],
      type: 'web',
      dataState: 'final',
      ...US_FILTER,
    },
    'pull2',
  );
  writeOutputs('pull2-queries-periodA', ['query'], pull2, {
    pull: 'trend period A (YoY)',
    dimensions: ['query'],
    startDate: periodAStart,
    endDate: periodAEnd,
    type: 'web',
    country: 'usa',
    dataState: 'final',
    property: propertyUrl,
  });

  // ----------------------------------------------------------
  // Pull 3 — query × page mapping, period B
  // ----------------------------------------------------------
  console.log('\n=== Pull 3: query × page mapping, period B ===');
  const pull3 = await queryGsc(
    propertyUrl,
    token,
    {
      startDate: periodBStart,
      endDate: periodBEnd,
      dimensions: ['query', 'page'],
      type: 'web',
      dataState: 'final',
      ...US_FILTER,
    },
    'pull3',
  );
  writeOutputs('pull3-query-page-periodB', ['query', 'page'], pull3, {
    pull: 'query × page mapping, period B',
    dimensions: ['query', 'page'],
    startDate: periodBStart,
    endDate: periodBEnd,
    type: 'web',
    country: 'usa',
    dataState: 'final',
    property: propertyUrl,
  });

  // ----------------------------------------------------------
  // Pull 4 — daily series for migration dating
  // ----------------------------------------------------------
  console.log('\n=== Pull 4: daily series (migration dating) ===');
  const dailyEnd = todayUtc();
  const pull4 = await queryGsc(
    propertyUrl,
    token,
    {
      startDate: DAILY_START,
      endDate: dailyEnd,
      dimensions: ['date'],
      type: 'web',
      ...US_FILTER,
    },
    'pull4',
  );
  pull4.sort((a, b) => a.keys[0].localeCompare(b.keys[0]));
  writeOutputs('pull4-daily-series', ['date'], pull4, {
    pull: 'daily series for migration dating',
    dimensions: ['date'],
    startDate: DAILY_START,
    endDate: dailyEnd,
    type: 'web',
    country: 'usa',
    // no dataState filter — the tail is intentionally included so the recent
    // slope is visible; rows after `lastFinalDate` are still settling
    dataState: 'default (all)',
    lastFinalDate: lastFinal,
    property: propertyUrl,
  });

  console.log(`\nDone. Output: ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});
