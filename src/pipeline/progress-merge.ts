/**
 * Pure merge logic for pipeline_runs.phases JSONB.
 *
 * phases shape:
 *   { "1": { "status": "completed", "started_at": "...", "completed_at": "..." },
 *     "4": { "status": "skipped" } }
 *
 * Single writer per domain is guaranteed by the pipeline server's inFlight 409,
 * so read-modify-write against the DB is race-free.
 */

export type PhaseStatus = 'running' | 'completed' | 'skipped' | 'failed';

export interface PhaseEntry {
  status: PhaseStatus;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

export type PhaseMap = Record<string, PhaseEntry>;

export interface PhasePatch {
  status: PhaseStatus;
  error?: string;
  now?: string; // injectable timestamp for tests
}

/**
 * Merges a phase status update into the phases map. Returns a new map.
 * - 'running' sets started_at (preserved if already present from a retry)
 * - 'completed'/'failed' set completed_at and preserve started_at
 * - 'skipped' records status only (no timestamps)
 * - error is attached when provided
 */
export function mergePhaseUpdate(
  phases: PhaseMap,
  phase: string,
  patch: PhasePatch,
): PhaseMap {
  const now = patch.now ?? new Date().toISOString();
  const prev = phases[phase];
  const entry: PhaseEntry = { status: patch.status };

  if (patch.status === 'running') {
    entry.started_at = prev?.started_at ?? now;
  } else if (patch.status === 'completed' || patch.status === 'failed') {
    if (prev?.started_at) entry.started_at = prev.started_at;
    entry.completed_at = now;
  }

  if (patch.error) entry.error = patch.error;

  return { ...phases, [phase]: entry };
}
