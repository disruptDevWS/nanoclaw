/**
 * proven-ceiling.ts — Empirical ranking ceiling from observed top-7 rankings (A3).
 *
 * Methodology (claude-code-seo /seo-analyze, adapted to audit_keywords data):
 * - "Owned" = keywords ranking position 1–7. Position proves the ceiling.
 * - Site ceiling = the highest KD at which the site has ≥2 owned rankings at or
 *   above that KD — i.e. the SECOND-highest KD among owned keywords. The ≥2
 *   guard prevents a single fluke top-7 win from setting the bar.
 * - Cluster ceiling = same computation within one canonical_key; null when the
 *   cluster has <2 owned keywords with KD (caller falls back to site ceiling).
 * - Cold start: <15 owned keywords total → no ceiling (DR prior applies instead).
 *
 * Replaces DR/DA as the rankability bar: a DR-20 site with 3 top-7 wins at
 * KD 35 in a cluster has demonstrably proven it can rank at KD 35 there.
 */

export interface CeilingKeyword {
  keyword: string;
  rank_pos: number | null;
  keyword_difficulty: number | null;
  canonical_key: string | null;
  canonical_topic: string | null;
  is_brand: boolean | null;
}

export interface ClusterCeiling {
  canonical_key: string;
  canonical_topic: string | null;
  /** null = <2 owned-with-KD keywords in cluster; fall back to site ceiling */
  ceiling: number | null;
  owned_with_kd: number;
  example_keyword: string | null;
}

export interface ProvenCeilingResult {
  cold_start: boolean;
  owned_count: number;
  owned_with_kd_count: number;
  site_ceiling: number | null;
  site_ceiling_example: { keyword: string; kd: number } | null;
  cluster_ceilings: ClusterCeiling[];
}

export const OWNED_MAX_POS = 7;
export const COLD_START_MIN_OWNED = 15;
/** Headroom above a ceiling before a keyword counts as a stretch target. */
export const CEILING_STRETCH_HEADROOM = 5;

/** Second-highest KD among owned keywords (≥2-rankings fluke guard). */
function ceilingFromKds(owned: Array<{ keyword: string; kd: number }>): {
  ceiling: number;
  example: { keyword: string; kd: number };
} | null {
  if (owned.length < 2) return null;
  const sorted = [...owned].sort((a, b) => b.kd - a.kd);
  const ceiling = sorted[1].kd;
  // Example: a keyword AT the ceiling (the one that defines it)
  const example = sorted.find((o) => o.kd === ceiling) ?? sorted[1];
  return { ceiling, example: { keyword: example.keyword, kd: example.kd } };
}

export function computeProvenCeiling(keywords: CeilingKeyword[]): ProvenCeilingResult {
  // Brand keywords don't prove topical authority — exclude them.
  const owned = keywords.filter(
    (k) => k.is_brand !== true && k.rank_pos !== null && k.rank_pos >= 1 && k.rank_pos <= OWNED_MAX_POS,
  );
  const ownedWithKd = owned
    .filter((k) => k.keyword_difficulty !== null)
    .map((k) => ({
      keyword: k.keyword,
      kd: k.keyword_difficulty as number,
      canonical_key: k.canonical_key,
      canonical_topic: k.canonical_topic,
    }));

  const coldStart = owned.length < COLD_START_MIN_OWNED;

  let siteCeiling: number | null = null;
  let siteExample: { keyword: string; kd: number } | null = null;
  if (!coldStart) {
    const site = ceilingFromKds(ownedWithKd);
    if (site) {
      siteCeiling = site.ceiling;
      siteExample = site.example;
    }
  }

  // Per-cluster ceilings (computed even on cold-start sites — they'll just be
  // mostly null; callers should ignore them when cold_start is true)
  const byCluster = new Map<string, typeof ownedWithKd>();
  for (const k of ownedWithKd) {
    if (!k.canonical_key) continue;
    if (!byCluster.has(k.canonical_key)) byCluster.set(k.canonical_key, []);
    byCluster.get(k.canonical_key)!.push(k);
  }

  const clusterCeilings: ClusterCeiling[] = [];
  for (const [key, kws] of byCluster) {
    const c = ceilingFromKds(kws);
    clusterCeilings.push({
      canonical_key: key,
      canonical_topic: kws[0].canonical_topic,
      ceiling: c?.ceiling ?? null,
      owned_with_kd: kws.length,
      example_keyword: c?.example.keyword ?? null,
    });
  }
  clusterCeilings.sort((a, b) => (b.ceiling ?? -1) - (a.ceiling ?? -1));

  return {
    cold_start: coldStart,
    owned_count: owned.length,
    owned_with_kd_count: ownedWithKd.length,
    site_ceiling: siteCeiling,
    site_ceiling_example: siteExample,
    cluster_ceilings: clusterCeilings,
  };
}

/**
 * Markdown prompt block for agent injection (Strategy Brief / Michael /
 * Cluster Strategy). `instruction` is the consumer-specific directive appended
 * after the data. Returns '' when there is nothing meaningful to say (no
 * keyword data at all). On cold-start sites it emits a short cold-start note
 * instead of ceilings. `focusClusterKey` narrows the cluster table to one
 * cluster (Cluster Strategy use case); otherwise the top `maxClusters` by
 * ceiling are listed.
 */
export function buildCeilingPromptBlock(
  result: ProvenCeilingResult,
  instruction: string,
  opts: { focusClusterKey?: string | null; maxClusters?: number } = {},
): string {
  if (result.owned_count === 0 && result.owned_with_kd_count === 0) return '';

  const header = `\n## Proven Ranking Ceiling (empirical authority — derived from actual top-7 rankings)\n`;

  if (result.cold_start || result.site_ceiling === null) {
    return `${header}This site is effectively COLD START: only ${result.owned_count} proven top-7 rankings (need 15+ for an empirical ceiling). Authority is unproven — treat all moderate-or-higher difficulty keywords as stretch targets requiring authority building, and prefer low-difficulty, low-competition targets for early wins.\n${instruction}\n`;
  }

  const lines: string[] = [];
  const example = result.site_ceiling_example
    ? ` (already ranks top-7 for "${result.site_ceiling_example.keyword}" at KD ${result.site_ceiling_example.kd})`
    : '';
  lines.push(`Site ceiling: KD ${result.site_ceiling}${example} — based on ${result.owned_count} proven top-7 rankings. This, not domain rating, is the empirical rankability bar.`);

  let clusterRows = result.cluster_ceilings;
  if (opts.focusClusterKey !== undefined) {
    clusterRows = clusterRows.filter((c) => c.canonical_key === opts.focusClusterKey);
  } else {
    clusterRows = clusterRows.slice(0, opts.maxClusters ?? 15);
  }
  if (clusterRows.length > 0) {
    lines.push(`Cluster ceilings (clusters without one fall back to the site ceiling):`);
    for (const c of clusterRows) {
      const ceiling = c.ceiling !== null
        ? `KD ${c.ceiling}${c.example_keyword ? ` (e.g. "${c.example_keyword}")` : ''}`
        : `no cluster-specific ceiling (${c.owned_with_kd} owned keyword${c.owned_with_kd === 1 ? '' : 's'} w/ KD — use site ceiling)`;
      lines.push(`- ${c.canonical_topic ?? c.canonical_key}: ${ceiling}`);
    }
  } else if (opts.focusClusterKey !== undefined) {
    lines.push(`This cluster has no proven top-7 rankings with difficulty data — use the site ceiling as the bar.`);
  }

  return `${header}${lines.join('\n')}\n\nA keyword more than ${CEILING_STRETCH_HEADROOM} KD points above the applicable ceiling (cluster ceiling where one exists, site ceiling otherwise) is a STRETCH TARGET: rankable only after additional authority building in that cluster.\n${instruction}\n`;
}
