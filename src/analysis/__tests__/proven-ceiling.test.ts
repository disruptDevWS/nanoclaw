import { describe, it, expect } from 'vitest';
import { computeProvenCeiling, buildCeilingPromptBlock, CeilingKeyword } from '../proven-ceiling.js';

function kw(overrides: Partial<CeilingKeyword>): CeilingKeyword {
  return {
    keyword: 'kw',
    rank_pos: 3,
    keyword_difficulty: 20,
    canonical_key: 'cluster_a',
    canonical_topic: 'Cluster A',
    is_brand: false,
    ...overrides,
  };
}

/** n owned keywords spread over rank_pos 1-7 */
function owned(n: number, overrides: Partial<CeilingKeyword> = {}): CeilingKeyword[] {
  return Array.from({ length: n }, (_, i) =>
    kw({ keyword: `kw-${i}`, rank_pos: (i % 7) + 1, ...overrides }),
  );
}

describe('computeProvenCeiling', () => {
  it('flags cold start below 15 owned keywords and returns no site ceiling', () => {
    const result = computeProvenCeiling(owned(14));
    expect(result.cold_start).toBe(true);
    expect(result.owned_count).toBe(14);
    expect(result.site_ceiling).toBeNull();
  });

  it('returns null ceiling gracefully on empty input', () => {
    const result = computeProvenCeiling([]);
    expect(result.cold_start).toBe(true);
    expect(result.site_ceiling).toBeNull();
    expect(result.cluster_ceilings).toEqual([]);
  });

  it('site ceiling is the second-highest KD (single fluke does not set the bar)', () => {
    const kws = [
      ...owned(13, { keyword_difficulty: 10 }),
      kw({ keyword: 'fluke', keyword_difficulty: 45 }),
      kw({ keyword: 'real', keyword_difficulty: 30 }),
    ];
    const result = computeProvenCeiling(kws);
    expect(result.cold_start).toBe(false);
    expect(result.site_ceiling).toBe(30);
    expect(result.site_ceiling_example).toEqual({ keyword: 'real', kd: 30 });
  });

  it('two keywords at the same high KD set the ceiling at that KD', () => {
    const kws = [
      ...owned(13, { keyword_difficulty: 10 }),
      kw({ keyword: 'a', keyword_difficulty: 35 }),
      kw({ keyword: 'b', keyword_difficulty: 35 }),
    ];
    expect(computeProvenCeiling(kws).site_ceiling).toBe(35);
  });

  it('excludes brand keywords and positions outside 1-7', () => {
    const kws = [
      ...owned(15, { keyword_difficulty: 10 }),
      kw({ keyword: 'brand', keyword_difficulty: 90, is_brand: true }),
      kw({ keyword: 'page2', keyword_difficulty: 80, rank_pos: 12 }),
      kw({ keyword: 'unranked', keyword_difficulty: 70, rank_pos: null }),
    ];
    const result = computeProvenCeiling(kws);
    expect(result.owned_count).toBe(15);
    expect(result.site_ceiling).toBe(10);
  });

  it('cluster ceiling needs ≥2 owned-with-KD in the cluster, else null', () => {
    const kws = [
      ...owned(14, { keyword_difficulty: 12, canonical_key: 'big', canonical_topic: 'Big' }),
      kw({ keyword: 'lone', keyword_difficulty: 40, canonical_key: 'small', canonical_topic: 'Small' }),
      kw({ keyword: 'c1', keyword_difficulty: 33, canonical_key: 'comp', canonical_topic: 'Comp' }),
      kw({ keyword: 'c2', keyword_difficulty: 38, canonical_key: 'comp', canonical_topic: 'Comp' }),
    ];
    const result = computeProvenCeiling(kws);
    const byKey = Object.fromEntries(result.cluster_ceilings.map((c) => [c.canonical_key, c]));
    expect(byKey['big'].ceiling).toBe(12);
    expect(byKey['small'].ceiling).toBeNull();
    expect(byKey['small'].owned_with_kd).toBe(1);
    expect(byKey['comp'].ceiling).toBe(33);
    // site ceiling spans all owned keywords (second-highest overall: 40, 38 → 38)
    expect(result.site_ceiling).toBe(38);
  });

  it('keywords without KD count toward cold-start but not the ceiling', () => {
    const kws = [
      ...owned(20, { keyword_difficulty: null }),
      kw({ keyword: 'x', keyword_difficulty: 25 }),
    ];
    const result = computeProvenCeiling(kws);
    expect(result.cold_start).toBe(false);
    expect(result.owned_with_kd_count).toBe(1);
    expect(result.site_ceiling).toBeNull(); // only one KD'd keyword — no ≥2 guard
  });
});

describe('buildCeilingPromptBlock', () => {
  const INSTRUCTION = 'Use this as the rankability bar.';

  it('returns empty string when there is no keyword data at all', () => {
    expect(buildCeilingPromptBlock(computeProvenCeiling([]), INSTRUCTION)).toBe('');
  });

  it('emits a cold-start note instead of ceilings below the owned threshold', () => {
    const block = buildCeilingPromptBlock(computeProvenCeiling(owned(5)), INSTRUCTION);
    expect(block).toContain('COLD START');
    expect(block).toContain('5 proven top-7 rankings');
    expect(block).toContain(INSTRUCTION);
    expect(block).not.toContain('Site ceiling: KD');
  });

  it('renders site + cluster ceilings with the stretch rule and instruction', () => {
    const kws = [
      ...owned(14, { keyword_difficulty: 10, canonical_key: 'big', canonical_topic: 'Big' }),
      kw({ keyword: 'a', keyword_difficulty: 35, canonical_key: 'comp', canonical_topic: 'Comp' }),
      kw({ keyword: 'b', keyword_difficulty: 33, canonical_key: 'comp', canonical_topic: 'Comp' }),
    ];
    const block = buildCeilingPromptBlock(computeProvenCeiling(kws), INSTRUCTION);
    expect(block).toContain('Site ceiling: KD 33');
    expect(block).toContain('Big: KD 10');
    expect(block).toContain('Comp: KD 33');
    expect(block).toContain('STRETCH TARGET');
    expect(block).toContain(INSTRUCTION);
  });

  it('focusClusterKey narrows to one cluster; missing cluster falls back to site-bar note', () => {
    const kws = [
      ...owned(14, { keyword_difficulty: 10, canonical_key: 'big', canonical_topic: 'Big' }),
      kw({ keyword: 'a', keyword_difficulty: 35, canonical_key: 'comp', canonical_topic: 'Comp' }),
      kw({ keyword: 'b', keyword_difficulty: 33, canonical_key: 'comp', canonical_topic: 'Comp' }),
    ];
    const result = computeProvenCeiling(kws);
    const focused = buildCeilingPromptBlock(result, INSTRUCTION, { focusClusterKey: 'comp' });
    expect(focused).toContain('Comp: KD 33');
    expect(focused).not.toContain('Big: KD 10');
    const missing = buildCeilingPromptBlock(result, INSTRUCTION, { focusClusterKey: 'absent_cluster' });
    expect(missing).toContain('no proven top-7 rankings with difficulty data');
  });
});
