/**
 * ima-june-report-pull.ts — Pull exactly the GA4 + GSC tokens needed for the
 * Forge Search Report (June 2026 vs May 2026). Hardcodes IMA property IDs from
 * the report template; only needs ADC (no Supabase).
 *
 * Usage: cd forge-os-pipeline && npx tsx scripts/ima-june-report-pull.ts
 */

import * as fs from 'node:fs';
import { getServiceAccountAccessToken } from './google-auth.js';

const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

const IMA_GA4 = '358230005';
const IMA_GSC = 'https://www.idahomedicalacademy.com/';

// SMA GSC — try both URL-prefix and domain-property forms
const SMA_GSC_CANDIDATES = [
  'https://www.summitmedicalacademy.com/',
  'sc-domain:summitmedicalacademy.com',
  'https://summitmedicalacademy.com/',
];

const MONTHS = {
  may: { start: '2026-05-01', end: '2026-05-31' },
  june: { start: '2026-06-01', end: '2026-06-30' },
};

const KEY_EVENTS = ['purchase', 'purchase_cpr', 'contact_form_submit', 'click_phone', 'cta_click'];

const COHORTS: Record<string, RegExp> = {
  EMT: /emt|aemt/i,
  Phlebotomy: /phleb/i,
  'Medical Assistant': /medical assistant|\bma\b/i,
  'CPR/ACLS/PALS': /cpr|\bbls\b|acls|pals|first aid|aha/i,
};

// Landing-page path → cohort (for GA4 organic conversions)
const PATH_COHORTS: Array<[string, RegExp]> = [
  ['EMT', /emt/i],
  ['Phlebotomy', /phleb/i],
  ['Medical Assistant', /medical-assistant|\/ma[-\/]/i],
  ['CPR/ACLS/PALS', /cpr|bls|acls|pals|first-aid|aha/i],
];

async function ga4(propertyId: string, token: string, body: any): Promise<any> {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`GA4 ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

async function gsc(property: string, token: string, body: any): Promise<any> {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`GSC ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

// --- GA4: event counts + value by event, both months ---
async function ga4EventCounts(token: string) {
  const out: Record<string, Record<string, { count: number; value: number }>> = {};
  for (const [label, r] of Object.entries(MONTHS)) {
    const data = await ga4(IMA_GA4, token, {
      dateRanges: [{ startDate: r.start, endDate: r.end }],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }, { name: 'eventValue' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', inListFilter: { values: KEY_EVENTS } },
      },
      limit: 100,
    });
    out[label] = {};
    for (const row of data.rows ?? []) {
      out[label][row.dimensionValues[0].value] = {
        count: parseInt(row.metricValues[0].value) || 0,
        value: parseFloat(row.metricValues[1].value) || 0,
      };
    }
  }
  return out;
}

// --- GA4: revenue by program_name (June, purchase only) ---
async function ga4RevenueByProgram(token: string) {
  const candidates = ['customEvent:program_name', 'customEvent:program', 'customEvent:program_title'];
  for (const dim of candidates) {
    try {
      const data = await ga4(IMA_GA4, token, {
        dateRanges: [{ startDate: MONTHS.june.start, endDate: MONTHS.june.end }],
        dimensions: [{ name: dim }],
        metrics: [{ name: 'eventValue' }, { name: 'eventCount' }],
        dimensionFilter: {
          filter: { fieldName: 'eventName', stringFilter: { value: 'purchase' } },
        },
        limit: 50,
      });
      const rows = (data.rows ?? []).map((row: any) => ({
        program: row.dimensionValues[0].value,
        value: parseFloat(row.metricValues[0].value) || 0,
        count: parseInt(row.metricValues[1].value) || 0,
      }));
      return { dimension: dim, rows };
    } catch (e: any) {
      // try next candidate
    }
  }
  return { dimension: null, rows: [], error: 'no program_name custom dimension resolved' };
}

// --- GA4: organic conversions by landing page (June) ---
async function ga4OrganicConvByLanding(token: string) {
  const metricName = 'keyEvents';
  let data;
  try {
    data = await ga4(IMA_GA4, token, {
      dateRanges: [{ startDate: MONTHS.june.start, endDate: MONTHS.june.end }],
      dimensions: [{ name: 'landingPagePlusQueryString' }, { name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: metricName }],
      dimensionFilter: {
        filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { value: 'Organic Search' } },
      },
      limit: 10000,
    });
  } catch (e: any) {
    data = await ga4(IMA_GA4, token, {
      dateRanges: [{ startDate: MONTHS.june.start, endDate: MONTHS.june.end }],
      dimensions: [{ name: 'landingPagePlusQueryString' }, { name: 'sessionDefaultChannelGroup' }],
      metrics: [{ name: 'conversions' }],
      dimensionFilter: {
        filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { value: 'Organic Search' } },
      },
      limit: 10000,
    });
  }
  const byCohort: Record<string, number> = {};
  const raw: Array<{ page: string; conv: number }> = [];
  for (const row of data.rows ?? []) {
    const page = row.dimensionValues[0].value || '';
    const conv = parseFloat(row.metricValues[0].value) || 0;
    raw.push({ page, conv });
    for (const [cohort, re] of PATH_COHORTS) {
      if (re.test(page)) {
        byCohort[cohort] = (byCohort[cohort] || 0) + conv;
        break;
      }
    }
  }
  return { byCohort, raw: raw.filter((r) => r.conv > 0).sort((a, b) => b.conv - a.conv).slice(0, 40) };
}

// --- GSC: query-level per month → cohort clicks + impression-weighted position ---
async function gscCohorts(token: string) {
  const out: Record<string, Record<string, { clicks: number; impressions: number; wpos: number; pos: number }>> = {};
  for (const [label, r] of Object.entries(MONTHS)) {
    const data = await gsc(IMA_GSC, token, {
      startDate: r.start,
      endDate: r.end,
      dimensions: ['query'],
      rowLimit: 25000,
      dataState: 'final',
    });
    const agg: Record<string, { clicks: number; impressions: number; wpos: number }> = {};
    for (const k of Object.keys(COHORTS)) agg[k] = { clicks: 0, impressions: 0, wpos: 0 };
    for (const row of data.rows ?? []) {
      const q = row.keys[0] as string;
      for (const [cohort, re] of Object.entries(COHORTS)) {
        if (re.test(q)) {
          agg[cohort].clicks += row.clicks;
          agg[cohort].impressions += row.impressions;
          agg[cohort].wpos += row.position * row.impressions;
          break;
        }
      }
    }
    out[label] = {};
    for (const [cohort, a] of Object.entries(agg)) {
      out[label][cohort] = {
        clicks: a.clicks,
        impressions: a.impressions,
        wpos: a.wpos,
        pos: a.impressions ? Number((a.wpos / a.impressions).toFixed(1)) : 0,
      };
    }
  }
  return out;
}

// --- GSC: site totals per month (for SMA + IMA sanity) ---
async function gscTotals(property: string, token: string) {
  const out: Record<string, any> = {};
  for (const [label, r] of Object.entries(MONTHS)) {
    try {
      const data = await gsc(property, token, {
        startDate: r.start,
        endDate: r.end,
        dimensions: [],
        dataState: 'final',
      });
      const row = (data.rows ?? [])[0];
      out[label] = row
        ? { clicks: row.clicks, impressions: row.impressions, ctr: Number((row.ctr * 100).toFixed(2)), position: Number(row.position.toFixed(1)) }
        : { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    } catch (e: any) {
      out[label] = { error: e.message };
    }
  }
  return out;
}

async function main() {
  const gscToken = await getServiceAccountAccessToken([GSC_SCOPE]);
  const ga4Token = await getServiceAccountAccessToken([GA4_SCOPE]);

  const result: any = { pulledFor: 'IMA Forge Search Report — June 2026 vs May 2026', ima: {}, sma: {} };

  console.log('Pulling GA4 event counts...');
  result.ima.ga4_events = await ga4EventCounts(ga4Token);

  console.log('Pulling GA4 revenue by program...');
  result.ima.ga4_revenue_by_program = await ga4RevenueByProgram(ga4Token);

  console.log('Pulling GA4 organic conversions by landing page...');
  try {
    result.ima.ga4_organic_conv = await ga4OrganicConvByLanding(ga4Token);
  } catch (e: any) {
    result.ima.ga4_organic_conv = { error: e.message };
  }

  console.log('Pulling GSC cohort clicks/position...');
  result.ima.gsc_cohorts = await gscCohorts(gscToken);

  console.log('Pulling IMA GSC totals...');
  result.ima.gsc_totals = await gscTotals(IMA_GSC, gscToken);

  console.log('Pulling SMA GSC totals (trying property forms)...');
  for (const cand of SMA_GSC_CANDIDATES) {
    const totals = await gscTotals(cand, gscToken);
    const ok = !totals.june?.error && !totals.may?.error;
    result.sma[cand] = totals;
    if (ok) {
      result.sma._resolved = cand;
      break;
    }
  }

  const outPath = '/home/forgegrowth/ima-landing-pages/tmp/ima-june-report-data.json';
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\nWritten: ${outPath}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
