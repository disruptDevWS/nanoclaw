/**
 * reeval-candidates.ts — NavBoost re-evaluation candidate detection (A1).
 *
 * NavBoost uses a rolling 13-month window of aggregated click data (Pandu Nayak
 * DOJ testimony). A page published when its cluster was small carries that stale
 * authority context; republishing under a new URL (+301) triggers evaluation
 * against the cluster's CURRENT authority.
 *
 * Candidate criteria (claude-code-seo /seo-re-eval, adapted):
 * - page ranks position 8–25 (visible but not top)
 * - target keyword KD < 30 (rankable given cluster authority)
 * - cluster keyword count grew >2.0× since the page's publish date
 *   (from cluster_performance_snapshots history)
 * - page is >6 months old (publish date; pages predating tracking are treated
 *   as old, with growth factor marked as a lower bound)
 */

export interface ReevalKeyword {
  keyword: string;
  rank_pos: number | null;
  keyword_difficulty: number | null;
  canonical_key: string | null;
  ranking_url: string | null;
  search_volume: number | null;
  is_brand: boolean | null;
}

export interface ClusterSnapshot {
  snapshot_date: string; // YYYY-MM-DD
  keyword_count: number;
}

export interface ReevalOptions {
  minPos: number;
  maxPos: number;
  maxKd: number;
  minGrowth: number;
  minAgeMonths: number;
  minImpressions: number;
  now: Date;
}

export const DEFAULT_REEVAL_OPTIONS: Omit<ReevalOptions, 'now'> = {
  minPos: 8,
  maxPos: 25,
  maxKd: 30,
  minGrowth: 2.0,
  minAgeMonths: 6,
  minImpressions: 0,
};

export interface ReevalCandidate {
  page_path: string;
  primary_keyword: string;
  primary_keyword_position: number;
  primary_keyword_kd: number;
  canonical_key: string | null;
  matching_keywords: number;
  publish_date: string | null; // null = predates tracking / unknown (treated as old)
  age_months: number | null;
  cluster_count_at_publish: number | null;
  cluster_count_now: number | null;
  growth_factor: number | null;
  growth_is_lower_bound: boolean;
  impressions: number | null; // latest GSC snapshot, null = no GSC row for path
  gsc_avg_position: number | null;
  estimated_lift: string; // e.g. "≈5x traffic at position 5"
}

/** Sparse CTR-by-position curve for lift estimation (industry-standard organic
 * CTR approximations; only relative ratios matter here). */
const CTR_BY_POSITION: Array<[maxPos: number, ctr: number]> = [
  [1, 0.284],
  [2, 0.147],
  [3, 0.094],
  [4, 0.064],
  [5, 0.049],
  [6, 0.037],
  [7, 0.029],
  [8, 0.023],
  [9, 0.019],
  [10, 0.016],
  [15, 0.01],
  [20, 0.007],
  [25, 0.005],
];

function ctrAt(pos: number): number {
  for (const [maxPos, ctr] of CTR_BY_POSITION) {
    if (pos <= maxPos) return ctr;
  }
  return 0.004;
}

export function estimateLift(currentPos: number, targetPos = 5): string {
  const ratio = ctrAt(targetPos) / ctrAt(currentPos);
  return `≈${Math.round(ratio)}x traffic at position ${targetPos}`;
}

export function normalizePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return url.replace(/\/+$/, '') || '/';
  }
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

/** Cluster keyword count at (or nearest before) a date; falls back to the
 * earliest snapshot when the date predates history (lower-bound case). */
function countAtDate(
  history: ClusterSnapshot[], // sorted ascending by snapshot_date
  date: string | null,
): { count: number; isLowerBound: boolean } | null {
  if (history.length === 0) return null;
  if (date === null || date < history[0].snapshot_date) {
    return { count: history[0].keyword_count, isLowerBound: true };
  }
  let best = history[0];
  for (const snap of history) {
    if (snap.snapshot_date <= date) best = snap;
    else break;
  }
  return { count: best.keyword_count, isLowerBound: false };
}

export function detectReevalCandidates(
  keywords: ReevalKeyword[],
  clusterHistory: Map<string, ClusterSnapshot[]>, // canonical_key → snapshots ASC
  pagePublishDates: Map<string, string>, // path → YYYY-MM-DD
  gscByPath: Map<string, { impressions: number; avg_position: number }>,
  options: ReevalOptions,
): ReevalCandidate[] {
  // Keywords in the band with rankable KD, grouped by page path
  const eligible = keywords.filter(
    (k) =>
      k.is_brand !== true &&
      k.ranking_url &&
      k.rank_pos !== null &&
      k.rank_pos >= options.minPos &&
      k.rank_pos <= options.maxPos &&
      k.keyword_difficulty !== null &&
      k.keyword_difficulty < options.maxKd,
  );

  const byPath = new Map<string, ReevalKeyword[]>();
  for (const k of eligible) {
    const p = normalizePath(k.ranking_url!);
    if (!byPath.has(p)) byPath.set(p, []);
    byPath.get(p)!.push(k);
  }

  const candidates: ReevalCandidate[] = [];
  for (const [pagePath, kws] of byPath) {
    const primary = [...kws].sort((a, b) => (b.search_volume ?? 0) - (a.search_volume ?? 0))[0];
    const clusterKey = primary.canonical_key;
    const history = clusterKey ? (clusterHistory.get(clusterKey) ?? []) : [];
    if (history.length === 0) continue; // no cluster history → growth unknowable

    const publishDate = pagePublishDates.get(pagePath) ?? null;

    // Age gate: unknown publish date = pre-existing page, treated as old
    let ageMonths: number | null = null;
    if (publishDate !== null) {
      ageMonths = monthsBetween(new Date(publishDate), options.now);
      if (ageMonths < options.minAgeMonths) continue;
    }

    const baseline = countAtDate(history, publishDate);
    if (!baseline || baseline.count === 0) continue;
    const current = history[history.length - 1].keyword_count;
    const growth = current / baseline.count;
    if (growth <= options.minGrowth) continue;

    const gsc = gscByPath.get(pagePath) ?? null;
    if (gsc && gsc.impressions < options.minImpressions) continue;
    if (!gsc && options.minImpressions > 0) continue;

    candidates.push({
      page_path: pagePath,
      primary_keyword: primary.keyword,
      primary_keyword_position: primary.rank_pos!,
      primary_keyword_kd: primary.keyword_difficulty!,
      canonical_key: clusterKey,
      matching_keywords: kws.length,
      publish_date: publishDate,
      age_months: ageMonths !== null ? Math.round(ageMonths * 10) / 10 : null,
      cluster_count_at_publish: baseline.count,
      cluster_count_now: current,
      growth_factor: Math.round(growth * 100) / 100,
      growth_is_lower_bound: baseline.isLowerBound,
      impressions: gsc?.impressions ?? null,
      gsc_avg_position: gsc?.avg_position ?? null,
      estimated_lift: estimateLift(primary.rank_pos!),
    });
  }

  candidates.sort((a, b) => (b.growth_factor ?? 0) - (a.growth_factor ?? 0));
  return candidates;
}
