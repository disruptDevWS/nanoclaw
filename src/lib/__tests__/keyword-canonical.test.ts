import { describe, it, expect } from 'vitest';
import { canonicalKeywordKey, canonicalTokenSet } from '../keyword-canonical.js';

// Behavior-preservation tests for the extraction from pipeline-generate.ts —
// these cases mirror the function's own doc comment.
describe('canonicalKeywordKey', () => {
  it('collapses word order, state qualifiers, and morphology', () => {
    const variants = ['locksmith boise', 'locksmiths boise idaho', 'boise locksmith', 'boise locksmithing'];
    const keys = new Set(variants.map(canonicalKeywordKey));
    expect(keys.size).toBe(1);
  });

  it('treats hyphens as spaces', () => {
    expect(canonicalKeywordKey('tri-valley plumbing')).toBe(canonicalKeywordKey('tri valley plumber'));
  });

  it('normalizes & to and', () => {
    expect(canonicalKeywordKey('heating & cooling')).toBe(canonicalKeywordKey('heating and cooling'));
  });

  it('falls back to the raw keyword when everything strips away', () => {
    expect(canonicalKeywordKey('Idaho')).toBe('idaho');
  });
});

describe('canonicalTokenSet', () => {
  it('returns the stemmed token set with state tokens removed', () => {
    const tokens = canonicalTokenSet('Commercial Refrigeration Services Idaho');
    expect(tokens.has('commercial')).toBe(true);
    expect(tokens.has('refrigeration')).toBe(true);
    expect(tokens.has('service')).toBe(true);
    expect(tokens.has('idaho')).toBe(false);
  });
});
