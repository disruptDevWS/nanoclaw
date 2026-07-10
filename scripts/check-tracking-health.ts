/**
 * check-tracking-health.ts — surfaces silent failures in the publish→performance
 * tracking loop so they stop being invisible.
 *
 * The tracking loop can fail silently in ways the per-domain cron steps hide:
 * a connection whose last pull threw, a cron that stopped firing, or a published
 * page that never accrues metric rows (the join quietly missing). This check
 * detects all three, per active analytics_connection:
 *
 *   1. pull_error   — connection.error_message is set (last GSC/GA4 pull threw)
 *   2. stale_sync   — last_gsc_sync_at > GSC_STALE_DAYS, or last_ga4_sync_at > GA4_STALE_DAYS
 *   3. zero_metrics — a published page older than GRACE_DAYS has ZERO matching
 *                     rows in gsc_page_snapshots AND ga4_page_snapshots
 *
 * Emits a consolidated [TRACKING-HEALTH] console block and one agent_runs row
 * (agent_name='tracking_health'). Called at the end of cron-track-all; also
 * runnable standalone:  npx tsx scripts/check-tracking-health.ts
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Grace before a published page's zero-coverage counts as a real gap. GSC 'final'
// data lags ~3 days; add indexing headroom so brand-new pages don't false-alarm.
const GRACE_DAYS = 10;
// How far back a matching snapshot row counts as "has coverage".
const COVERAGE_LOOKBACK_DAYS = 45;
// Sync-freshness thresholds (GSC refreshes weekly, rankings/GA4 monthly).
const GSC_STALE_DAYS = 14;
const GA4_STALE_DAYS = 40;

const DAY_MS = 86_400_000;

export interface HealthIssue {
  type: 'pull_error' | 'stale_sync' | 'zero_metrics';
  audit_id: string;
  domain: string;
  detail: string;
  [k: string]: unknown;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
}

/**
 * Path forms a published page might appear under in the snapshot tables.
 * gsc/ga4 store page_url as a leading-slash path (e.g. "/emt-seattle"); prefer
 * the published_url's pathname, fall back to url_slug. Emit with and without a
 * trailing slash to absorb the known leading/trailing-slash drift in the data.
 */
function pathVariants(publishedUrl: string | null, urlSlug: string): string[] {
  let p: string;
  if (publishedUrl) {
    try { p = new URL(publishedUrl).pathname; } catch { p = publishedUrl; }
  } else {
    p = urlSlug.startsWith('/') ? urlSlug : `/${urlSlug}`;
  }
  p = p !== '/' && p.endsWith('/') ? p.slice(0, -1) : p;
  return p === '/' ? ['/'] : [p, `${p}/`];
}

export async function checkTrackingHealth(sb: SupabaseClient): Promise<{ issues: HealthIssue[] }> {
  const issues: HealthIssue[] = [];

  const { data: connections } = await (sb as any)
    .from('analytics_connections')
    .select('audit_id, domain, status, error_message, last_gsc_sync_at, last_ga4_sync_at')
    .eq('status', 'active');

  const coverageCutoff = new Date(Date.now() - COVERAGE_LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);
  const graceCutoff = new Date(Date.now() - GRACE_DAYS * DAY_MS).toISOString();

  for (const c of (connections ?? []) as any[]) {
    // 1. pull_error — a recorded fetch failure on the connection
    if (c.error_message) {
      issues.push({ type: 'pull_error', audit_id: c.audit_id, domain: c.domain, detail: c.error_message });
    }

    // 2. stale_sync — cron stopped firing (or never ran) for a source
    const gscAge = daysSince(c.last_gsc_sync_at);
    if (gscAge === null || gscAge > GSC_STALE_DAYS) {
      issues.push({
        type: 'stale_sync', audit_id: c.audit_id, domain: c.domain, source: 'gsc',
        detail: `GSC last synced ${gscAge === null ? 'never' : gscAge + 'd ago'} (>${GSC_STALE_DAYS}d)`,
      });
    }
    const ga4Age = daysSince(c.last_ga4_sync_at);
    if (ga4Age === null || ga4Age > GA4_STALE_DAYS) {
      issues.push({
        type: 'stale_sync', audit_id: c.audit_id, domain: c.domain, source: 'ga4',
        detail: `GA4 last synced ${ga4Age === null ? 'never' : ga4Age + 'd ago'} (>${GA4_STALE_DAYS}d)`,
      });
    }

    // 3. zero_metrics — published pages past the grace window with no snapshot rows
    const { data: pages } = await (sb as any)
      .from('execution_pages')
      .select('url_slug, published_url, published_at')
      .eq('audit_id', c.audit_id)
      .not('published_at', 'is', null)
      .lt('published_at', graceCutoff);

    for (const pg of (pages ?? []) as any[]) {
      const variants = pathVariants(pg.published_url, pg.url_slug);
      const { count: gscCount } = await (sb as any)
        .from('gsc_page_snapshots')
        .select('id', { count: 'exact', head: true })
        .eq('audit_id', c.audit_id)
        .in('page_url', variants)
        .gte('snapshot_date', coverageCutoff);
      const { count: ga4Count } = await (sb as any)
        .from('ga4_page_snapshots')
        .select('id', { count: 'exact', head: true })
        .eq('audit_id', c.audit_id)
        .in('page_url', variants)
        .gte('snapshot_date', coverageCutoff);

      if ((gscCount ?? 0) === 0 && (ga4Count ?? 0) === 0) {
        issues.push({
          type: 'zero_metrics', audit_id: c.audit_id, domain: c.domain,
          detail: `${pg.url_slug} (published ${daysSince(pg.published_at)}d ago) has 0 GSC + 0 GA4 rows`,
          url_slug: pg.url_slug, published_url: pg.published_url,
        });
      }
    }
  }

  // Report
  if (issues.length === 0) {
    console.log('[TRACKING-HEALTH] OK — no issues across active connections');
  } else {
    console.log(`[TRACKING-HEALTH] ${issues.length} issue(s):`);
    for (const it of issues) console.log(`  [${it.type}] ${it.domain}: ${it.detail}`);
  }

  // Persist for operational visibility. agent_runs.audit_id is NOT NULL, so only
  // log when we have an anchor connection to attach to.
  const anchor = ((connections ?? []) as any[])[0]?.audit_id;
  if (anchor) {
    await sb.from('agent_runs').insert({
      audit_id: anchor,
      agent_name: 'tracking_health',
      run_date: new Date().toISOString().slice(0, 10),
      status: issues.length > 0 ? 'completed_with_errors' : 'completed',
      metadata: { issue_count: issues.length, issues },
    });
  }

  return { issues };
}

// ============================================================
// Standalone entrypoint
// ============================================================

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 0) continue;
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[t.slice(0, i).trim()] = v;
    }
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
    process.exit(1);
  }
  const sb = createClient(url, key);
  checkTrackingHealth(sb)
    .then(() => process.exit(0))
    .catch((err) => { console.error(`FATAL: ${err.message}`); process.exit(1); });
}
