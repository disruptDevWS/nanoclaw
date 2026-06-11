-- Rollback for migration 034.
-- NOTE: restoring the old CHECK fails if any rows hold status 'draft_ready' or
-- 'in_review' — remap them first (draft_ready → in_progress, in_review → review).

UPDATE public.execution_pages SET status = 'in_progress' WHERE status = 'draft_ready';
UPDATE public.execution_pages SET status = 'review' WHERE status = 'in_review';

ALTER TABLE public.execution_pages DROP CONSTRAINT IF EXISTS execution_pages_status_check;
ALTER TABLE public.execution_pages ADD CONSTRAINT execution_pages_status_check
  CHECK (status = ANY (ARRAY[
    'not_started'::text,
    'brief_ready'::text,
    'in_progress'::text,
    'review'::text,
    'published'::text,
    'deprecated'::text
  ]));

ALTER TABLE public.pam_requests DROP COLUMN IF EXISTS operator_notes;
