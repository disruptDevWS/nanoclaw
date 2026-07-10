#!/usr/bin/env npx tsx
/**
 * cron-track-all.ts — Batch runner for performance tracking.
 * Queries all completed audits and runs track-rankings.ts for each sequentially.
 *
 * Usage:
 *   npx tsx scripts/cron-track-all.ts
 *   npx tsx scripts/cron-track-all.ts --force    # bypass 25-day recency check
 *
 * Scheduling: Run monthly via Railway cron or external scheduler.
 * Only processes audits with performance_tracking_enabled = true.
 * The 25-day recency check in track-rankings.ts prevents double-runs.
 */

import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================================
// .env loader (same pattern as sync-to-dashboard.ts)
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
// Run a tracker script for a single domain
// ============================================================

function runScript(script: string, domain: string, email: string, force: boolean): Promise<{ domain: string; exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const args = ['tsx', script, '--domain', domain, '--user-email', email];
    if (force) args.push('--force');

    const child = spawn('npx', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: process.cwd(),
    });

    let output = '';
    child.stdout?.on('data', (data) => { output += data.toString(); });
    child.stderr?.on('data', (data) => { output += data.toString(); });

    child.on('close', (code) => {
      resolve({ domain, exitCode: code ?? 1, output });
    });

    child.on('error', (err) => {
      resolve({ domain, exitCode: 1, output: `spawn error: ${err.message}` });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// Main
// ============================================================

async function main() {
  const force = process.argv.includes('--force');
  const env = loadEnv();
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');

  const sb = createClient(supabaseUrl, supabaseKey);

  // Query completed audits with performance tracking enabled
  const { data: audits, error } = await (sb as any)
    .from('audits')
    .select('id, domain, user_id, status')
    .eq('status', 'completed')
    .eq('performance_tracking_enabled', true);

  if (error) throw new Error(`Failed to query audits: ${error.message}`);
  if (!audits || audits.length === 0) {
    console.log('No completed audits found.');
    return;
  }

  // Resolve user emails
  const { data: userData } = await sb.auth.admin.listUsers();
  const userMap = new Map<string, string>();
  for (const u of userData?.users ?? []) {
    if (u.email) userMap.set(u.id, u.email);
  }

  console.log(`\n=== Cron Track All: ${audits.length} completed audits ===\n`);

  const stats = { rankings: { tracked: 0, skipped: 0, failed: 0 }, gsc: { tracked: 0, skipped: 0, failed: 0 } };
  const failedDomains: string[] = [];

  for (let i = 0; i < audits.length; i++) {
    const audit = audits[i];
    const email = userMap.get(audit.user_id);

    if (!email) {
      console.log(`  [${i + 1}/${audits.length}] ${audit.domain} — SKIP (no user email found)`);
      stats.rankings.skipped++;
      stats.gsc.skipped++;
      continue;
    }

    // --- Rankings (DataForSEO) ---
    console.log(`  [${i + 1}/${audits.length}] ${audit.domain} — rankings...`);
    const rankResult = await runScript('scripts/track-rankings.ts', audit.domain, email, force);

    if (rankResult.exitCode === 0) {
      if (rankResult.output.includes('Skipping')) {
        console.log(`    Rankings: skipped (recent snapshot)`);
        stats.rankings.skipped++;
      } else {
        console.log(`    Rankings: done`);
        stats.rankings.tracked++;
      }
    } else {
      console.log(`    Rankings: FAILED (exit code ${rankResult.exitCode})`);
      if (rankResult.output) {
        const lastLines = rankResult.output.trim().split('\n').slice(-3).join('\n    ');
        console.log(`    ${lastLines}`);
      }
      stats.rankings.failed++;
      if (!failedDomains.includes(audit.domain)) failedDomains.push(audit.domain);
    }

    // Brief pause between scripts for the same domain
    await sleep(5_000);

    // --- GSC + GA4 ---
    console.log(`  [${i + 1}/${audits.length}] ${audit.domain} — GSC...`);
    const gscResult = await runScript('scripts/track-gsc.ts', audit.domain, email, force);

    if (gscResult.exitCode === 0) {
      if (gscResult.output.includes('Skipping') || gscResult.output.includes('skipped')) {
        console.log(`    GSC: skipped (recent snapshot or no connection)`);
        stats.gsc.skipped++;
      } else {
        console.log(`    GSC: done`);
        stats.gsc.tracked++;
      }
    } else {
      console.log(`    GSC: FAILED (exit code ${gscResult.exitCode})`);
      if (gscResult.output) {
        const lastLines = gscResult.output.trim().split('\n').slice(-3).join('\n    ');
        console.log(`    ${lastLines}`);
      }
      stats.gsc.failed++;
      if (!failedDomains.includes(audit.domain)) failedDomains.push(audit.domain);
    }

    // 30-second delay between domains to avoid DataForSEO rate limits
    if (i < audits.length - 1) {
      await sleep(30_000);
    }
  }

  const totalFailed = stats.rankings.failed + stats.gsc.failed;
  console.log(`\n=== Summary ===`);
  console.log(`  Rankings: ${stats.rankings.tracked} tracked, ${stats.rankings.skipped} skipped, ${stats.rankings.failed} failed`);
  console.log(`  GSC:      ${stats.gsc.tracked} tracked, ${stats.gsc.skipped} skipped, ${stats.gsc.failed} failed\n`);

  // Post-run tracking-health audit — surfaces zero-metric published pages, stale
  // syncs, and recorded pull errors that the per-domain steps above hide.
  const { checkTrackingHealth } = await import('./check-tracking-health.js');
  let healthIssues: unknown[] = [];
  try {
    ({ issues: healthIssues } = await checkTrackingHealth(sb));
  } catch (err: any) {
    console.warn(`  [TRACKING-HEALTH] health check failed: ${err?.message ?? err}`);
  }

  // Log cron run to agent_runs for operational visibility
  const runDate = new Date().toISOString().slice(0, 10);
  const status = (totalFailed > 0 || healthIssues.length > 0) ? 'completed_with_errors' : 'completed';
  await sb.from('agent_runs').insert({
    audit_id: audits[0]?.id, // attach to first audit as anchor
    agent_name: 'cron_track_all',
    run_date: runDate,
    status,
    metadata: {
      total_audits: audits.length,
      rankings: stats.rankings,
      gsc: stats.gsc,
      failed_domains: failedDomains,
      health_issue_count: healthIssues.length,
    },
  });
}

main().catch((err) => {
  console.error(`\nFATAL: ${err.message}\n`);
  process.exit(1);
});
