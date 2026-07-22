/**
 * match.ts — Match {service, city} claims against the site inventory.
 *
 * Pure functions over canonicalTokenSet (the scout's own keyword identity —
 * stem/state-strip/token-sort), so "commercial refrigeration" matches a
 * /commercial-refrigeration-services page and city variants collapse.
 *
 * Match tiers:
 *   full    — every service token present, plus every city token when the
 *             claim names a city → PRESENT candidate.
 *   partial — service matches but the claimed city doesn't. A /plumbing page
 *             does not refute "no page targeting plumber coeur d'alene", but
 *             calling the claim ABSENT with that page in view would be
 *             overconfident either way → UNRESOLVABLE (ambiguous), flagged.
 *   none    — no service match on any page.
 */

import { canonicalTokenSet } from '../../lib/keyword-canonical.js';
import type { ExtractedClaim, InventoryPage, InventoryQuality, Verdict } from './types.js';

export interface MatchResult {
  status: 'full' | 'partial' | 'none';
  page: InventoryPage | null;
}

/** Text signals a page offers for matching: slugged path, nav label, title, h1. */
export function pageMatchTexts(page: InventoryPage): string[] {
  const texts: string[] = [];
  const path = page.url.split('?')[0].replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);
  if (segments.length > 0) {
    texts.push(segments[segments.length - 1].replace(/[-_]+/g, ' '));
    texts.push(segments.join(' ').replace(/[-_]+/g, ' '));
  }
  if (page.nav_label) texts.push(page.nav_label);
  if (page.title) texts.push(page.title);
  if (page.h1) texts.push(page.h1);
  return texts;
}

function containsAll(haystack: Set<string>, needles: Set<string>): boolean {
  if (needles.size === 0) return false;
  for (const n of needles) if (!haystack.has(n)) return false;
  return true;
}

export function matchClaim(claim: ExtractedClaim, pages: InventoryPage[]): MatchResult {
  const serviceTokens = canonicalTokenSet(claim.service);
  const cityTokens = claim.city ? canonicalTokenSet(claim.city) : null;
  let partial: InventoryPage | null = null;

  for (const page of pages) {
    for (const text of pageMatchTexts(page)) {
      const tokens = canonicalTokenSet(text);
      if (!containsAll(tokens, serviceTokens)) continue;
      // cityTokens can be empty after state-stripping (claim city was a bare
      // state, e.g. "Idaho") — treat as no city constraint, service match wins.
      if (!cityTokens || cityTokens.size === 0 || containsAll(tokens, cityTokens)) {
        return { status: 'full', page };
      }
      partial = partial ?? page;
    }
  }
  return partial ? { status: 'partial', page: partial } : { status: 'none', page: null };
}

/**
 * Verdict from a match + inventory context (spec §3 steps 3-5, with the
 * approved sitemap-only-ABSENT rule). Pure — the fetch layer feeds it.
 */
export function deriveVerdict(
  match: MatchResult['status'],
  quality: InventoryQuality,
  blocked: boolean,
): { verdict: Verdict; reason: string | null } {
  if (blocked) return { verdict: 'UNRESOLVABLE', reason: 'site bot-blocked (403/429)' };
  if (match === 'full') return { verdict: 'PRESENT', reason: null };
  if (match === 'partial') {
    return { verdict: 'UNRESOLVABLE', reason: 'service page exists without the claimed city — ambiguous match' };
  }
  if (quality === 'complete') return { verdict: 'ABSENT', reason: null };
  return {
    verdict: 'UNRESOLVABLE',
    reason: `no match, but inventory is ${quality} (no sitemap) — absence cannot be confirmed from this evidence`,
  };
}

/**
 * title_mismatch polarity is inverted: the claim says the page's title/H1
 * does NOT carry target_phrase. If an inspected matching page's title/H1
 * already contains the phrase, the recommendation is moot → PRESENT (cut).
 * If the page exists and genuinely lacks it → ABSENT (claim stands).
 */
export function titleMismatchVerdict(
  claim: ExtractedClaim,
  page: InventoryPage,
): { verdict: Verdict; reason: string | null } {
  if (!claim.target_phrase) return { verdict: 'UNRESOLVABLE', reason: 'title_mismatch claim without target_phrase' };
  if (page.title === null && page.h1 === null) {
    return { verdict: 'UNRESOLVABLE', reason: 'matched page not inspected — no title/h1 evidence' };
  }
  const target = canonicalTokenSet(claim.target_phrase);
  for (const text of [page.title, page.h1]) {
    if (text && containsAll(canonicalTokenSet(text), target)) {
      return { verdict: 'PRESENT', reason: 'title/H1 already carries the target phrase' };
    }
  }
  return { verdict: 'ABSENT', reason: null };
}
