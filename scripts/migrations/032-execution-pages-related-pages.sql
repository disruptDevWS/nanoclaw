-- Migration 032: execution_pages.related_pages
-- Stores embedding-derived verified internal link candidates computed at brief time.
-- Lives outside page_brief because syncMichael() wholesale-overwrites page_brief on re-runs.

ALTER TABLE public.execution_pages
  ADD COLUMN IF NOT EXISTS related_pages JSONB;

COMMENT ON COLUMN public.execution_pages.related_pages IS
  'Embedding-derived internal link candidates computed by generate-brief.ts. Shape: { computed_at, model, source, candidates: [{target, kind, title, similarity, status?, silo?}], cannibalization_risks: [{target, similarity}] }';
