-- Migration 035: Content Workflow Completion (Session 9)
--
-- 1. execution_pages.published_url — the live URL once a page is published
--    (url_slug alone is a dead end; performance matching needs the real URL).
-- 2. execution_pages.content_edited_at — set when a human replaces Oscar's
--    draft HTML via the dashboard (content-back-in). NULL = untouched draft.
-- 3. Status normalization: legacy 'in_progress' → 'draft_ready' (8 rows live),
--    legacy 'review' → 'in_review' (1 row live). Oscar now writes draft_ready;
--    the CHECK (migration 034) still allows legacy values so an un-redeployed
--    Railway writer cannot fail mid-rollout.
--
-- Rollback: scripts/migrations/035-content-workflow-rollback.sql

ALTER TABLE public.execution_pages ADD COLUMN IF NOT EXISTS published_url TEXT;
COMMENT ON COLUMN public.execution_pages.published_url IS
  'Live URL captured when the page is marked published. Used to join GSC page performance back to the content queue.';

ALTER TABLE public.execution_pages ADD COLUMN IF NOT EXISTS content_edited_at TIMESTAMPTZ;
COMMENT ON COLUMN public.execution_pages.content_edited_at IS
  'Set when a human replaces Oscar''s draft via the dashboard content editor. NULL = unedited agent draft.';

UPDATE public.execution_pages SET status = 'draft_ready' WHERE status = 'in_progress';
UPDATE public.execution_pages SET status = 'in_review' WHERE status = 'review';
