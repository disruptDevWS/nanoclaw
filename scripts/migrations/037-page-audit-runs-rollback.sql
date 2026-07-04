-- Rollback 037
DROP TABLE IF EXISTS public.page_audit_runs;
ALTER TABLE public.agent_technical_pages
  DROP COLUMN IF EXISTS optimization_profile,
  DROP COLUMN IF EXISTS optimization_score;
