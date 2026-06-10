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

import { detectCannibalization, normalizeUrl } from '../cannibalization.js';
import type { PageMeta } from '../crawl-meta.js';

const e1 = [1, 0, 0];
const simTo = (s: number) => [s, Math.sqrt(1 - s * s), 0];

function meta(url: string, title: string): PageMeta {
  return { url, title, h1: null, metaDescription: null };
}

beforeEach(() => {
  vectorMap.clear();
});

describe('normalizeUrl()', () => {
  it('lowercases host and strips www', () => {
    expect(normalizeUrl('https://WWW.Example.com/Page')).toBe('example.com/Page');
  });

  it('strips query and fragment', () => {
    expect(normalizeUrl('https://example.com/page?utm=x#section')).toBe('example.com/page');
  });

  it('strips trailing slash', () => {
    expect(normalizeUrl('https://example.com/page/')).toBe('example.com/page');
  });

  it('handles protocol-less input', () => {
    expect(normalizeUrl('example.com/page')).toBe('example.com/page');
  });

  it('normalizes ranking_url and crawl Address to the same key', () => {
    expect(normalizeUrl('https://www.example.com/towing/')).toBe(
      normalizeUrl('https://example.com/towing'),
    );
  });

  it('treats bare domain root consistently', () => {
    expect(normalizeUrl('https://www.example.com/')).toBe('example.com');
  });
});

describe('detectCannibalization()', () => {
  it('skips clusters with fewer than 2 distinct URLs', async () => {
    vectorMap.set('Title A', e1);
    const pageMeta = new Map<string, PageMeta>([
      ['example.com/a', meta('https://example.com/a', 'Title A')],
    ]);
    const pairs = await detectCannibalization(
      new Map([['topic', ['example.com/a', 'example.com/a']]]),
      pageMeta,
    );
    expect(pairs).toEqual([]);
  });

  it('flags pairs above 0.90 but not exactly 0.90 (strict >)', async () => {
    vectorMap.set('Title A', e1);
    vectorMap.set('Title B', simTo(0.91));
    vectorMap.set('Title C', simTo(0.9));

    const pageMeta = new Map<string, PageMeta>([
      ['example.com/a', meta('https://example.com/a', 'Title A')],
      ['example.com/b', meta('https://example.com/b', 'Title B')],
      ['example.com/c', meta('https://example.com/c', 'Title C')],
    ]);

    const pairs = await detectCannibalization(
      new Map([
        ['topic-flagged', ['example.com/a', 'example.com/b']],
        ['topic-boundary', ['example.com/a', 'example.com/c']],
      ]),
      pageMeta,
    );

    expect(pairs).toHaveLength(1);
    expect(pairs[0].canonical_key).toBe('topic-flagged');
    expect(pairs[0].page_a_url).toBe('https://example.com/a');
    expect(pairs[0].page_b_url).toBe('https://example.com/b');
  });

  it('rounds similarity to 3 decimals', async () => {
    vectorMap.set('Title A', e1);
    vectorMap.set('Title B', simTo(0.91149));

    const pageMeta = new Map<string, PageMeta>([
      ['example.com/a', meta('https://example.com/a', 'Title A')],
      ['example.com/b', meta('https://example.com/b', 'Title B')],
    ]);

    const pairs = await detectCannibalization(
      new Map([['topic', ['example.com/a', 'example.com/b']]]),
      pageMeta,
    );

    expect(pairs[0].similarity).toBe(0.911);
  });

  it('sorts pairs by similarity descending', async () => {
    vectorMap.set('Title A', e1);
    vectorMap.set('Title B', simTo(0.92));
    vectorMap.set('Title C', simTo(0.97));

    const pageMeta = new Map<string, PageMeta>([
      ['example.com/a', meta('https://example.com/a', 'Title A')],
      ['example.com/b', meta('https://example.com/b', 'Title B')],
      ['example.com/c', meta('https://example.com/c', 'Title C')],
    ]);

    const pairs = await detectCannibalization(
      new Map([
        ['topic-1', ['example.com/a', 'example.com/b']],
        ['topic-2', ['example.com/a', 'example.com/c']],
      ]),
      pageMeta,
    );

    expect(pairs).toHaveLength(2);
    expect(pairs[0].similarity).toBeGreaterThan(pairs[1].similarity);
    expect(pairs[0].canonical_key).toBe('topic-2');
  });

  it('skips URLs without crawl metadata', async () => {
    vectorMap.set('Title A', e1);
    const pageMeta = new Map<string, PageMeta>([
      ['example.com/a', meta('https://example.com/a', 'Title A')],
      // example.com/missing has no meta
    ]);

    const pairs = await detectCannibalization(
      new Map([['topic', ['example.com/a', 'example.com/missing']]]),
      pageMeta,
    );
    expect(pairs).toEqual([]);
  });

  it('skips URLs whose embedding fails', async () => {
    vectorMap.set('Title A', e1);
    // 'Title B' not registered → null embedding
    const pageMeta = new Map<string, PageMeta>([
      ['example.com/a', meta('https://example.com/a', 'Title A')],
      ['example.com/b', meta('https://example.com/b', 'Title B')],
    ]);

    const pairs = await detectCannibalization(
      new Map([['topic', ['example.com/a', 'example.com/b']]]),
      pageMeta,
    );
    expect(pairs).toEqual([]);
  });
});
