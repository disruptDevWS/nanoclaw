import { describe, it, expect } from 'vitest';
import {
  detectReevalCandidates,
  estimateLift,
  normalizePath,
  ReevalKeyword,
  ClusterSnapshot,
  ReevalOptions,
} from '../reeval-candidates.js';

const NOW = new Date('2026-06-12');

const OPTS: ReevalOptions = {
  minPos: 8,
  maxPos: 25,
  maxKd: 30,
  minGrowth: 2.0,
  minAgeMonths: 6,
  minImpressions: 0,
  now: NOW,
};

function kw(overrides: Partial<ReevalKeyword>): ReevalKeyword {
  return {
    keyword: 'emt course boise',
    rank_pos: 12,
    keyword_difficulty: 15,
    canonical_key: 'emt_training',
    ranking_url: 'https://example.com/emt-boise',
    search_volume: 100,
    is_brand: false,
    ...overrides,
  };
}

const HISTORY: Map<string, ClusterSnapshot[]> = new Map([
  [
    'emt_training',
    [
      { snapshot_date: '2025-01-31', keyword_count: 5 },
      { snapshot_date: '2025-09-30', keyword_count: 8 },
      { snapshot_date: '2026-05-31', keyword_count: 15 },
    ],
  ],
]);

describe('detectReevalCandidates', () => {
  it('flags a page meeting all criteria', () => {
    const dates = new Map([['/emt-boise', '2025-02-15']]); // >6mo old, baseline 5 → now 15 = 3x
    const out = detectReevalCandidates([kw({})], HISTORY, dates, new Map(), OPTS);
    expect(out).toHaveLength(1);
    expect(out[0].page_path).toBe('/emt-boise');
    expect(out[0].growth_factor).toBe(3);
    expect(out[0].growth_is_lower_bound).toBe(false);
    expect(out[0].cluster_count_at_publish).toBe(5);
    expect(out[0].cluster_count_now).toBe(15);
  });

  it('skips pages younger than 6 months', () => {
    const dates = new Map([['/emt-boise', '2026-03-01']]);
    expect(detectReevalCandidates([kw({})], HISTORY, dates, new Map(), OPTS)).toHaveLength(0);
  });

  it('skips growth at or below threshold (nearest snapshot before publish is baseline)', () => {
    const dates = new Map([['/emt-boise', '2025-10-15']]); // baseline 8 → now 15 = 1.875x
    expect(detectReevalCandidates([kw({})], HISTORY, dates, new Map(), OPTS)).toHaveLength(0);
  });

  it('unknown publish date → treated as old, earliest snapshot baseline, lower-bound flag', () => {
    const out = detectReevalCandidates([kw({})], HISTORY, new Map(), new Map(), OPTS);
    expect(out).toHaveLength(1);
    expect(out[0].publish_date).toBeNull();
    expect(out[0].growth_is_lower_bound).toBe(true);
    expect(out[0].growth_factor).toBe(3);
  });

  it('filters by position band, KD, brand, and missing ranking_url', () => {
    const dates = new Map([['/emt-boise', '2025-02-15']]);
    const kws = [
      kw({ rank_pos: 5 }), // too good
      kw({ rank_pos: 30 }), // too deep
      kw({ keyword_difficulty: 35 }), // KD too high
      kw({ keyword_difficulty: null }), // no KD
      kw({ is_brand: true }),
      kw({ ranking_url: null }),
    ];
    expect(detectReevalCandidates(kws, HISTORY, dates, new Map(), OPTS)).toHaveLength(0);
  });

  it('groups multiple keywords per page; primary = highest volume', () => {
    const dates = new Map([['/emt-boise', '2025-02-15']]);
    const kws = [
      kw({ keyword: 'low vol', search_volume: 10, rank_pos: 9 }),
      kw({ keyword: 'high vol', search_volume: 500, rank_pos: 14 }),
    ];
    const out = detectReevalCandidates(kws, HISTORY, dates, new Map(), OPTS);
    expect(out).toHaveLength(1);
    expect(out[0].primary_keyword).toBe('high vol');
    expect(out[0].matching_keywords).toBe(2);
  });

  it('returns nothing when no cluster history exists (sparse data safe)', () => {
    const out = detectReevalCandidates([kw({})], new Map(), new Map(), new Map(), OPTS);
    expect(out).toHaveLength(0);
  });

  it('enforces min impressions when set', () => {
    const dates = new Map([['/emt-boise', '2025-02-15']]);
    const gsc = new Map([['/emt-boise', { impressions: 40, avg_position: 11.5 }]]);
    const opts = { ...OPTS, minImpressions: 50 };
    expect(detectReevalCandidates([kw({})], HISTORY, dates, gsc, opts)).toHaveLength(0);
    // and pages with no GSC row are dropped when a floor is set
    expect(detectReevalCandidates([kw({})], HISTORY, dates, new Map(), opts)).toHaveLength(0);
  });
});

describe('helpers', () => {
  it('normalizePath strips origin and trailing slashes', () => {
    expect(normalizePath('https://example.com/a/b/')).toBe('/a/b');
    expect(normalizePath('https://example.com/')).toBe('/');
    expect(normalizePath('/already/path/')).toBe('/already/path');
  });

  it('estimateLift: position 15 → ≈5x at position 5', () => {
    expect(estimateLift(15)).toBe('≈5x traffic at position 5');
  });
});
