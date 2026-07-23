/**
 * ima-cohort-recovery-28d.ts — GSC recovery read for a fixed 85-query cohort.
 *
 * Compares the most recent 28 days (P2) against the prior 28 days (P1) for IMA,
 * on POSITION as the primary signal (clicks/impressions are demand-contaminated
 * during peak season). The API has no compare mode, so each window is its own
 * call; each dimension set is pulled separately and paginated.
 *
 * Windows (both dataState "final" so settling data can't distort the compare):
 *   END = latest date GSC returns final data for (probed).
 *   P2  = END-27 .. END      (28 days)
 *   P1  = END-55 .. END-28   (28 days)
 *
 * Pulls (no API query filter — pull all rows, filter locally to the cohort):
 *   1. ["query"]          P1 + P2   → per-term + cohort totals
 *   2. ["query","device"] P1 + P2   → mobile vs desktop split ONLY
 *
 * Usage: npx tsx scripts/ima-cohort-recovery-28d.ts [--audit-id <uuid>] [--end-date YYYY-MM-DD]
 *
 * Outputs audits/ima-cohort-recovery/cohort_recovery_28d.csv and prints a
 * markdown summary to stdout.
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getServiceAccountAccessToken, getAnalyticsConnection } from './google-auth.js';

const IMA_AUDIT_ID = '08409ae8-28ab-4a34-b92c-2c92f73e5af7';
const OUTPUT_DIR = path.resolve(process.cwd(), 'audits', 'ima-cohort-recovery');
const ROW_LIMIT = 25000;

// ============================================================
// Cohort (85 exact terms — GSC returns queries lowercased)
// ============================================================

const COHORT = [
  'emt certification idaho', 'idaho emt course', 'online emt course', 'phlebotomy courses near me',
  'online emt course idaho', 'emt online courses', 'emt certification', 'medical assistant certification',
  'phlebotomy certification idaho', 'emt training seattle', 'emt', 'idaho emt classes',
  'online emt course washington state', 'emt certification boise', 'medical assistant programs',
  'online emt certification', 'online emt programs', 'boise emt course', 'paramedic school boise',
  'emt boise', 'online emt school', 'emt course boise', 'emt training boise', 'phlebotomy training',
  'idaho phlebotomy certification', 'cpr', 'hybrid emt courses', 'cpr training boise', 'emt course seattle',
  'online emt program', 'emt certification online', 'cpr classes boise', 'emt online course',
  'emt class online', 'emt online school', 'medical assisting programs near me', 'phlebotomy technician training',
  'sterile processing technician training', 'what happens if my nremt expired', 'iv certification classes near me',
  'online emt', 'emt course online', 'phlebotomy classes', 'emt certification seattle', 'emt programs seattle',
  'cpr class boise', 'emt online courses with certificate', 'online emt class',
  'online emt course with certificate', 'emt classes online', 'accelerated emt course near me',
  'ekg tech certification', 'emt online classes', 'phlebotomy programs near me', 'seattle emt training',
  'self paced emt course', 'emt classes seattle', 'emt courses seattle', 'emt school washington state',
  'medical assistant training program near me', 'northwest ambulance emt academy', 'seattle emt',
  'best online medical assistant programs in idaho', 'emt certificate', 'emt course washington state',
  'emt seattle', 'medical assistant certificate in idaho high school', 'medical assisting program near me',
  'pharmacy technician programs idaho', 'pharmacy technician schools idaho', 'phtls certification',
  'what can you do with a emt certification', 'emt classes', 'first aid classes near me',
  'medical assistant programs in idaho', 'phtls course', 'emt school seattle', 'get emt certified online',
  'boise phlebotomy training', 'medical assistant idaho', 'emt courses near me', 'phlebotomy training boise',
  'idaho emt training', 'emt online program', 'medical assistant programs boise',
].map((t) => t.toLowerCase());

const COHORT_SET = new Set(COHORT);

// ============================================================
// Cluster inference
// ============================================================

function inferCluster(q: string): string {
  // Order matters: check the more specific clusters before EMT, since some
  // multi-topic terms would otherwise be swallowed by a bare "emt" test.
  if (/phlebotomy/.test(q)) return 'Phlebotomy';
  if (/medical assist/.test(q)) return 'Medical Assistant';
  if (/\bcpr\b/.test(q)) return 'CPR';
  if (/\baemt\b|advanced emt/.test(q)) return 'AEMT';
  if (/\bemt\b|paramedic|nremt|phtls/.test(q)) return 'EMT';
  return 'Other';
}

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
      if (next && !next.startsWith('--')) { flags[key] = next; i++; }
      else flags[key] = 'true';
    }
  }
  return { auditId: flags['audit-id'] || IMA_AUDIT_ID, endDate: flags['end-date'] || null };
}

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[k] = v;
    }
  }
  return env;
}

// ============================================================
// Date helpers (UTC)
// ============================================================

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function todayUtc(): string { return new Date().toISOString().slice(0, 10); }

// ============================================================
// GSC query (paginated)
// ============================================================

interface GscRow { keys: string[]; clicks: number; impressions: number; ctr: number; position: number; }

const US_FILTER = {
  dimensionFilterGroups: [{ filters: [{ dimension: 'country', operator: 'equals', expression: 'usa' }] }],
};

async function queryGsc(propertyUrl: string, token: string, body: Record<string, unknown>, label: string): Promise<GscRow[]> {
  const apiBase = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(propertyUrl)}/searchAnalytics/query`;
  const all: GscRow[] = [];
  let startRow = 0;
  while (true) {
    const resp = await fetch(apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...body, rowLimit: ROW_LIMIT, startRow }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`[${label}] GSC query failed (${resp.status}) at startRow=${startRow}: ${errText}`);
    }
    const data = await resp.json();
    const rows: GscRow[] = data.rows ?? [];
    all.push(...rows);
    if (rows.length < ROW_LIMIT) break;
    startRow += ROW_LIMIT;
  }
  console.log(`  [${label}] ${all.length} rows`);
  return all;
}

// ============================================================
// Aggregation helpers
// ============================================================

interface TermMetrics { clicks: number; impressions: number; ctr: number; position: number | null; }

/** Fold ["query"] rows into a per-term map keyed by the lowercased query. */
function indexByQuery(rows: GscRow[]): Map<string, TermMetrics> {
  const m = new Map<string, TermMetrics>();
  for (const r of rows) {
    m.set(r.keys[0].toLowerCase(), {
      clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position,
    });
  }
  return m;
}

/** Impression-weighted average position over a set of {impressions, position} entries. */
function weightedPosition(entries: Array<{ impressions: number; position: number | null }>): number | null {
  let num = 0, den = 0;
  for (const e of entries) {
    if (e.position == null || e.impressions <= 0) continue;
    num += e.position * e.impressions;
    den += e.impressions;
  }
  return den > 0 ? num / den : null;
}

function median(nums: number[]): number | null {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function fmt(n: number | null, dp = 1): string {
  return n == null ? '—' : n.toFixed(dp);
}

// ============================================================
// Main
// ============================================================

async function main() {
  const { auditId, endDate: endOverride } = parseArgs();
  const env = loadEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');

  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const conn = await getAnalyticsConnection(sb, auditId);
  if (!conn?.gsc_property_url) throw new Error(`No active GSC property for audit ${auditId}`);
  const propertyUrl = conn.gsc_property_url;

  const token = await getServiceAccountAccessToken(['https://www.googleapis.com/auth/webmasters.readonly']);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // --- Probe last final date ---
  let END = endOverride;
  if (!END) {
    const probe = await queryGsc(propertyUrl, token, {
      startDate: addDays(todayUtc(), -14), endDate: todayUtc(),
      dimensions: ['date'], type: 'web', dataState: 'final', ...US_FILTER,
    }, 'probe');
    const dates = probe.map((r) => r.keys[0]).sort();
    END = dates[dates.length - 1];
    if (!END) throw new Error('Probe returned no final-dated rows.');
  }

  const P2_START = addDays(END, -27), P2_END = END;
  const P1_START = addDays(END, -55), P1_END = addDays(END, -28);

  console.error(`GSC property: ${propertyUrl}`);
  console.error(`END (last final): ${END}`);
  console.error(`P1: ${P1_START} .. ${P1_END}  |  P2: ${P2_START} .. ${P2_END}`);

  const baseFilters = { type: 'web', dataState: 'final', ...US_FILTER };

  // --- Pull 1: ["query"] for P1 and P2 ---
  const q_p1 = indexByQuery(await queryGsc(propertyUrl, token, { startDate: P1_START, endDate: P1_END, dimensions: ['query'], ...baseFilters }, 'pull1-P1'));
  const q_p2 = indexByQuery(await queryGsc(propertyUrl, token, { startDate: P2_START, endDate: P2_END, dimensions: ['query'], ...baseFilters }, 'pull1-P2'));

  // --- Pull 2: ["query","device"] for P1 and P2 ---
  const d_p1 = await queryGsc(propertyUrl, token, { startDate: P1_START, endDate: P1_END, dimensions: ['query', 'device'], ...baseFilters }, 'pull2-P1');
  const d_p2 = await queryGsc(propertyUrl, token, { startDate: P2_START, endDate: P2_END, dimensions: ['query', 'device'], ...baseFilters }, 'pull2-P2');

  // ==========================================================
  // Per-term analysis (pull 1)
  // ==========================================================
  interface Out {
    query: string; cluster: string;
    p1c: number; p2c: number; p1i: number; p2i: number;
    p1pos: number | null; p2pos: number | null;
    posDelta: number | null; status: string;
  }
  const out: Out[] = [];

  for (const term of COHORT) {
    const a = q_p1.get(term); // P1
    const b = q_p2.get(term); // P2
    const p1i = a?.impressions ?? 0, p2i = b?.impressions ?? 0;
    const p1pos = a && p1i > 0 ? a.position : null;
    const p2pos = b && p2i > 0 ? b.position : null;
    const posDelta = p1pos != null && p2pos != null ? Number((p2pos - p1pos).toFixed(2)) : null;

    // Classify. "LOST" (absent/zero in P2) takes precedence, then the page-1
    // crossing, then magnitude-based buckets on the position delta.
    let status: string;
    if (p2i === 0 || p2pos == null) {
      status = 'LOST';
    } else if (p1pos != null && p2pos < 10 && p1pos >= 10) {
      status = 'CROSSED TO PAGE 1';
    } else if (posDelta == null) {
      // In P2 but not P1 (newly ranking) — no prior baseline to measure recovery.
      status = 'NEW IN P2';
    } else if (posDelta <= -2.0) {
      status = 'RECOVERING';
    } else if (posDelta >= 2.0) {
      status = 'STILL FALLING';
    } else {
      status = 'FLAT';
    }

    out.push({
      query: term, cluster: inferCluster(term),
      p1c: a?.clicks ?? 0, p2c: b?.clicks ?? 0, p1i, p2i,
      p1pos, p2pos, posDelta, status,
    });
  }

  // --- CSV ---
  const headers = ['query', 'cluster', 'p1_clicks', 'p2_clicks', 'p1_impr', 'p2_impr', 'p1_pos', 'p2_pos', 'pos_delta', 'status'];
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(',')];
  for (const o of out) {
    lines.push([
      esc(o.query), o.cluster, o.p1c, o.p2c, o.p1i, o.p2i,
      o.p1pos == null ? '' : o.p1pos.toFixed(2),
      o.p2pos == null ? '' : o.p2pos.toFixed(2),
      o.posDelta == null ? '' : o.posDelta.toFixed(2),
      o.status,
    ].join(','));
  }
  const csvPath = path.join(OUTPUT_DIR, 'cohort_recovery_28d.csv');
  fs.writeFileSync(csvPath, lines.join('\n'));

  // ==========================================================
  // Cohort aggregates (pull 1 only — NEVER query×device)
  // ==========================================================
  const p1Entries = out.map((o) => ({ impressions: o.p1i, position: o.p1pos }));
  const p2Entries = out.map((o) => ({ impressions: o.p2i, position: o.p2pos }));
  const wP1 = weightedPosition(p1Entries), wP2 = weightedPosition(p2Entries);
  const medP1 = median(out.map((o) => o.p1pos).filter((p): p is number => p != null));
  const medP2 = median(out.map((o) => o.p2pos).filter((p): p is number => p != null));
  const clP1 = out.reduce((s, o) => s + o.p1c, 0), clP2 = out.reduce((s, o) => s + o.p2c, 0);
  const imP1 = out.reduce((s, o) => s + o.p1i, 0), imP2 = out.reduce((s, o) => s + o.p2i, 0);

  // ==========================================================
  // Device split (pull 2 only — for mobile vs desktop, not totals)
  // ==========================================================
  function deviceWeighted(rows: GscRow[], device: string): number | null {
    const entries = rows
      .filter((r) => r.keys[1]?.toUpperCase() === device && COHORT_SET.has(r.keys[0].toLowerCase()))
      .map((r) => ({ impressions: r.impressions, position: r.position }));
    return weightedPosition(entries);
  }
  const mobP1 = deviceWeighted(d_p1, 'MOBILE'), mobP2 = deviceWeighted(d_p2, 'MOBILE');
  const deskP1 = deviceWeighted(d_p1, 'DESKTOP'), deskP2 = deviceWeighted(d_p2, 'DESKTOP');
  const mobDelta = mobP1 != null && mobP2 != null ? mobP2 - mobP1 : null;
  const deskDelta = deskP1 != null && deskP2 != null ? deskP2 - deskP1 : null;

  // ==========================================================
  // Status counts + leaderboards
  // ==========================================================
  const counts: Record<string, number> = {};
  for (const o of out) counts[o.status] = (counts[o.status] ?? 0) + 1;

  const withDelta = out.filter((o) => o.posDelta != null);
  const improvers = [...withDelta].sort((a, b) => a.posDelta! - b.posDelta!).slice(0, 10);
  const fallers = [...withDelta].sort((a, b) => b.posDelta! - a.posDelta!).filter((o) => o.posDelta! > 0).slice(0, 10);
  const crossed = out.filter((o) => o.status === 'CROSSED TO PAGE 1');

  // Verdict heuristic on the clean signal (weighted + median position).
  const wImproved = wP1 != null && wP2 != null && wP1 - wP2 >= 2.0;
  const medImproved = medP1 != null && medP2 != null && medP1 - medP2 >= 1.0;
  const recovering = counts['RECOVERING'] ?? 0, falling = counts['STILL FALLING'] ?? 0;
  let verdict: string;
  if ((wImproved || medImproved) && recovering > falling) {
    verdict = 'A rebound is underway — cohort position is improving on the clean signal.';
  } else if (recovering > falling && (crossed.length > 0)) {
    verdict = 'Early rebound signs — more terms recovering than falling, but the cohort aggregate has not turned yet.';
  } else if (recovering <= falling) {
    verdict = 'No rebound visible — falling terms still outnumber recovering ones.';
  } else {
    verdict = 'Not yet — mixed movement with no decisive cohort-level improvement.';
  }

  // ==========================================================
  // Markdown summary
  // ==========================================================
  const arrow = (a: number | null, b: number | null, dp = 1, lowerBetter = true) => {
    if (a == null || b == null) return `${fmt(a, dp)} → ${fmt(b, dp)}`;
    const d = b - a;
    const better = lowerBetter ? d < 0 : d > 0;
    const sign = d > 0 ? '+' : '';
    return `${fmt(a, dp)} → ${fmt(b, dp)} (${sign}${d.toFixed(dp)}${better ? ' ✓' : ''})`;
  };

  const md: string[] = [];
  md.push(`# IMA cohort recovery — 28d over 28d\n`);
  md.push(`**Property:** ${propertyUrl}`);
  md.push(`**END (last final date):** ${END}`);
  md.push(`**P1 (prior):** ${P1_START} .. ${P1_END} · **P2 (current):** ${P2_START} .. ${P2_END}`);
  md.push(`**Cohort:** ${COHORT.length} terms · dataState=final · type=web · country=usa`);
  md.push(`Primary signal = **position** (lower is better). Clicks/impressions are demand-contaminated in peak season and shown as secondary.\n`);

  md.push(`## Cohort headline (pull 1)`);
  md.push(`- **Impression-weighted position:** ${arrow(wP1, wP2)}`);
  md.push(`- **Median per-query position:** ${arrow(medP1, medP2)}`);
  md.push(`- **Clicks (secondary):** ${clP1.toLocaleString()} → ${clP2.toLocaleString()} (${clP2 - clP1 >= 0 ? '+' : ''}${(clP2 - clP1).toLocaleString()})`);
  md.push(`- **Impressions (secondary):** ${imP1.toLocaleString()} → ${imP2.toLocaleString()}`);
  const medImprP2 = median(out.map((o) => o.p2i).filter((i) => i > 0));
  const p2present = out.filter((o) => o.p2i > 0).length;
  md.push(`- **Data depth:** ${p2present}/85 terms present in P2; median ${medImprP2?.toFixed(0)} impr/term over 28 days. This cohort is thin — trust the aggregate (weighted/median) position; treat per-term moves on <10 impressions as noise.\n`);

  md.push(`## Device differential (pull 2 — split only, not totals)`);
  md.push(`- **Mobile weighted position:** ${arrow(mobP1, mobP2)}`);
  md.push(`- **Desktop weighted position:** ${arrow(deskP1, deskP2)}`);
  // Position delta is sign-honest here: negative = improved (lower position),
  // positive = worsened. "Mobile leading" means mobile's delta is more negative
  // than desktop's, whether both improved, both worsened, or split.
  const moveWord = (d: number) => (d < 0 ? `improved ${(-d).toFixed(1)}` : d > 0 ? `worsened ${d.toFixed(1)}` : 'flat');
  let devVerdict: string;
  if (mobDelta == null || deskDelta == null) {
    devVerdict = 'Insufficient device data to judge.';
  } else if (mobDelta < deskDelta - 0.1) {
    devVerdict = `**CONFIRMS** mobile leading — mobile ${moveWord(mobDelta)} vs desktop ${moveWord(deskDelta)} positions.`;
  } else if (deskDelta < mobDelta - 0.1) {
    devVerdict = `**CONTRADICTS** the prediction — mobile is *not* leading: mobile ${moveWord(mobDelta)}, desktop ${moveWord(deskDelta)} (desktop held up better).`;
  } else {
    devVerdict = 'Mobile and desktop moved about the same — no clear leader.';
  }
  md.push(`- **Verdict:** ${devVerdict}\n`);

  md.push(`## Counts by status`);
  for (const s of ['RECOVERING', 'CROSSED TO PAGE 1', 'FLAT', 'STILL FALLING', 'LOST', 'NEW IN P2']) {
    if (counts[s]) md.push(`- ${s}: ${counts[s]}`);
  }
  md.push('');

  // Impression depth matters: with a ~13-impr median per term, single-digit
  // impression counts make a position number almost meaningless. Surface P1→P2
  // impressions in every leaderboard row so a "1.0" ranking on 1 impression
  // reads as the noise it is. Flag rows under this floor.
  const THIN = 10;
  const posCell = (o: Out) => `${fmt(o.p1pos)} → ${fmt(o.p2pos)} (${o.posDelta! > 0 ? '+' : ''}${o.posDelta!.toFixed(1)})`;
  const thinFlag = (o: Out) => (o.p1i < THIN || o.p2i < THIN) ? ' ⚠️' : '';

  md.push(`> ⚠️ = at least one window has < ${THIN} impressions, so its position is noise, not a ranking signal.\n`);

  md.push(`## Top 10 improvers (by position delta)`);
  md.push(`| query | cluster | P1→P2 pos | P1→P2 impr |`);
  md.push(`|---|---|---|---|`);
  for (const o of improvers) md.push(`| ${o.query}${thinFlag(o)} | ${o.cluster} | ${posCell(o)} | ${o.p1i} → ${o.p2i} |`);
  md.push('');

  md.push(`## Top 10 still-falling (by position delta)`);
  if (!fallers.length) md.push('_None worsened by ≥2 positions._');
  else {
    md.push(`| query | cluster | P1→P2 pos | P1→P2 impr |`);
    md.push(`|---|---|---|---|`);
    for (const o of fallers) md.push(`| ${o.query}${thinFlag(o)} | ${o.cluster} | ${posCell(o)} | ${o.p1i} → ${o.p2i} |`);
  }
  md.push('');

  md.push(`## Crossed to page 1`);
  if (!crossed.length) md.push('_No cohort term crossed from page 2+ into the top 10 this window._');
  else for (const o of crossed) md.push(`- **${o.query}**${thinFlag(o)} (${o.cluster}): ${fmt(o.p1pos)} → ${fmt(o.p2pos)} · impr ${o.p1i} → ${o.p2i}`);
  md.push('');

  // Split LOST into genuinely-dropped vs never-ranked. A term absent in P2 but
  // also absent in P1 never entered this 56-day window — calling it "lost"
  // implies it fell out, which it did not.
  const lost = out.filter((o) => o.status === 'LOST');
  const droppedOut = lost.filter((o) => o.p1i > 0);
  const neverRanked = lost.filter((o) => o.p1i === 0);
  md.push(`## LOST breakdown`);
  md.push(`Of ${lost.length} LOST terms, **${droppedOut.length} genuinely dropped out** (had P1 impressions, gone in P2) and **${neverRanked.length} never ranked** in either window (absent P1 *and* P2 — never entered, not lost):`);
  if (droppedOut.length) {
    md.push(`- Dropped out: ${droppedOut.map((o) => `${o.query} (P1 pos ${fmt(o.p1pos)}, ${o.p1i} impr)`).join('; ')}`);
  }
  if (neverRanked.length) {
    md.push(`- Never ranked: ${neverRanked.map((o) => o.query).join(', ')}`);
  }
  md.push('');

  md.push(`## Verdict`);
  md.push(verdict);

  console.log('\n' + md.join('\n') + '\n');
  console.error(`Written: ${csvPath}`);
  console.error(`Summary also written: ${path.join(OUTPUT_DIR, 'cohort_recovery_28d_summary.md')}`);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'cohort_recovery_28d_summary.md'), md.join('\n'));
}

main().catch((err) => { console.error(`\nFAILED: ${err.message}`); process.exit(1); });
