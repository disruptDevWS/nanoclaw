-- Migration 044: Michael feedback loop + architecture resilience (schema layer)
-- Live-verified 2026-07-08 via Management API (project hohuimkcpihdufunrzvg):
--   * audit_strategy_constraints does NOT exist (only cluster_strategy matches %strateg%).
--   * execution_pages has no operator_disposition/disposition_reason/disposition_at columns.
--     status is TEXT + CHECK (8 values incl. 'deprecated'); source is TEXT with no constraint.
--   * audit_clusters has is_manual but no structural marker; NOT-NULL-without-default cols
--     are only audit_id and topic.
--   * public.can_view_audit(uuid) helper exists (SECURITY DEFINER, used by execution_pages/
--     audit_clusters SELECT policies).
-- Plan: docs/plans/michael-feedback-loop-resilience-plan.md
-- Rollback: 044-strategy-constraints-dispositions-structural-rollback.sql

-- ---------------------------------------------------------------------------
-- (1) audit_strategy_constraints — durable operator directives injected into
--     Michael's prompt as OPERATOR STRATEGY DIRECTIVES on every run.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_strategy_constraints (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id     UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  directive    TEXT NOT NULL,
  reason       TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.audit_strategy_constraints IS
  'Operator strategy directives (e.g., "service-area pages are county-level"). Active rows are injected into Michael''s architecture prompt as binding constraints on every run.';
COMMENT ON COLUMN public.audit_strategy_constraints.directive IS 'The binding instruction, written to Michael.';
COMMENT ON COLUMN public.audit_strategy_constraints.reason IS 'Why the operator issued it (also shown to Michael for context).';
COMMENT ON COLUMN public.audit_strategy_constraints.active IS 'Inactive directives are kept for history but not injected.';

CREATE INDEX IF NOT EXISTS idx_audit_strategy_constraints_audit
  ON public.audit_strategy_constraints (audit_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_strategy_constraints TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_strategy_constraints TO service_role;

ALTER TABLE public.audit_strategy_constraints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_audit_strategy_constraints" ON public.audit_strategy_constraints;
CREATE POLICY "service_role_all_audit_strategy_constraints"
  ON public.audit_strategy_constraints FOR ALL
  TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Granted users can view audit_strategy_constraints" ON public.audit_strategy_constraints;
CREATE POLICY "Granted users can view audit_strategy_constraints"
  ON public.audit_strategy_constraints FOR SELECT
  TO authenticated USING (public.can_view_audit(audit_id));

DROP POLICY IF EXISTS "audit_owner_write_audit_strategy_constraints" ON public.audit_strategy_constraints;
CREATE POLICY "audit_owner_write_audit_strategy_constraints"
  ON public.audit_strategy_constraints FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.audits
                 WHERE audits.id = audit_strategy_constraints.audit_id
                   AND audits.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.audits
                      WHERE audits.id = audit_strategy_constraints.audit_id
                        AND audits.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- (2) execution_pages operator dispositions — reject/defer with reason.
--     NULL = no disposition (CHECK passes on NULL). Disposed pages are
--     immovable in syncMichael and excluded from content generation + shares.
-- ---------------------------------------------------------------------------
ALTER TABLE public.execution_pages
  ADD COLUMN IF NOT EXISTS operator_disposition TEXT
    CHECK (operator_disposition IN ('rejected','deferred')),
  ADD COLUMN IF NOT EXISTS disposition_reason TEXT,
  ADD COLUMN IF NOT EXISTS disposition_at TIMESTAMPTZ;

COMMENT ON COLUMN public.execution_pages.operator_disposition IS
  'Operator verdict on a recommendation: rejected = never revive/re-propose (reason fed back to Michael); deferred = keep but exclude from production. NULL = normal.';
COMMENT ON COLUMN public.execution_pages.disposition_reason IS 'Why — injected into Michael''s REJECTED RECOMMENDATIONS block for rejected pages.';
COMMENT ON COLUMN public.execution_pages.disposition_at IS 'When the disposition was set.';

CREATE INDEX IF NOT EXISTS idx_execution_pages_disposition
  ON public.execution_pages (audit_id, operator_disposition)
  WHERE operator_disposition IS NOT NULL;

-- ---------------------------------------------------------------------------
-- (3) audit_clusters structural marker — Michael-declared clusters with no
--     keyword backing (e.g., service_area). Distinct from is_manual (human-
--     created). Both survive the Phase 3d rebuild delete.
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_clusters
  ADD COLUMN IF NOT EXISTS is_structural BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.audit_clusters.is_structural IS
  'Michael-declared structural cluster (no keyword cluster backing). Survives Phase 3d rebuilds like is_manual, but machine-origin.';
