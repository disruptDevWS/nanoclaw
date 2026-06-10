import { describe, it, expect } from 'vitest';
import { mergePhaseUpdate, type PhaseMap } from '../progress-merge.js';

const T1 = '2026-06-10T10:00:00.000Z';
const T2 = '2026-06-10T10:05:00.000Z';

describe('mergePhaseUpdate', () => {
  it('records started_at on running', () => {
    const result = mergePhaseUpdate({}, '1', { status: 'running', now: T1 });
    expect(result['1']).toEqual({ status: 'running', started_at: T1 });
  });

  it('preserves started_at when completing', () => {
    const phases: PhaseMap = { '1': { status: 'running', started_at: T1 } };
    const result = mergePhaseUpdate(phases, '1', { status: 'completed', now: T2 });
    expect(result['1']).toEqual({
      status: 'completed',
      started_at: T1,
      completed_at: T2,
    });
  });

  it('preserves existing started_at on a re-run (running again)', () => {
    const phases: PhaseMap = { '1': { status: 'failed', started_at: T1, completed_at: T1 } };
    const result = mergePhaseUpdate(phases, '1', { status: 'running', now: T2 });
    expect(result['1']).toEqual({ status: 'running', started_at: T1 });
  });

  it('completes without started_at when phase was never started', () => {
    const result = mergePhaseUpdate({}, '3b', { status: 'completed', now: T2 });
    expect(result['3b']).toEqual({ status: 'completed', completed_at: T2 });
  });

  it('records skipped with no timestamps', () => {
    const result = mergePhaseUpdate({}, '4', { status: 'skipped', now: T1 });
    expect(result['4']).toEqual({ status: 'skipped' });
  });

  it('attaches error on failed and preserves started_at', () => {
    const phases: PhaseMap = { '3b': { status: 'running', started_at: T1 } };
    const result = mergePhaseUpdate(phases, '3b', {
      status: 'failed',
      error: 'QA failed for Jim',
      now: T2,
    });
    expect(result['3b']).toEqual({
      status: 'failed',
      started_at: T1,
      completed_at: T2,
      error: 'QA failed for Jim',
    });
  });

  it('does not mutate the input map and preserves other phases', () => {
    const phases: PhaseMap = { '1': { status: 'completed', started_at: T1, completed_at: T1 } };
    const result = mergePhaseUpdate(phases, '2', { status: 'running', now: T2 });
    expect(phases['2']).toBeUndefined();
    expect(result['1']).toEqual(phases['1']);
    expect(result['2']).toEqual({ status: 'running', started_at: T2 });
  });
});
