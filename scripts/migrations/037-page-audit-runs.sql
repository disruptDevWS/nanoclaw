-- Migration 037: page_audit_runs — on-demand single-page optimization audits
-- Written by scripts/audit-page.ts (service_role) via the /audit-page Railway route.
-- Rows are inserted 'pending' by the page-audit edge function (service_role),
-- then claimed/updated by the pipeline. Dashboard polls by id (like pam_requests).
-- findings JSONB shape: {metadata:[], headers:[], images:[], internal_links:[],
--   graph_schema:[], agent_readiness:{layer1:[],layer2:[],layer3:[],score}}
-- page_snapshot JSONB: raw extracted facts (title, meta, htags, images, links, jsonld).
--
-- Also adds mechanical optimization scoring columns to agent_technical_pages,
-- populated by syncDwight (scripts/sync-to-dashboard.ts) from crawl data — the
-- site-wide "optimization worklist" layer (code-computed, no LLM).

CREATE TABLE IF NOT EXISTS public.page_audit_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id      UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  page_url      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','running','complete','failed')),
  findings      JSONB,
  page_snapshot JSONB,
  error_message TEXT,
  requested_by  UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_page_audit_runs_audit
  ON public.page_audit_runs (audit_id, created_at DESC);

-- Mechanical scoring layer on the existing per-URL crawl table
ALTER TABLE public.agent_technical_pages
  ADD COLUMN IF NOT EXISTS optimization_profile JSONB,
  ADD COLUMN IF NOT EXISTS optimization_score NUMERIC;

-- GRANTs (required since Oct 30, 2026 enforcement — see DECISIONS.md 2026-05-13)
GRANT SELECT ON public.page_audit_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.page_audit_runs TO service_role;

-- RLS
ALTER TABLE public.page_audit_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_page_audit_runs"
  ON public.page_audit_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "audit_owner_select_page_audit_runs"
  ON public.page_audit_runs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = page_audit_runs.audit_id
        AND audits.user_id = auth.uid()
    )
  );
