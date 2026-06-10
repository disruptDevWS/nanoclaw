-- Migration 033: pipeline_runs — per-run phase progress tracking
-- Written by run-pipeline.sh via scripts/pipeline-progress.ts (service_role).
-- Read by the dashboard (AuditRunning checklist + Run History).
-- phases JSONB shape: {"1":{"status":"completed","started_at":"...","completed_at":"..."},"4":{"status":"skipped"}}
-- Single writer per domain is guaranteed by the pipeline server's inFlight 409,
-- so read-modify-write of phases is race-free.

CREATE TABLE IF NOT EXISTS public.pipeline_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id      UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  domain        TEXT NOT NULL,
  mode          TEXT NOT NULL DEFAULT 'full',
  start_from    TEXT,
  stop_after    TEXT,
  status        TEXT NOT NULL DEFAULT 'running',  -- running|completed|failed|timed_out|awaiting_review
  current_phase TEXT,
  phases        JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_audit
  ON public.pipeline_runs (audit_id, started_at DESC);

-- GRANTs (required since Oct 30, 2026 enforcement — see DECISIONS.md 2026-05-13)
GRANT SELECT ON public.pipeline_runs TO anon;
GRANT SELECT ON public.pipeline_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_runs TO service_role;

-- RLS
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_pipeline_runs"
  ON public.pipeline_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "audit_owner_select_pipeline_runs"
  ON public.pipeline_runs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = pipeline_runs.audit_id
        AND audits.user_id = auth.uid()
    )
  );
