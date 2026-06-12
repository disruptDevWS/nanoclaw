/**
 * llm-citation.ts — GSC zero-click fan-out detection (A2).
 *
 * LLM fan-out citation signature: the client ranks top-10 for a query with
 * significant impressions but ZERO clicks — the page was retrieved/cited for
 * answer synthesis but users never clicked through from a SERP. Complementary
 * to DataForSEO LLM Mentions (first-party GSC signal vs third-party coverage).
 *
 * Hard filters: position ≤ 10, clicks = 0, impressions ≥ threshold.
 * Signal filter (at least one): query > 5 words, or evaluative/comparative language.
 */

export interface QueryPageRow {
  query: string;
  page: string; // full URL from GSC
  clicks: number;
  impressions: number;
  position: number;
}

export interface LlmCitationOptions {
  maxPosition: number;
  minImpressions: number;
  minWordsExclusive: number; // flag when word count is STRICTLY greater
}

export const DEFAULT_LLM_CITATION_OPTIONS: LlmCitationOptions = {
  maxPosition: 10,
  minImpressions: 50,
  minWordsExclusive: 5,
};

/** Evaluative/comparative phrasing typical of LLM fan-out queries. */
const EVALUATIVE_RE =
  /\b(evaluate|compare|comparison|best|top|vs|versus|alternative|alternatives|review|reviews|worth it|pros and cons|difference between|which is|should i|better than)\b/i;

export interface LlmCitationFlag {
  query: string;
  page: string;
  position: number;
  impressions: number;
  word_count: number;
  reasons: Array<'long_query' | 'evaluative_language'>;
}

export function detectLlmCitationQueries(
  rows: QueryPageRow[],
  options: LlmCitationOptions = DEFAULT_LLM_CITATION_OPTIONS,
): LlmCitationFlag[] {
  const flags: LlmCitationFlag[] = [];
  for (const row of rows) {
    if (row.clicks !== 0) continue;
    if (row.impressions < options.minImpressions) continue;
    if (row.position > options.maxPosition) continue;

    const wordCount = row.query.trim().split(/\s+/).length;
    const reasons: LlmCitationFlag['reasons'] = [];
    if (wordCount > options.minWordsExclusive) reasons.push('long_query');
    if (EVALUATIVE_RE.test(row.query)) reasons.push('evaluative_language');
    if (reasons.length === 0) continue;

    flags.push({
      query: row.query,
      page: row.page,
      position: Math.round(row.position * 10) / 10,
      impressions: row.impressions,
      word_count: wordCount,
      reasons,
    });
  }
  flags.sort((a, b) => b.impressions - a.impressions);
  return flags;
}
