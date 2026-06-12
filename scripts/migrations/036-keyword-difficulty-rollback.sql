-- Rollback for migration 036
ALTER TABLE public.audit_keywords
  DROP COLUMN IF EXISTS keyword_difficulty;
