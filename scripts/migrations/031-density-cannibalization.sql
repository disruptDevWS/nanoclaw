-- Migration 031: Coverage density scores + cannibalization warnings (Phase 4c)
-- density_score: % of cluster keywords semantically covered by client content (0-100).
-- competitor_density_score: same vs competitor heading corpus.
-- cannibalization_warnings: client page pairs in the same cluster with content
-- embedding similarity > 0.90 (title + h1 + meta description).

-- 1) Density columns on audit_clusters (separate from coverage_score, which is
--    % of competitor headings covered — different denominator).
ALTER TABLE public.audit_clusters
  ADD COLUMN IF NOT EXISTS density_score FLOAT,
  ADD COLUMN IF NOT EXISTS competitor_density_score FLOAT,
  ADD COLUMN IF NOT EXISTS density_updated_at TIMESTAMPTZ;

-- 2) Cannibalization warnings table (current state only, replaced per Phase 4c run)
CREATE TABLE IF NOT EXISTS public.cannibalization_warnings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id      UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  canonical_key TEXT NOT NULL,
  page_a_url    TEXT NOT NULL,
  page_b_url    TEXT NOT NULL,
  similarity    FLOAT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cannibalization_warnings_audit
  ON public.cannibalization_warnings (audit_id);
CREATE INDEX IF NOT EXISTS idx_cannibalization_warnings_audit_cluster
  ON public.cannibalization_warnings (audit_id, canonical_key);

-- GRANTs (required since Oct 30, 2026 enforcement — see DECISIONS.md 2026-05-13)
GRANT SELECT ON public.cannibalization_warnings TO anon;
GRANT SELECT ON public.cannibalization_warnings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cannibalization_warnings TO service_role;

-- RLS
ALTER TABLE public.cannibalization_warnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_cannibalization_warnings"
  ON public.cannibalization_warnings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "audit_owner_select_cannibalization_warnings"
  ON public.cannibalization_warnings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = cannibalization_warnings.audit_id
        AND audits.user_id = auth.uid()
    )
  );
