import { describe, it, expect } from 'vitest';
import { cutSentence, softenClaim, coherenceGate, hookEndIndex, deriveDisposition } from '../subtract.js';
import type { VerifiedClaim } from '../types.js';

const BODY = `Hi Sam,

I ran the numbers on your search presence. There is no dedicated page for commercial refrigeration on your site. People searching for it are finding your competitors instead.

I put together a short scouting report: https://example.com/share/abc

Worth a 15-minute call?

Matt
Forge Growth`;

describe('cutSentence', () => {
  it('removes exactly the sentence containing the asserted text', () => {
    const out = cutSentence(BODY, 'no dedicated page for commercial refrigeration');
    expect(out).not.toBeNull();
    expect(out).not.toContain('no dedicated page');
    expect(out).toContain('I ran the numbers');
    expect(out).toContain('finding your competitors');
    expect(out).toContain('Matt\nForge Growth');
  });

  it('returns null when the text is absent (fail loud, no guess)', () => {
    expect(cutSentence(BODY, 'text that is not in the draft')).toBeNull();
  });

  it('returns null for multi-line asserted text', () => {
    expect(cutSentence(BODY, 'your site.\n\nI put together')).toBeNull();
  });

  it('does not eat neighboring sentences', () => {
    const body = 'First point. There is nothing there for plumbing. Third point.';
    const out = cutSentence(body, 'nothing there for plumbing');
    expect(out).toBe('First point. Third point.');
  });
});

describe('softenClaim (whitelist only)', () => {
  it('softens "zero presence" to "limited presence"', () => {
    const body = 'You have zero presence in Spokane right now.';
    const out = softenClaim(body, 'zero presence in Spokane');
    expect(out).toBe('You have limited presence in Spokane right now.');
  });

  it('softens "no real search presence"', () => {
    const body = 'There is no real search presence behind them.';
    expect(softenClaim(body, 'no real search presence behind them')).toContain('a limited search presence');
  });

  it('returns null when no whitelist pattern applies (flag, never mangle)', () => {
    const body = 'You are completely invisible in Spokane.';
    expect(softenClaim(body, 'completely invisible in Spokane')).toBeNull();
  });
});

describe('coherenceGate', () => {
  const longEnough = Array(110).fill('word').join(' ');
  const tooShort = Array(60).fill('word').join(' ');

  it('does not trip without cuts', () => {
    expect(coherenceGate(tooShort, 'pitch', false).applied).toBe(false);
  });

  it('trips when cuts drop a pitch below 100 words', () => {
    const check = coherenceGate(tooShort, 'pitch', true);
    expect(check.applied).toBe(true);
    expect(check.reason).toMatch(/floor 100/);
  });

  it('passes a post-cut body above the floor', () => {
    expect(coherenceGate(longEnough, 'pitch', true).applied).toBe(false);
  });

  it('uses the 80-word floor for courtesy notes', () => {
    expect(coherenceGate(Array(85).fill('w').join(' '), 'courtesy_note', true).applied).toBe(false);
    expect(coherenceGate(Array(70).fill('w').join(' '), 'courtesy_note', true).applied).toBe(true);
  });
});

function vClaim(over: Partial<VerifiedClaim>): VerifiedClaim {
  return {
    claim_id: 'c1',
    type: 'page_absent',
    service: 'plumbing',
    city: null,
    target_phrase: null,
    asserted_text: 'no dedicated page for plumbing',
    phrasing: 'pure_absence',
    verdict: 'ABSENT',
    matched_page: null,
    evidence_url: null,
    reason: null,
    action: 'kept',
    occurred_at: '2026-07-22T00:00:00Z',
    ...over,
  };
}

describe('hookEndIndex', () => {
  it('spans the greeting plus first two sentences', () => {
    const end = hookEndIndex(BODY);
    expect(BODY.slice(0, end)).toContain('no dedicated page for commercial refrigeration');
    expect(BODY.slice(0, end)).not.toContain('scouting report');
  });
});

describe('deriveDisposition', () => {
  const noGate = { applied: false, reason: null };

  it('all ABSENT → clean', () => {
    expect(deriveDisposition([vClaim({})], 'pitch', BODY, noGate, 0, 0)).toBe('clean');
  });

  it('PRESENT in the pitch hook zone → killed', () => {
    const c = vClaim({
      verdict: 'PRESENT',
      action: 'cut',
      asserted_text: 'no dedicated page for commercial refrigeration',
    });
    expect(deriveDisposition([c], 'pitch', BODY, noGate, 0, 0)).toBe('killed');
  });

  it('PRESENT in the hook zone of a courtesy note → weakened, not killed', () => {
    const c = vClaim({
      verdict: 'PRESENT',
      action: 'cut',
      asserted_text: 'no dedicated page for commercial refrigeration',
    });
    expect(deriveDisposition([c], 'courtesy_note', BODY, noGate, 0, 0)).toBe('weakened');
  });

  it('any flagged claim → needs_review', () => {
    const c = vClaim({ verdict: 'UNRESOLVABLE', action: 'flagged' });
    expect(deriveDisposition([c], 'pitch', BODY, noGate, 0, 0)).toBe('needs_review');
  });

  it('invalid extractor output → needs_review even with clean claims', () => {
    expect(deriveDisposition([vClaim({})], 'pitch', BODY, noGate, 1, 0)).toBe('needs_review');
  });

  it('sweep hits → needs_review', () => {
    expect(deriveDisposition([vClaim({})], 'pitch', BODY, noGate, 0, 1)).toBe('needs_review');
  });

  it('coherence-gate trip → needs_review', () => {
    const c = vClaim({ verdict: 'PRESENT', action: 'cut', asserted_text: 'finding your competitors instead' });
    expect(deriveDisposition([c], 'pitch', BODY, { applied: true, reason: 'floor' }, 0, 0)).toBe('needs_review');
  });
});
