-- Rollback for migration 035.

UPDATE public.execution_pages SET status = 'in_progress' WHERE status = 'draft_ready';
UPDATE public.execution_pages SET status = 'review' WHERE status = 'in_review';

ALTER TABLE public.execution_pages DROP COLUMN IF EXISTS published_url;
ALTER TABLE public.execution_pages DROP COLUMN IF EXISTS content_edited_at;
