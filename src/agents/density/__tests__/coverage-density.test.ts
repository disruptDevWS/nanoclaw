import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock embeddings module with deterministic vectors ──

const vectorMap = new Map<string, number[] | null>();

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

vi.mock('../../../embeddings/index.js', () => ({
  embedBatch: vi.fn(async (items: Array<{ text: string }>) =>
    items.map((i) => {
      const vec = vectorMap.get(i.text);
      return vec ? { embedding: vec, fromCache: false } : null;
    }),
  ),
  cosineSimilarity: (a: number[], b: number[]) => dot(a, b),
}));

import { computeCoverageDensity, DENSITY_THRESHOLD } from '../coverage-density.js';

// Unit vectors with controlled similarities to e1 = [1,0,0]
const e1 = [1, 0, 0];
const e2 = [0, 1, 0];
const simTo = (s: number) => [s, Math.sqrt(1 - s * s), 0];

beforeEach(() => {
  vectorMap.clear();
});

describe('computeCoverageDensity()', () => {
  it('returns no_keywords when keyword list is empty', async () => {
    const result = await computeCoverageDensity('topic', [], [{ text: 'a', contentId: 'a' }], []);
    expect(result.density_status).toBe('no_keywords');
    expect(result.density_score).toBeNull();
    expect(result.competitor_density_score).toBeNull();
  });

  it('returns no_client_content when client corpus is empty', async () => {
    const result = await computeCoverageDensity(
      'topic',
      [{ id: 'k1', keyword: 'kw one' }],
      [],
      [{ text: 'comp heading', contentId: 'c1' }],
    );
    expect(result.density_status).toBe('no_client_content');
    expect(result.density_score).toBeNull();
    expect(result.keyword_count).toBe(1);
  });

  it('computes covered ratio correctly', async () => {
    vectorMap.set('kw covered', e1);
    vectorMap.set('kw uncovered', e2);
    vectorMap.set('client heading', simTo(0.85)); // 0.85 vs kw covered, ~0.527 vs kw uncovered

    const result = await computeCoverageDensity(
      'topic',
      [
        { id: 'k1', keyword: 'kw covered' },
        { id: 'k2', keyword: 'kw uncovered' },
      ],
      [{ text: 'client heading', contentId: 'c1' }],
      [],
    );

    expect(result.density_status).toBe('scored');
    expect(result.keyword_count).toBe(2);
    expect(result.covered_keywords).toBe(1);
    expect(result.density_score).toBe(50);
  });

  it('treats similarity exactly at threshold as covered (>=)', async () => {
    vectorMap.set('kw', e1);
    vectorMap.set('client heading', simTo(DENSITY_THRESHOLD));

    const result = await computeCoverageDensity(
      'topic',
      [{ id: 'k1', keyword: 'kw' }],
      [{ text: 'client heading', contentId: 'c1' }],
      [],
    );

    expect(result.covered_keywords).toBe(1);
    expect(result.density_score).toBe(100);
  });

  it('returns null competitor score when competitor corpus is empty', async () => {
    vectorMap.set('kw', e1);
    vectorMap.set('client heading', e1);

    const result = await computeCoverageDensity(
      'topic',
      [{ id: 'k1', keyword: 'kw' }],
      [{ text: 'client heading', contentId: 'c1' }],
      [],
    );

    expect(result.density_score).toBe(100);
    expect(result.competitor_density_score).toBeNull();
  });

  it('computes competitor density when competitor corpus present', async () => {
    vectorMap.set('kw', e1);
    vectorMap.set('client heading', e2); // not covered by client
    vectorMap.set('comp heading', e1); // covered by competitor

    const result = await computeCoverageDensity(
      'topic',
      [{ id: 'k1', keyword: 'kw' }],
      [{ text: 'client heading', contentId: 'c1' }],
      [{ text: 'comp heading', contentId: 'x1' }],
    );

    expect(result.density_score).toBe(0);
    expect(result.competitor_density_score).toBe(100);
  });

  it('skips keywords with null embeddings from the denominator', async () => {
    vectorMap.set('kw good', e1);
    // 'kw failed' deliberately not in vectorMap → null embedding
    vectorMap.set('client heading', e1);

    const result = await computeCoverageDensity(
      'topic',
      [
        { id: 'k1', keyword: 'kw good' },
        { id: 'k2', keyword: 'kw failed' },
      ],
      [{ text: 'client heading', contentId: 'c1' }],
      [],
    );

    expect(result.keyword_count).toBe(1);
    expect(result.density_score).toBe(100);
  });

  it('returns no_keywords status when all keyword embeddings fail', async () => {
    vectorMap.set('client heading', e1);

    const result = await computeCoverageDensity(
      'topic',
      [{ id: 'k1', keyword: 'kw failed' }],
      [{ text: 'client heading', contentId: 'c1' }],
      [],
    );

    expect(result.density_status).toBe('no_keywords');
    expect(result.density_score).toBeNull();
  });

  it('logs borderline matches in the 0.72-0.83 band', async () => {
    vectorMap.set('kw borderline', e1);
    vectorMap.set('client heading', simTo(0.75));

    const result = await computeCoverageDensity(
      'topic',
      [{ id: 'k1', keyword: 'kw borderline' }],
      [{ text: 'client heading', contentId: 'c1' }],
      [],
    );

    expect(result.covered_keywords).toBe(0);
    expect(result.borderline).toHaveLength(1);
    expect(result.borderline[0].keyword).toBe('kw borderline');
    expect(result.borderline[0].best_client_match).toBe('client heading');
    expect(result.borderline[0].similarity).toBeCloseTo(0.75, 2);
  });

  it('respects a custom threshold override', async () => {
    vectorMap.set('kw', e1);
    vectorMap.set('client heading', simTo(0.85));

    const strict = await computeCoverageDensity(
      'topic',
      [{ id: 'k1', keyword: 'kw' }],
      [{ text: 'client heading', contentId: 'c1' }],
      [],
      0.9,
    );
    expect(strict.density_score).toBe(0);
  });
});
