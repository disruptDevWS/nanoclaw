#!/usr/bin/env npx tsx
/**
 * refresh-architecture.ts — Standalone runner for an on-demand architecture refresh.
 *
 * Re-runs Michael (Phase 6) + the Michael sync (Phase 6b) WITHOUT executing the
 * full pipeline. Used by the /refresh-architecture endpoint when operators want
 * the architecture blueprint rebuilt from current live state: committed/published
 * execution_pages, manual clusters + edits (migration 038), user-declared
 * cornerstone content (migration 039), and current GSC/GA4 performance data.
 *
 * runMichael's re-run mode already reads all of that live from Supabase; this
 * wrapper just sequences generate → sync. Because no --start-from is passed to
 * the sync, detectRerunScenario resolves to 'strategic_rerun', which preserves
 * committed pages and respects assignment_locked rows.
 *
 * Usage:
 *   npx tsx scripts/refresh-architecture.ts --domain <domain> --user-email <email>
 */

import { spawn } from 'node:child_process';

function parseArgs(): { domain: string; userEmail: string } {
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
  if (!flags.domain || !flags['user-email']) {
    console.error('Usage: npx tsx scripts/refresh-architecture.ts --domain <domain> --user-email <email>');
    process.exit(1);
  }
  return { domain: flags.domain, userEmail: flags['user-email'] };
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`[refresh-architecture] → ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, { stdio: 'inherit', cwd: process.cwd() });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${args[1] ?? cmd} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  const { domain, userEmail } = parseArgs();

  console.log(`[refresh-architecture] Refreshing architecture for ${domain}`);

  // Phase 6: Michael generate (re-run mode picks up live state automatically)
  await run('npx', ['tsx', 'scripts/pipeline-generate.ts', 'michael', '--domain', domain, '--user-email', userEmail]);

  // Phase 6b: sync blueprint → Supabase (strategic_rerun: committed pages preserved,
  // assignment_locked rows untouched)
  await run('npx', ['tsx', 'scripts/sync-to-dashboard.ts', '--domain', domain, '--user-email', userEmail, '--agents', 'michael']);

  console.log(`[refresh-architecture] Done: ${domain}`);
}

main().catch((err) => {
  console.error(`[refresh-architecture] FAILED: ${err.message}`);
  process.exit(1);
});
