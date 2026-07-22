/**
 * keyword-canonical.ts — Canonical keyword identity, shared across the pipeline.
 *
 * ONE canonical key (canonicalKeywordKey) is used for every scout keyword
 * comparison: within-set dedup of ranked + opportunity keywords, the
 * gap-matrix cross-join, the recipient-facing variant collapse, and the
 * outreach claim verifier's site-inventory match. Google treats word-order,
 * state-qualifier, plural, and -ing/-er variants as the same query
 * ("idaho falls plumbing" / "plumber idaho falls"), so a prospect must never
 * see one variant ranked and another called a gap. Over-merging errs
 * conservative: worst case the report claims slightly less opportunity.
 *
 * Extracted verbatim from scripts/pipeline-generate.ts (2026-07-22) so the
 * outreach verifier shares the exact identity function the scout used when
 * it asserted the gap.
 */

// Abbreviation → full name for flexible matching
export const STATE_ABBREV_TO_FULL: Record<string, string> = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'DC': 'District of Columbia', 'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii',
  'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
  'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine',
  'MD': 'Maryland', 'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota',
  'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska',
  'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico',
  'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
  'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island',
  'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas',
  'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington',
  'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
};

const ALL_STATE_TOKENS = new Set([
  ...Object.keys(STATE_ABBREV_TO_FULL).map((s) => s.toLowerCase()),
  ...Object.values(STATE_ABBREV_TO_FULL).map((s) => s.toLowerCase()),
]);

/**
 * Stem a keyword token to its service root: plurals first, then -ing/-er
 * morphology, so "plumbers"/"plumber"/"plumbing" → "plumb" and
 * "heating"/"heater" → "heat". Length floors keep short words intact
 * ("water", "sewer" are unchanged). Stems are join keys, never displayed.
 */
export function stemKeywordToken(t: string): string {
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
  if (t.length >= 6 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length >= 6 && t.endsWith('er')) return t.slice(0, -2);
  return t;
}

/**
 * Canonical key for scout keyword identity. Drops state tokens (full names
 * and abbreviations) anywhere in the keyword, normalizes "&" to "and", stems
 * plurals and -ing/-er forms, and sorts tokens, so "locksmith boise",
 * "locksmiths boise idaho", "boise locksmith", and "boise locksmithing"
 * collapse to a single key.
 */
export function canonicalKeywordKey(kw: string): string {
  const tokens = kw
    .toLowerCase()
    .trim()
    .split(/[\s-]+/) // hyphens too: "tri-valley" and "tri valley" are the same variant
    .map((t) => (t === '&' ? 'and' : t))
    .filter((t) => t.length > 0 && !ALL_STATE_TOKENS.has(t))
    .map(stemKeywordToken);
  return tokens.sort().join(' ') || kw.toLowerCase().trim();
}

/**
 * Stemmed token set for containment checks (the verifier's "does this page
 * cover this service" test). Same normalization as canonicalKeywordKey but
 * returns the token set instead of the sorted join.
 */
export function canonicalTokenSet(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .trim()
    .split(/[\s-]+/)
    .map((t) => (t === '&' ? 'and' : t))
    .filter((t) => t.length > 0 && !ALL_STATE_TOKENS.has(t))
    .map(stemKeywordToken);
  return new Set(tokens);
}
