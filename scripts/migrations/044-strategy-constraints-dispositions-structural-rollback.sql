-- Rollback for Migration 044

DROP INDEX IF EXISTS public.idx_execution_pages_disposition;

ALTER TABLE public.execution_pages
  DROP COLUMN IF EXISTS operator_disposition,
  DROP COLUMN IF EXISTS disposition_reason,
  DROP COLUMN IF EXISTS disposition_at;

ALTER TABLE public.audit_clusters
  DROP COLUMN IF EXISTS is_structural;

-- Dropping the table cascades its policies and index.
DROP TABLE IF EXISTS public.audit_strategy_constraints;
