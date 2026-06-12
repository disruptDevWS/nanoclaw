/**
 * serp-composition.ts — B1: SERP composition adjustment to effective difficulty.
 *
 * Raw KD treats every SERP the same; who actually holds the top-10 changes the
 * real difficulty. A KD-35 SERP where 4+ slots are Reddit threads and thin
 * directories is materially easier than a KD-35 SERP of niche authorities.
 *
 * Heuristic (knowledge base §SERP composition, kb-extraction-map B1):
 * - Classify each top-10 organic result: weak_slot (forums/UGC/aggregators/
 *   directories), direct_competitor (audit's industry_competitor list),
 *   client (own domain), authority (everything else).
 * - Effective KD modifier: ≥4 weak slots → KD × 0.7 (one tier easier);
 *   0–1 weak slots → KD × 1.3 (one tier harder); 2–3 → unchanged.
 * - Compared against the proven ceiling (cluster ceiling, site fallback) with
 *   +5 headroom to label each keyword within-reach vs stretch.
 *
 * Pure logic — SERP fetching and prompt injection live in pipeline-generate.ts.
 */

export type SerpSlotClass = 'weak_slot' | 'direct_competitor' | 'client' | 'authority';

export interface ClassifiedSerpResult {
  rank: number;
  domain: string;
  classification: SerpSlotClass;
}

export interface SerpCompositionEntry {
  keyword: string;
  canonical_key: string | null;
  kd: number;
  results: ClassifiedSerpResult[];
  weak_slots: number;
  direct_competitors: number;
  authorities: number;
  effective_kd: number;
  modifier: 'easier' | 'none' | 'harder';
  has_video_carousel: boolean;
  /** ceiling used for the verdict: cluster ceiling, else site ceiling, else null */
  ceiling_used: number | null;
  vs_ceiling: 'within_reach' | 'stretch' | 'unknown';
}

/** Forums, UGC, social, thin listicles, aggregators, generic directories. */
const WEAK_SLOT_DOMAINS = new Set([
  'reddit.com',
  'quora.com',
  'facebook.com',
  'instagram.com',
  'pinterest.com',
  'tiktok.com',
  'nextdoor.com',
  'yelp.com',
  'angi.com',
  'angieslist.com',
  'thumbtack.com',
  'homeadvisor.com',
  'porch.com',
  'houzz.com',
  'yellowpages.com',
  'superpages.com',
  'manta.com',
  'mapquest.com',
  'foursquare.com',
  'citysearch.com',
  'bbb.org',
  'tripadvisor.com',
  'groupon.com',
  'craigslist.org',
  'indeed.com',
  'ziprecruiter.com',
  'glassdoor.com',
  'care.com',
  'bark.com',
  'expertise.com',
  'threebestrated.com',
  'wikihow.com',
  'medium.com',
  'linktr.ee',
]);

const WEAK_SLOT_PATTERNS = [/(^|\.)forums?\./i, /\.fandom\.com$/i, /\.blogspot\.com$/i, /\.wordpress\.com$/i];

export function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '').replace(/\/.*$/, '');
}

export function classifySerpDomain(
  rawDomain: string,
  competitorDomains: Set<string>, // pre-normalized industry_competitor domains
  clientDomain: string,
): SerpSlotClass {
  const domain = normalizeDomain(rawDomain);
  if (domain === normalizeDomain(clientDomain)) return 'client';
  if (competitorDomains.has(domain)) return 'direct_competitor';
  if (WEAK_SLOT_DOMAINS.has(domain)) return 'weak_slot';
  if (WEAK_SLOT_PATTERNS.some((re) => re.test(domain))) return 'weak_slot';
  return 'authority';
}

export function computeEffectiveKd(
  kd: number,
  weakSlots: number,
): { effective_kd: number; modifier: 'easier' | 'none' | 'harder' } {
  if (weakSlots >= 4) return { effective_kd: Math.round(kd * 0.7), modifier: 'easier' };
  if (weakSlots <= 1) return { effective_kd: Math.round(kd * 1.3), modifier: 'harder' };
  return { effective_kd: kd, modifier: 'none' };
}

export const CEILING_HEADROOM = 5;

export function buildSerpCompositionEntry(params: {
  keyword: string;
  canonical_key: string | null;
  kd: number;
  organicDomains: Array<{ rank: number; domain: string }>; // top-10 organic
  hasVideoCarousel: boolean;
  competitorDomains: Set<string>;
  clientDomain: string;
  clusterCeiling: number | null;
  siteCeiling: number | null;
}): SerpCompositionEntry {
  const results: ClassifiedSerpResult[] = params.organicDomains.slice(0, 10).map((o) => ({
    rank: o.rank,
    domain: normalizeDomain(o.domain),
    classification: classifySerpDomain(o.domain, params.competitorDomains, params.clientDomain),
  }));

  const weakSlots = results.filter((r) => r.classification === 'weak_slot').length;
  const directCompetitors = results.filter((r) => r.classification === 'direct_competitor').length;
  const authorities = results.filter((r) => r.classification === 'authority').length;
  const { effective_kd, modifier } = computeEffectiveKd(params.kd, weakSlots);

  const ceilingUsed = params.clusterCeiling ?? params.siteCeiling;
  const vsCeiling =
    ceilingUsed === null ? 'unknown' : effective_kd <= ceilingUsed + CEILING_HEADROOM ? 'within_reach' : 'stretch';

  return {
    keyword: params.keyword,
    canonical_key: params.canonical_key,
    kd: params.kd,
    results,
    weak_slots: weakSlots,
    direct_competitors: directCompetitors,
    authorities,
    effective_kd,
    modifier,
    has_video_carousel: params.hasVideoCarousel,
    ceiling_used: ceilingUsed,
    vs_ceiling: vsCeiling,
  };
}

export interface SerpTargetKeyword {
  keyword: string;
  canonical_key: string | null;
  keyword_difficulty: number | null;
  is_brand: boolean | null;
  intent_type: string | null;
  search_volume: number | null;
  delta_revenue_mid: number | null;
}

/** Top opportunity keywords for targeted SERP lookups: non-brand, customer
 * intent, KD known; ranked by revenue opportunity then volume; spread across
 * clusters (max per cluster) to avoid spending all lookups on one topic. */
export function selectSerpTargets(
  keywords: SerpTargetKeyword[],
  maxTargets = 12,
  maxPerCluster = 2,
): SerpTargetKeyword[] {
  const eligible = keywords
    .filter((k) => k.is_brand !== true)
    .filter((k) => k.keyword_difficulty !== null)
    .filter((k) => {
      const intent = (k.intent_type ?? '').toLowerCase();
      return intent !== 'informational' && intent !== 'navigational';
    })
    .sort(
      (a, b) =>
        (b.delta_revenue_mid ?? 0) - (a.delta_revenue_mid ?? 0) ||
        (b.search_volume ?? 0) - (a.search_volume ?? 0),
    );

  const perCluster = new Map<string, number>();
  const selected: SerpTargetKeyword[] = [];
  for (const k of eligible) {
    if (selected.length >= maxTargets) break;
    const key = k.canonical_key ?? '__none__';
    const count = perCluster.get(key) ?? 0;
    if (count >= maxPerCluster) continue;
    perCluster.set(key, count + 1);
    selected.push(k);
  }
  return selected;
}

export function buildSerpCompositionBlock(
  entries: SerpCompositionEntry[],
  siteCeiling: number | null,
): string {
  if (entries.length === 0) return '';

  const lines = entries.map((e) => {
    const ceiling = e.ceiling_used !== null ? `KD ${e.ceiling_used}` : 'n/a';
    const video = e.has_video_carousel ? ' | VIDEO CAROUSEL' : '';
    return (
      `"${e.keyword}" [${e.canonical_key ?? 'unclustered'}]: raw KD ${e.kd} → effective KD ${e.effective_kd} (${e.modifier}) | ` +
      `top-10: ${e.weak_slots} weak / ${e.direct_competitors} competitor / ${e.authorities} authority | ` +
      `proven ceiling ${ceiling} → ${e.vs_ceiling.toUpperCase()}${video}`
    );
  });

  return `\n## SERP Composition — Effective Difficulty (live top-10 lookups)
Site proven ranking ceiling: ${siteCeiling !== null ? `KD ${siteCeiling}` : 'n/a (cold start — too few proven top-7 rankings)'}.
${lines.join('\n')}

NOTE: "Effective KD" adjusts raw keyword difficulty by who actually holds the top-10:
4+ weak slots (forums, UGC, directories, aggregators) → one tier easier (×0.7);
0–1 weak slots (wall-to-wall authorities) → one tier harder (×1.3).
The "proven ceiling" is the highest KD this client has demonstrably ranked top-7 for
(cluster-specific where available, site-wide otherwise). When assessing opportunity realism,
use effective KD against the ceiling — NOT raw KD: WITHIN_REACH keywords are realistic
near-term targets; STRETCH keywords need authority building first and their
priority_recommendations rationale must say so. A VIDEO CAROUSEL flag means embedded
video content significantly increases SERP real estate for that keyword — when present
on a gap topic, mention the video opportunity in that gap's coverage_note.
`;
}
