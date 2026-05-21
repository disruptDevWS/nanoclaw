/**
 * ima-monthly-analysis.ts — One-shot data extraction for IMA monthly analysis.
 *
 * Produces four CSV files:
 *   1. gsc_monthly_by_page.csv — Clicks, impressions, CTR, position by URL by month (12 months)
 *   2. gsc_top_queries.csv — Top 200 queries by clicks (full 12-month period)
 *   3. ga4_sessions_by_channel_by_month.csv — Sessions by channel group by month
 *   4. ga4_landing_page_by_month.csv — Sessions by landing page by month
 *
 * Usage:
 *   cd forge-os-pipeline && npx tsx scripts/ima-monthly-analysis.ts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { getServiceAccountAccessToken, getAnalyticsConnection } from './google-auth.js';

// ============================================================
// Config
// ============================================================

const IMA_AUDIT_ID = '08409ae8-28ab-4a34-b92c-2c92f73e5af7';
const OUTPUT_DIR = path.resolve(process.cwd(), 'audits/ima-monthly-analysis');

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

// 12-month window: June 2025 through May 2026
// (May 2026 GSC data is delayed ~3 days, so end at May 17 to get final data)
function getMonthRanges(): Array<{ label: string; start: string; end: string }> {
  const ranges: Array<{ label: string; start: string; end: string }> = [];
  const now = new Date();
  // Go back 12 months from current month
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth(); // 0-indexed
    const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    // Last day of month
    const lastDay = new Date(year, month + 1, 0).getDate();
    let end = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    // For the current month, cap at 3 days ago for GSC data finalization
    if (i === 0) {
      const threeDaysAgo = new Date(now);
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
      end = threeDaysAgo.toISOString().slice(0, 10);
    }
    const label = `${year}-${String(month + 1).padStart(2, '0')}`;
    ranges.push({ label, start, end });
  }
  return ranges;
}

function getFullPeriod(): { start: string; end: string } {
  const ranges = getMonthRanges();
  return { start: ranges[0].start, end: ranges[ranges.length - 1].end };
}

// ============================================================
// .env loader
// ============================================================

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
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
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

// ============================================================
// CSV helpers
// ============================================================

function escapeCsv(val: string | number): string {
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCsv(filename: string, headers: string[], rows: Array<Record<string, string | number>>) {
  const filePath = path.join(OUTPUT_DIR, filename);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsv(row[h] ?? '')).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n'));
  console.log(`  Written: ${filePath} (${rows.length} rows)`);
}

// ============================================================
// 1. GSC Monthly Rollup by Page
// ============================================================

async function fetchGscMonthlyByPage(propertyUrl: string, token: string) {
  console.log('\n=== Dataset 1: GSC Monthly Rollup by Page ===\n');

  const months = getMonthRanges();
  const encodedProperty = encodeURIComponent(propertyUrl);
  const apiBase = `https://www.googleapis.com/webmasters/v3/sites/${encodedProperty}/searchAnalytics/query`;

  const allRows: Array<Record<string, string | number>> = [];

  for (const month of months) {
    console.log(`  Fetching ${month.label} (${month.start} to ${month.end})...`);

    const resp = await fetch(apiBase, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        startDate: month.start,
        endDate: month.end,
        dimensions: ['page'],
        rowLimit: 5000,
        dataState: 'final',
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.warn(`  Failed for ${month.label}: ${errText}`);
      continue;
    }

    const data = await resp.json();
    const rows = data.rows ?? [];
    console.log(`  ${month.label}: ${rows.length} pages`);

    for (const row of rows) {
      const fullUrl: string = row.keys[0];
      let pagePath: string;
      try {
        pagePath = new URL(fullUrl).pathname.replace(/\/+$/, '') || '/';
      } catch {
        pagePath = fullUrl;
      }

      allRows.push({
        month: month.label,
        page_url: pagePath,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: Number((row.ctr * 100).toFixed(2)),
        avg_position: Number(row.position.toFixed(1)),
      });
    }

    // Rate limit courtesy
    await new Promise((r) => setTimeout(r, 200));
  }

  writeCsv('gsc_monthly_by_page.csv', ['month', 'page_url', 'clicks', 'impressions', 'ctr', 'avg_position'], allRows);
  return allRows;
}

// ============================================================
// 2. GSC Top Queries (Full Period)
// ============================================================

async function fetchGscTopQueries(propertyUrl: string, token: string) {
  console.log('\n=== Dataset 2: GSC Top Queries by Clicks ===\n');

  const period = getFullPeriod();
  const encodedProperty = encodeURIComponent(propertyUrl);
  const apiBase = `https://www.googleapis.com/webmasters/v3/sites/${encodedProperty}/searchAnalytics/query`;

  console.log(`  Period: ${period.start} to ${period.end}`);

  // Fetch top 200 queries
  const resp = await fetch(apiBase, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      startDate: period.start,
      endDate: period.end,
      dimensions: ['query'],
      rowLimit: 200,
      dataState: 'final',
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`GSC top queries failed (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  const rows = data.rows ?? [];
  console.log(`  Got ${rows.length} queries`);

  const allRows: Array<Record<string, string | number>> = rows.map((row: any) => ({
    query: row.keys[0],
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: Number((row.ctr * 100).toFixed(2)),
    avg_position: Number(row.position.toFixed(1)),
  }));

  writeCsv('gsc_top_queries.csv', ['query', 'clicks', 'impressions', 'ctr', 'avg_position'], allRows);

  // Also fetch query × page mapping for the top queries
  console.log('  Fetching query × page mapping...');
  const qpResp = await fetch(apiBase, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      startDate: period.start,
      endDate: period.end,
      dimensions: ['query', 'page'],
      rowLimit: 5000,
      dataState: 'final',
    }),
  });

  if (qpResp.ok) {
    const qpData = await qpResp.json();
    const qpRows = (qpData.rows ?? []).map((row: any) => {
      let pagePath: string;
      try {
        pagePath = new URL(row.keys[1]).pathname.replace(/\/+$/, '') || '/';
      } catch {
        pagePath = row.keys[1];
      }
      return {
        query: row.keys[0],
        page_url: pagePath,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: Number((row.ctr * 100).toFixed(2)),
        avg_position: Number(row.position.toFixed(1)),
      };
    });
    writeCsv('gsc_query_page_mapping.csv', ['query', 'page_url', 'clicks', 'impressions', 'ctr', 'avg_position'], qpRows);
  }

  return allRows;
}

// ============================================================
// 3. GA4 Sessions by Channel by Month
// ============================================================

async function fetchGa4SessionsByChannel(propertyId: string, token: string) {
  console.log('\n=== Dataset 3: GA4 Sessions by Channel by Month ===\n');

  const period = getFullPeriod();
  const apiUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;

  console.log(`  Period: ${period.start} to ${period.end}`);

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      dateRanges: [{ startDate: period.start, endDate: period.end }],
      dimensions: [
        { name: 'yearMonth' },
        { name: 'sessionDefaultChannelGroup' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'engagedSessions' },
        { name: 'keyEvents' },
        { name: 'totalRevenue' },
      ],
      limit: 10000,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    // Retry with conversions if keyEvents rejected
    if (errText.includes('keyEvents')) {
      console.log('  Retrying with "conversions" metric...');
      const resp2 = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          dateRanges: [{ startDate: period.start, endDate: period.end }],
          dimensions: [
            { name: 'yearMonth' },
            { name: 'sessionDefaultChannelGroup' },
          ],
          metrics: [
            { name: 'sessions' },
            { name: 'engagedSessions' },
            { name: 'conversions' },
            { name: 'totalRevenue' },
          ],
          limit: 10000,
        }),
      });
      if (!resp2.ok) {
        const errText2 = await resp2.text();
        throw new Error(`GA4 channel report failed (${resp2.status}): ${errText2}`);
      }
      return processChannelResponse(await resp2.json());
    }
    throw new Error(`GA4 channel report failed (${resp.status}): ${errText}`);
  }

  return processChannelResponse(await resp.json());
}

function processChannelResponse(data: any) {
  const rows = data.rows ?? [];
  console.log(`  Got ${rows.length} channel×month rows`);

  const allRows = rows.map((row: any) => {
    const ym = row.dimensionValues[0].value; // e.g. "202506"
    const month = `${ym.slice(0, 4)}-${ym.slice(4, 6)}`;
    return {
      month,
      channel_group: row.dimensionValues[1].value,
      sessions: parseInt(row.metricValues[0].value) || 0,
      engaged_sessions: parseInt(row.metricValues[1].value) || 0,
      key_events: parseInt(row.metricValues[2].value) || 0,
      revenue: parseFloat(row.metricValues[3].value) || 0,
    };
  });

  // Sort by month, then sessions desc
  allRows.sort((a: any, b: any) => a.month.localeCompare(b.month) || b.sessions - a.sessions);

  writeCsv('ga4_sessions_by_channel_by_month.csv',
    ['month', 'channel_group', 'sessions', 'engaged_sessions', 'key_events', 'revenue'],
    allRows);

  return allRows;
}

// ============================================================
// 4. GA4 Landing Page by Month
// ============================================================

async function fetchGa4LandingPageByMonth(propertyId: string, token: string) {
  console.log('\n=== Dataset 4: GA4 Landing Page by Month ===\n');

  const period = getFullPeriod();
  const apiUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;

  console.log(`  Period: ${period.start} to ${period.end}`);

  const resp = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      dateRanges: [{ startDate: period.start, endDate: period.end }],
      dimensions: [
        { name: 'yearMonth' },
        { name: 'landingPage' },
        { name: 'sessionDefaultChannelGroup' },
      ],
      metrics: [
        { name: 'sessions' },
        { name: 'engagedSessions' },
        { name: 'keyEvents' },
      ],
      limit: 10000,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    if (errText.includes('keyEvents')) {
      console.log('  Retrying with "conversions" metric...');
      const resp2 = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          dateRanges: [{ startDate: period.start, endDate: period.end }],
          dimensions: [
            { name: 'yearMonth' },
            { name: 'landingPage' },
            { name: 'sessionDefaultChannelGroup' },
          ],
          metrics: [
            { name: 'sessions' },
            { name: 'engagedSessions' },
            { name: 'conversions' },
          ],
          limit: 10000,
        }),
      });
      if (!resp2.ok) {
        const errText2 = await resp2.text();
        throw new Error(`GA4 landing page report failed (${resp2.status}): ${errText2}`);
      }
      return processLandingPageResponse(await resp2.json());
    }
    throw new Error(`GA4 landing page report failed (${resp.status}): ${errText}`);
  }

  return processLandingPageResponse(await resp.json());
}

function processLandingPageResponse(data: any) {
  const rows = data.rows ?? [];
  console.log(`  Got ${rows.length} landing page×month rows`);

  const allRows = rows.map((row: any) => {
    const ym = row.dimensionValues[0].value;
    const month = `${ym.slice(0, 4)}-${ym.slice(4, 6)}`;
    const landingPage = (row.dimensionValues[1].value || '/').replace(/\/+$/, '') || '/';
    return {
      month,
      landing_page: landingPage,
      channel_group: row.dimensionValues[2].value,
      sessions: parseInt(row.metricValues[0].value) || 0,
      engaged_sessions: parseInt(row.metricValues[1].value) || 0,
      key_events: parseInt(row.metricValues[2].value) || 0,
    };
  });

  // Sort by month, then sessions desc
  allRows.sort((a: any, b: any) => a.month.localeCompare(b.month) || b.sessions - a.sessions);

  writeCsv('ga4_landing_page_by_month.csv',
    ['month', 'landing_page', 'channel_group', 'sessions', 'engaged_sessions', 'key_events'],
    allRows);

  return allRows;
}

// ============================================================
// Main
// ============================================================

async function main() {
  loadEnv();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');

  const sb = createClient(supabaseUrl, supabaseKey);

  // Get analytics connection for IMA
  const connection = await getAnalyticsConnection(sb, IMA_AUDIT_ID);
  if (!connection) throw new Error('No active analytics connection for IMA');

  console.log(`\n=== IMA Monthly Analysis Data Extraction ===`);
  console.log(`  GSC Property: ${connection.gsc_property_url}`);
  console.log(`  GA4 Property: ${connection.ga4_property_id}`);

  const months = getMonthRanges();
  console.log(`  Period: ${months[0].label} to ${months[months.length - 1].label} (12 months)`);

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Get tokens
  const gscToken = await getServiceAccountAccessToken([GSC_SCOPE]);
  const ga4Token = await getServiceAccountAccessToken([GA4_SCOPE]);

  // Run all four extractions
  if (connection.gsc_property_url) {
    await fetchGscMonthlyByPage(connection.gsc_property_url, gscToken);
    await fetchGscTopQueries(connection.gsc_property_url, gscToken);
  } else {
    console.warn('\n  No GSC property configured — skipping GSC datasets');
  }

  if (connection.ga4_property_id) {
    await fetchGa4SessionsByChannel(connection.ga4_property_id, ga4Token);
    await fetchGa4LandingPageByMonth(connection.ga4_property_id, ga4Token);
  } else {
    console.warn('\n  No GA4 property configured — skipping GA4 datasets');
  }

  console.log(`\n=== Done. Output in: ${OUTPUT_DIR} ===\n`);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}\n`);
  process.exit(1);
});
