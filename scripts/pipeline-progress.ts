/**
 * Records per-phase pipeline progress in pipeline_runs.
 *
 * Usage:
 *   npx tsx scripts/pipeline-progress.ts start <domain> <email> <mode> [start_from] [stop_after]
 *     → prints ONLY the new run UUID to stdout (captured by run-pipeline.sh)
 *   npx tsx scripts/pipeline-progress.ts phase-start <run_id> <phase>
 *   npx tsx scripts/pipeline-progress.ts phase-done <run_id> <phase>
 *   npx tsx scripts/pipeline-progress.ts phase-skip <run_id> <phase>
 *   npx tsx scripts/pipeline-progress.ts fail <run_id> [phase] [message]
 *   npx tsx scripts/pipeline-progress.ts pause <run_id>      (review gate → awaiting_review)
 *   npx tsx scripts/pipeline-progress.ts complete <run_id>
 *
 * All failures exit non-zero; run-pipeline.sh treats progress writes as
 * non-fatal (`|| true`), so a Supabase blip never kills the pipeline.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { mergePhaseUpdate, type PhaseMap, type PhaseStatus } from '../src/pipeline/progress-merge.js';

function loadEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        if (!process.env[key]) process.env[key] = match[2].trim();
      }
    }
  } catch {
    // No .env file — fall through to process.env (Railway deployment)
  }
}

function makeClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function cmdStart(args: string[]): Promise<void> {
  const [domain, email, mode, startFrom, stopAfter] = args;
  if (!domain || !email || !mode) {
    console.error('Usage: pipeline-progress.ts start <domain> <email> <mode> [start_from] [stop_after]');
    process.exit(1);
  }

  const sb = makeClient();

  const { data: userData } = await sb.auth.admin.listUsers();
  const user = userData?.users?.find((u: any) => u.email === email);
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }

  const { data: audit } = await sb
    .from('audits')
    .select('id')
    .eq('domain', domain)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!audit) {
    console.error(`No audit found for ${domain}`);
    process.exit(1);
  }

  const { data: run, error } = await sb
    .from('pipeline_runs')
    .insert({
      audit_id: audit.id,
      domain,
      mode,
      start_from: startFrom || null,
      stop_after: stopAfter || null,
      status: 'running',
    })
    .select('id')
    .single();

  if (error || !run) {
    console.error(`Failed to create pipeline run: ${error?.message}`);
    process.exit(1);
  }

  // stdout contract: ONLY the run id (captured by run-pipeline.sh)
  console.log(run.id);
}

async function updatePhase(runId: string, phase: string, status: PhaseStatus, error?: string): Promise<void> {
  const sb = makeClient();

  const { data: run, error: fetchErr } = await sb
    .from('pipeline_runs')
    .select('phases')
    .eq('id', runId)
    .single();

  if (fetchErr || !run) {
    console.error(`Run not found: ${runId}`);
    process.exit(1);
  }

  const phases = mergePhaseUpdate((run.phases ?? {}) as PhaseMap, phase, { status, error });
  const update: Record<string, any> = { phases };
  if (status === 'running') update.current_phase = phase;
  if (status === 'completed') update.current_phase = null;

  const { error: updateErr } = await sb
    .from('pipeline_runs')
    .update(update)
    .eq('id', runId);

  if (updateErr) {
    console.error(`Failed to update phase: ${updateErr.message}`);
    process.exit(1);
  }
  console.error(`pipeline_runs ${runId}: phase ${phase} → ${status}`);
}

async function cmdFail(args: string[]): Promise<void> {
  const [runId, phase, message] = args;
  if (!runId) {
    console.error('Usage: pipeline-progress.ts fail <run_id> [phase] [message]');
    process.exit(1);
  }

  const sb = makeClient();

  const { data: run } = await sb
    .from('pipeline_runs')
    .select('phases, status')
    .eq('id', runId)
    .single();

  if (!run) {
    console.error(`Run not found: ${runId}`);
    process.exit(1);
  }

  const update: Record<string, any> = {
    status: 'failed',
    completed_at: new Date().toISOString(),
  };
  if (message) update.error_message = message;
  if (phase) {
    update.phases = mergePhaseUpdate((run.phases ?? {}) as PhaseMap, phase, {
      status: 'failed',
      error: message || undefined,
    });
  }

  const { error } = await sb.from('pipeline_runs').update(update).eq('id', runId);
  if (error) {
    console.error(`Failed to mark run failed: ${error.message}`);
    process.exit(1);
  }
  console.error(`pipeline_runs ${runId}: failed${phase ? ` at phase ${phase}` : ''}`);
}

async function setStatus(runId: string, status: string, extra: Record<string, any> = {}): Promise<void> {
  const sb = makeClient();
  const { error } = await sb
    .from('pipeline_runs')
    .update({ status, ...extra })
    .eq('id', runId);
  if (error) {
    console.error(`Failed to set status ${status}: ${error.message}`);
    process.exit(1);
  }
  console.error(`pipeline_runs ${runId}: status → ${status}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  loadEnv();

  switch (command) {
    case 'start':
      await cmdStart(args);
      break;
    case 'phase-start':
      await updatePhase(args[0], args[1], 'running');
      break;
    case 'phase-done':
      await updatePhase(args[0], args[1], 'completed');
      break;
    case 'phase-skip':
      await updatePhase(args[0], args[1], 'skipped');
      break;
    case 'fail':
      await cmdFail(args);
      break;
    case 'pause':
      await setStatus(args[0], 'awaiting_review');
      break;
    case 'complete':
      await setStatus(args[0], 'completed', { current_phase: null, completed_at: new Date().toISOString() });
      break;
    default:
      console.error('Unknown command. Use: start | phase-start | phase-done | phase-skip | fail | pause | complete');
      process.exit(1);
  }
}

main();
