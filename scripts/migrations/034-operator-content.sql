-- Migration 034: Operator-Directed Content Surface (Session 7-8)
--
-- 1. pam_requests.operator_notes — operator-supplied directives (topic, campaign
--    intent, constraints) that generate-brief.ts injects into Pam's prompt.
--    NULL for audit-derived requests.
-- 2. execution_pages status CHECK gains 'draft_ready' + 'in_review' — the
--    dashboard status dropdown already writes these values and the old CHECK
--    rejected them (verified live 2026-06-11: only not_started/brief_ready/
--    in_progress/review/published/deprecated were allowed).
-- 3. Document 'operator' as a valid execution_pages.source value (TEXT column,
--    no CHECK — values to date: michael, cluster_strategy, manual).
--
-- Rollback: scripts/migrations/034-operator-content-rollback.sql

ALTER TABLE public.pam_requests ADD COLUMN IF NOT EXISTS operator_notes TEXT;

COMMENT ON COLUMN public.pam_requests.operator_notes IS
  'Operator-supplied directives (topic, campaign intent, constraints) injected into Pam''s prompt as an OPERATOR DIRECTIVES section. NULL for audit-derived requests.';

ALTER TABLE public.execution_pages DROP CONSTRAINT IF EXISTS execution_pages_status_check;
ALTER TABLE public.execution_pages ADD CONSTRAINT execution_pages_status_check
  CHECK (status = ANY (ARRAY[
    'not_started'::text,
    'brief_ready'::text,
    'in_progress'::text,
    'draft_ready'::text,
    'review'::text,
    'in_review'::text,
    'published'::text,
    'deprecated'::text
  ]));

COMMENT ON COLUMN public.execution_pages.source IS
  'Page origin: michael (architecture blueprint), cluster_strategy (buyer-journey expansion), manual (dashboard cluster add), operator (operator-directed content request).';
