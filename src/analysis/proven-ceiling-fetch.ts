/**
 * proven-ceiling-fetch.ts — Supabase-backed wrapper for computeProvenCeiling.
 *
 * Shared by Strategy Brief (1b), Michael (6), Cluster Strategy, and Gap (5).
 * Paginated full fetch (PostgREST max-rows=1000 — IMA alone has 1099 rows).
 * Callers wrap in try/catch and treat the ceiling as optional context:
 * a first pipeline run has no audit_keywords yet (Phase 1b runs before Jim),
 * which yields an empty result — buildCeilingPromptBlock returns '' for it.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { computeProvenCeiling, ProvenCeilingResult } from './proven-ceiling.js';

export async function fetchProvenCeiling(
  sb: SupabaseClient,
  auditId: string,
): Promise<ProvenCeilingResult> {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await (sb as any)
      .from('audit_keywords')
      .select('keyword, rank_pos, keyword_difficulty, canonical_key, canonical_topic, is_brand')
      .eq('audit_id', auditId)
      .range(from, from + 999);
    if (error) throw new Error(`audit_keywords fetch failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return computeProvenCeiling(rows);
}
