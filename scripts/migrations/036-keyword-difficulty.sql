-- Migration 036: keyword_difficulty on audit_keywords (KB extraction Phase 0)
-- DataForSEO returns keyword_difficulty (0-100) in ranked_keywords responses
-- (keyword_data.keyword_properties.keyword_difficulty) but it was never persisted.
-- Needed by the proven-ceiling (A3) and re-evaluation candidate (A1) analytics.
-- NULL = not available (synthetic/new-site keywords, keyword_research-seeded rows,
-- or audits whose raw research artifacts are gone).

ALTER TABLE public.audit_keywords
  ADD COLUMN IF NOT EXISTS keyword_difficulty INTEGER;

COMMENT ON COLUMN public.audit_keywords.keyword_difficulty IS
  'DataForSEO keyword difficulty (0-100) from ranked_keywords keyword_properties. NULL when source data lacks it (synthetic keywords, keyword_research seeds).';
