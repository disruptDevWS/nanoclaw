import { describe, it, expect } from 'vitest';
import { matchClaim, deriveVerdict, titleMismatchVerdict, pageMatchTexts } from '../match.js';
import type { ExtractedClaim, InventoryPage } from '../types.js';

function claim(over: Partial<ExtractedClaim> = {}): ExtractedClaim {
  return {
    claim_id: 'c1',
    type: 'page_absent',
    service: 'commercial refrigeration',
    city: null,
    target_phrase: null,
    asserted_text: 'no dedicated page for commercial refrigeration',
    phrasing: 'pure_absence',
    ...over,
  };
}

function page(url: string, over: Partial<InventoryPage> = {}): InventoryPage {
  return { url, title: null, h1: null, nav_label: null, source: 'sitemap', ...over };
}

describe('matchClaim', () => {
  it('matches a service slug despite morphology (services suffix)', () => {
    const result = matchClaim(claim(), [page('/commercial-refrigeration-services')]);
    expect(result.status).toBe('full');
    expect(result.page?.url).toBe('/commercial-refrigeration-services');
  });

  it('matches via nav label when the slug is opaque', () => {
    const result = matchClaim(claim(), [page('/svc/42', { nav_label: 'Commercial Refrigeration', source: 'nav' })]);
    expect(result.status).toBe('full');
  });

  it('collapses plural/-ing service variants (plumber vs plumbing)', () => {
    const result = matchClaim(claim({ service: 'plumber' }), [page('/plumbing')]);
    expect(result.status).toBe('full');
  });

  it('requires city tokens when the claim names a city', () => {
    const result = matchClaim(claim({ service: 'plumber', city: 'coeur d alene' }), [page('/plumbing')]);
    expect(result.status).toBe('partial');
  });

  it('full-matches service+city pages', () => {
    const result = matchClaim(claim({ service: 'plumber', city: 'spokane' }), [page('/spokane-plumbing')]);
    expect(result.status).toBe('full');
  });

  it('treats a bare-state city as no city constraint (state tokens strip)', () => {
    const result = matchClaim(claim({ service: 'plumber', city: 'Idaho' }), [page('/plumbing')]);
    expect(result.status).toBe('full');
  });

  it('returns none when no page covers the service', () => {
    const result = matchClaim(claim(), [page('/about-us'), page('/contact')]);
    expect(result.status).toBe('none');
  });
});

describe('pageMatchTexts', () => {
  it('slugs the last segment and the joined path', () => {
    const texts = pageMatchTexts(page('/services/water-heater-repair'));
    expect(texts).toContain('water heater repair');
    expect(texts).toContain('services water heater repair');
  });
});

describe('deriveVerdict (sitemap-only-ABSENT rule)', () => {
  it('full match → PRESENT', () => {
    expect(deriveVerdict('full', 'complete', false).verdict).toBe('PRESENT');
  });

  it('no match on complete inventory → ABSENT', () => {
    expect(deriveVerdict('none', 'complete', false).verdict).toBe('ABSENT');
  });

  it('no match on nav_only inventory → UNRESOLVABLE, never ABSENT', () => {
    const { verdict, reason } = deriveVerdict('none', 'nav_only', false);
    expect(verdict).toBe('UNRESOLVABLE');
    expect(reason).toMatch(/nav_only/);
  });

  it('no match on thin inventory → UNRESOLVABLE', () => {
    expect(deriveVerdict('none', 'thin', false).verdict).toBe('UNRESOLVABLE');
  });

  it('partial match → UNRESOLVABLE (ambiguous), even on complete inventory', () => {
    expect(deriveVerdict('partial', 'complete', false).verdict).toBe('UNRESOLVABLE');
  });

  it('bot-blocked → UNRESOLVABLE regardless of match', () => {
    expect(deriveVerdict('full', 'complete', true).verdict).toBe('UNRESOLVABLE');
  });
});

describe('titleMismatchVerdict (inverted polarity)', () => {
  const tmClaim = claim({ type: 'title_mismatch', target_phrase: 'water heater repair spokane' });

  it('title already carries the phrase → PRESENT (recommendation moot)', () => {
    const p = page('/water-heater', { title: 'Water Heater Repair in Spokane | Acme' });
    expect(titleMismatchVerdict(tmClaim, p).verdict).toBe('PRESENT');
  });

  it('page exists but title lacks the phrase → ABSENT (claim stands)', () => {
    const p = page('/water-heater', { title: 'Our Services', h1: 'What We Do' });
    expect(titleMismatchVerdict(tmClaim, p).verdict).toBe('ABSENT');
  });

  it('uninspected page (no title/h1 evidence) → UNRESOLVABLE', () => {
    expect(titleMismatchVerdict(tmClaim, page('/water-heater')).verdict).toBe('UNRESOLVABLE');
  });
});
