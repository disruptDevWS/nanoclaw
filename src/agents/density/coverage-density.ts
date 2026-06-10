/**
 * coverage-density.ts — Compute keyword coverage density scores.
 *
 * For each cluster: % of the cluster's keywords semantically covered by the
 * client's existing page content (headings + page title/h1 corpus), plus a
 * parallel score against the competitor heading corpus for comparison.
 *
 * Distinct from Phase 4b coverage_score (% of competitor headings covered) —
 * different denominator: here the keywords ARE the denominator.
 *
 * Density formula: round(100 × covered_keywords / keyword_count)
 * where covered = 1 if best corpus match ≥ DENSITY_THRESHOLD, else 0.
 */

import { embedBatch, cosineSimilarity } from '../../embeddings/index.js';

// ── Thresholds ──
// Keyword↔content similarity runs lower than heading↔heading (4b uses 0.85),
// so the covered threshold is 0.80. Borderline band logged for tuning.
export const DENSITY_THRESHOLD = 0.80;
export const DENSITY_BORDERLINE_LOW = 0.72;
export const DENSITY_BORDERLINE_HIGH = 0.83;

// ── Types ──

export interface DensityKeyword {
  /** audit_keywords.id — used as embedding contentId for cache hits */
  id: string;
  keyword: string;
}

export interface CorpusText {
  text: string;
  /** Embedding contentId (reuse Phase 4b IDs for heading rows) */
  contentId: string;
}

export type DensityStatus = 'scored' | 'no_client_content' | 'no_keywords';

export interface BorderlineDensityMatch {
  keyword: string;
  best_client_match: string;
  similarity: number;
}

export interface CoverageDensityResult {
  density_score: number | null;
  competitor_density_score: number | null;
  density_status: DensityStatus;
  keyword_count: number;
  covered_keywords: number;
  competitor_covered_keywords: number;
  borderline: BorderlineDensityMatch[];
}

/**
 * Compute coverage density for a single cluster.
 *
 * @param canonicalKey     Cluster key (logging/context only)
 * @param keywords         Cluster keywords (id used for embedding cache hits)
 * @param clientTexts      Client content corpus (site-wide headings + page title|h1)
 * @param competitorTexts  Competitor heading corpus (per-cluster)
 * @param threshold        Cosine similarity threshold for "covered" (default 0.80)
 */
export async function computeCoverageDensity(
  canonicalKey: string,
  keywords: DensityKeyword[],
  clientTexts: CorpusText[],
  competitorTexts: CorpusText[],
  threshold: number = DENSITY_THRESHOLD,
): Promise<CoverageDensityResult> {
  // Guard: no keywords
  if (keywords.length === 0) {
    return {
      density_score: null,
      competitor_density_score: null,
      density_status: 'no_keywords',
      keyword_count: 0,
      covered_keywords: 0,
      competitor_covered_keywords: 0,
      borderline: [],
    };
  }

  // Guard: no client content
  if (clientTexts.length === 0) {
    return {
      density_score: null,
      competitor_density_score: null,
      density_status: 'no_client_content',
      keyword_count: keywords.length,
      covered_keywords: 0,
      competitor_covered_keywords: 0,
      borderline: [],
    };
  }

  // Embed all sides (keywords reuse 'keyword' cache entries from Phase 3)
  const keywordItems = keywords.map((k) => ({
    text: k.keyword,
    contentType: 'keyword' as const,
    contentId: k.id,
  }));
  const clientItems = clientTexts.map((t) => ({
    text: t.text,
    contentType: 'page_section' as const,
    contentId: t.contentId,
  }));
  const competitorItems = competitorTexts.map((t) => ({
    text: t.text,
    contentType: 'page_section' as const,
    contentId: t.contentId,
  }));

  const [keywordEmbeddings, clientEmbeddings, competitorEmbeddings] = await Promise.all([
    embedBatch(keywordItems),
    embedBatch(clientItems),
    embedBatch(competitorItems),
  ]);

  const borderline: BorderlineDensityMatch[] = [];
  let scoredKeywords = 0;
  let coveredClient = 0;
  let coveredCompetitor = 0;

  for (let i = 0; i < keywords.length; i++) {
    const kwEmb = keywordEmbeddings[i]?.embedding;
    if (!kwEmb) continue; // embedding failure → exclude from denominator
    scoredKeywords++;

    // Best match against client corpus
    let bestClientSim = 0;
    let bestClientText = '';
    for (let j = 0; j < clientTexts.length; j++) {
      const emb = clientEmbeddings[j]?.embedding;
      if (!emb) continue;
      const sim = cosineSimilarity(kwEmb, emb);
      if (sim > bestClientSim) {
        bestClientSim = sim;
        bestClientText = clientTexts[j].text;
      }
    }
    if (bestClientSim >= threshold) coveredClient++;

    // Borderline band logged for threshold tuning
    if (bestClientSim >= DENSITY_BORDERLINE_LOW && bestClientSim <= DENSITY_BORDERLINE_HIGH) {
      borderline.push({
        keyword: keywords[i].keyword,
        best_client_match: bestClientText,
        similarity: Math.round(bestClientSim * 1000) / 1000,
      });
    }

    // Best match against competitor corpus
    if (competitorTexts.length > 0) {
      let bestCompSim = 0;
      for (let j = 0; j < competitorTexts.length; j++) {
        const emb = competitorEmbeddings[j]?.embedding;
        if (!emb) continue;
        const sim = cosineSimilarity(kwEmb, emb);
        if (sim > bestCompSim) bestCompSim = sim;
      }
      if (bestCompSim >= threshold) coveredCompetitor++;
    }
  }

  // All keyword embeddings failed → treat as unscoreable
  if (scoredKeywords === 0) {
    return {
      density_score: null,
      competitor_density_score: null,
      density_status: 'no_keywords',
      keyword_count: keywords.length,
      covered_keywords: 0,
      competitor_covered_keywords: 0,
      borderline: [],
    };
  }

  return {
    density_score: Math.round((coveredClient / scoredKeywords) * 100),
    competitor_density_score: competitorTexts.length > 0
      ? Math.round((coveredCompetitor / scoredKeywords) * 100)
      : null,
    density_status: 'scored',
    keyword_count: scoredKeywords,
    covered_keywords: coveredClient,
    competitor_covered_keywords: coveredCompetitor,
    borderline,
  };
}
