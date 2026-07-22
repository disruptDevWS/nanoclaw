import { describe, it, expect } from 'vitest';
import { validateClaims } from '../extract-claims.js';

const SUBJECT = 'Spokane searches are missing you';
const BODY = 'Hi Sam,\n\nThere is no dedicated page for commercial refrigeration on your site.\n\nMatt';

describe('validateClaims (fail-loud substring validation)', () => {
  it('accepts a verbatim body substring', () => {
    const { claims, invalidCount } = validateClaims(
      [
        {
          type: 'page_absent',
          service: 'commercial refrigeration',
          city: null,
          asserted_text: 'no dedicated page for commercial refrigeration',
          phrasing: 'pure_absence',
        },
      ],
      SUBJECT,
      BODY,
    );
    expect(claims).toHaveLength(1);
    expect(invalidCount).toBe(0);
    expect(claims[0].in_subject).toBeUndefined();
  });

  it('drops paraphrased (non-substring) asserted_text and counts it', () => {
    const { claims, invalidCount } = validateClaims(
      [
        {
          type: 'page_absent',
          service: 'commercial refrigeration',
          city: null,
          asserted_text: 'no page exists for commercial refrigeration', // paraphrase
          phrasing: 'pure_absence',
        },
      ],
      SUBJECT,
      BODY,
    );
    expect(claims).toHaveLength(0);
    expect(invalidCount).toBe(1);
  });

  it('marks subject-line claims in_subject (not subtractable)', () => {
    const { claims } = validateClaims(
      [
        {
          type: 'page_absent',
          service: 'anything',
          city: 'spokane',
          asserted_text: 'Spokane searches are missing you',
          phrasing: 'ambiguous_presence',
        },
      ],
      SUBJECT,
      BODY,
    );
    expect(claims[0].in_subject).toBe(true);
  });

  it('drops title_mismatch without target_phrase', () => {
    const { invalidCount } = validateClaims(
      [
        {
          type: 'title_mismatch',
          service: 'refrigeration',
          city: null,
          asserted_text: 'no dedicated page for commercial refrigeration',
          phrasing: 'pure_absence',
        },
      ],
      SUBJECT,
      BODY,
    );
    expect(invalidCount).toBe(1);
  });

  it('drops unknown type/phrasing values', () => {
    const { invalidCount } = validateClaims(
      [{ type: 'rank_claim', service: 'x', asserted_text: 'Hi Sam,', phrasing: 'pure_absence' }],
      SUBJECT,
      BODY,
    );
    expect(invalidCount).toBe(1);
  });
});
