import { describe, it, expect } from 'vitest';
import { detectLlmCitationQueries, QueryPageRow, DEFAULT_LLM_CITATION_OPTIONS } from '../llm-citation.js';

function row(overrides: Partial<QueryPageRow>): QueryPageRow {
  return {
    query: 'best emt certification program for working adults',
    page: 'https://example.com/emt',
    clicks: 0,
    impressions: 80,
    position: 6.2,
    ...overrides,
  };
}

describe('detectLlmCitationQueries', () => {
  it('flags zero-click top-10 high-impression long/evaluative queries', () => {
    const out = detectLlmCitationQueries([row({})]);
    expect(out).toHaveLength(1);
    expect(out[0].reasons).toContain('long_query');
    expect(out[0].reasons).toContain('evaluative_language');
    expect(out[0].word_count).toBe(7);
  });

  it('hard filters: clicks, impressions, position', () => {
    expect(detectLlmCitationQueries([row({ clicks: 1 })])).toHaveLength(0);
    expect(detectLlmCitationQueries([row({ impressions: 49 })])).toHaveLength(0);
    expect(detectLlmCitationQueries([row({ position: 10.5 })])).toHaveLength(0);
  });

  it('requires a signal: short non-evaluative queries are not flagged', () => {
    expect(detectLlmCitationQueries([row({ query: 'emt boise' })])).toHaveLength(0);
  });

  it('short evaluative query is flagged with only evaluative_language', () => {
    const out = detectLlmCitationQueries([row({ query: 'ima vs sma' })]);
    expect(out).toHaveLength(1);
    expect(out[0].reasons).toEqual(['evaluative_language']);
  });

  it('long non-evaluative query is flagged with only long_query', () => {
    const out = detectLlmCitationQueries([
      row({ query: 'how long does it take to finish emt school in idaho' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].reasons).toEqual(['long_query']);
  });

  it('sorts by impressions descending and respects custom thresholds', () => {
    const out = detectLlmCitationQueries(
      [row({ query: 'compare a b', impressions: 60 }), row({ impressions: 500 })],
      { ...DEFAULT_LLM_CITATION_OPTIONS, minImpressions: 50 },
    );
    expect(out.map((f) => f.impressions)).toEqual([500, 60]);
  });

  it('handles empty input', () => {
    expect(detectLlmCitationQueries([])).toEqual([]);
  });
});
