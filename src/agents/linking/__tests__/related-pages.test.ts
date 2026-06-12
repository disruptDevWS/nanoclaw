import { describe, it, expect, vi } from 'vitest';

// ── Mock embeddings module with deterministic vectors ──

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

vi.mock('../../../embeddings/index.js', () => ({
  embedBatch: vi.fn(async () => []),
  cosineSimilarity: (a: number[], b: number[]) => dot(a, b),
  ACTIVE_EMBEDDING_MODEL: 'test-model',
}));

import {
  rankRelatedPages,
  buildExecPageText,
  formatRelatedPagesSection,
  gscPathKey,
  execPageContentId,
  type PoolEntry,
  type ExecPageRow,
  type RelatedPagesResult,
} from '../related-pages.js';

const e1 = [1, 0, 0];
const simTo = (s: number) => [s, Math.sqrt(1 - s * s), 0];

function entry(overrides: Partial<PoolEntry> & { path: string }): PoolEntry {
  return {
    target: `/${overrides.path.split('/').slice(1).join('/')}`,
    kind: 'planned',
    title: 'Title',
    embedding: null,
    ...overrides,
  };
}

describe('rankRelatedPages()', () => {
  it('sorts descending, applies the 0.50 floor, and caps at limit', () => {
    const pool: PoolEntry[] = [
      entry({ path: 'x.com/a', embedding: simTo(0.6) }),
      entry({ path: 'x.com/b', embedding: simTo(0.8) }),
      entry({ path: 'x.com/c', embedding: simTo(0.49) }), // below floor
      entry({ path: 'x.com/d', embedding: simTo(0.7) }),
    ];
    const { candidates } = rankRelatedPages(e1, pool, { selfPath: 'x.com/self', limit: 2 });
    expect(candidates.map((c) => c.target)).toEqual(['/b', '/d']);
    expect(candidates[0].similarity).toBe(0.8);
  });

  it('excludes self by path and skips null embeddings', () => {
    const pool: PoolEntry[] = [
      entry({ path: 'x.com/self', embedding: simTo(0.99) }),
      entry({ path: 'x.com/a', embedding: null }),
      entry({ path: 'x.com/b', embedding: simTo(0.6) }),
    ];
    const { candidates, cannibalization_risks } = rankRelatedPages(e1, pool, {
      selfPath: 'x.com/self',
    });
    expect(candidates.map((c) => c.target)).toEqual(['/b']);
    expect(cannibalization_risks).toEqual([]);
  });

  it('routes >0.90 to risks; exactly 0.90 stays a candidate (strict >)', () => {
    const pool: PoolEntry[] = [
      entry({ path: 'x.com/dupe', embedding: simTo(0.95) }),
      entry({ path: 'x.com/boundary', embedding: simTo(0.9) }),
    ];
    const { candidates, cannibalization_risks } = rankRelatedPages(e1, pool, {
      selfPath: 'x.com/self',
    });
    expect(cannibalization_risks).toHaveLength(1);
    expect(cannibalization_risks[0].target).toBe('/dupe');
    expect(cannibalization_risks[0].similarity).toBe(0.95);
    expect(candidates.map((c) => c.target)).toEqual(['/boundary']);
  });

  it('dedupes live/planned by path (live wins); published exec page is live', () => {
    const pool: PoolEntry[] = [
      entry({ path: 'x.com/a', kind: 'planned', target: '/a', embedding: simTo(0.7) }),
      entry({
        path: 'x.com/a',
        kind: 'live',
        target: 'https://x.com/a',
        embedding: simTo(0.7),
      }),
      // published exec page → caller labels kind 'live'
      entry({ path: 'x.com/b', kind: 'live', target: '/b', status: 'published', embedding: simTo(0.6) }),
    ];
    const { candidates } = rankRelatedPages(e1, pool, { selfPath: 'x.com/self' });
    expect(candidates).toHaveLength(2);
    expect(candidates[0].target).toBe('https://x.com/a');
    expect(candidates[0].kind).toBe('live');
    expect(candidates[1].target).toBe('/b');
    expect(candidates[1].kind).toBe('live');
  });
});

describe('buildExecPageText()', () => {
  const base: ExecPageRow = {
    url_slug: 'emergency-towing/boise',
    silo: null,
    status: 'not_started',
    meta_title: null,
    h1_recommendation: null,
    meta_description: null,
    page_brief: null,
  };

  it('joins non-empty meta fields with " | " when brief fields exist', () => {
    const text = buildExecPageText({
      ...base,
      meta_title: 'Emergency Towing Boise',
      h1_recommendation: '24/7 Emergency Towing',
      meta_description: '',
    });
    expect(text).toBe('Emergency Towing Boise | 24/7 Emergency Towing');
  });

  it('falls back to primary_keyword + role + humanized slug', () => {
    const text = buildExecPageText({
      ...base,
      page_brief: { primary_keyword: 'emergency towing boise', role: 'cluster' },
    });
    expect(text).toBe('emergency towing boise | cluster | emergency towing boise');
  });

  it('returns humanized slug for an otherwise empty row', () => {
    expect(buildExecPageText(base)).toBe('emergency towing boise');
  });
});

describe('execPageContentId()', () => {
  it('namespaces by audit and strips leading slashes', () => {
    expect(execPageContentId('audit-1', '/towing-services')).toBe('exec_page:audit-1:towing-services');
  });
});

describe('formatRelatedPagesSection()', () => {
  const result: RelatedPagesResult = {
    computed_at: '2026-06-10T00:00:00.000Z',
    model: 'test-model',
    source: 'disk',
    candidates: [
      { target: 'https://x.com/a', kind: 'live', title: 'Page A', similarity: 0.78 },
      { target: '/b', kind: 'planned', title: 'Page B', similarity: 0.61 },
    ],
    cannibalization_risks: [{ target: 'https://x.com/dupe', similarity: 0.93 }],
  };

  it('renders LIVE/PLANNED markers and the DO NOT LINK line', () => {
    const md = formatRelatedPagesSection(result);
    expect(md).toContain('| https://x.com/a | [LIVE] | Page A | 0.78 |');
    expect(md).toContain('| /b | [PLANNED] | Page B | 0.61 |');
    expect(md).toContain('DO NOT LINK');
    expect(md).toContain('https://x.com/dupe (0.93)');
  });

  it('returns empty string for null and empty results', () => {
    expect(formatRelatedPagesSection(null)).toBe('');
    expect(
      formatRelatedPagesSection({ ...result, candidates: [], cannibalization_risks: [] }),
    ).toBe('');
  });
});

describe('formatRelatedPagesSection() with positions', () => {
  const result: RelatedPagesResult = {
    computed_at: '2026-06-10T00:00:00.000Z',
    model: 'test-model',
    source: 'disk',
    candidates: [
      { target: 'https://x.com/a/', kind: 'live', title: 'Page A', similarity: 0.78 },
      { target: '/b', kind: 'planned', title: 'Page B', similarity: 0.61 },
    ],
    cannibalization_risks: [],
  };

  it('adds a Position column, matching paths with/without trailing slash', () => {
    const positions = new Map([['/a', 12.4]]);
    const md = formatRelatedPagesSection(result, positions);
    expect(md).toContain('| Target | Type | Title | Similarity | Position |');
    expect(md).toContain('| https://x.com/a/ | [LIVE] | Page A | 0.78 | 12.4 |');
    expect(md).toContain('| /b | [PLANNED] | Page B | 0.61 | — |');
    expect(md).toContain('Position = latest GSC average position');
  });

  it('omits the column entirely when no positions map is passed (legacy format)', () => {
    expect(formatRelatedPagesSection(result)).not.toContain('Position');
  });
});

describe('gscPathKey()', () => {
  it('normalizes URLs and paths to lowercase no-trailing-slash pathnames', () => {
    expect(gscPathKey('https://x.com/EMT-Boise/')).toBe('/emt-boise');
    expect(gscPathKey('/a/b/')).toBe('/a/b');
    expect(gscPathKey('a')).toBe('/a');
    expect(gscPathKey('https://x.com/')).toBe('/');
  });
});
