-- Migration 038: cluster editability — RLS write paths + manual-edit survivability
--
-- Context (live-verified 2026-07-04 via Management API pg_policies):
--  * audit_clusters ALREADY had an owner-scoped UPDATE policy live ("Users can
--    update own audit_clusters") that existed in NO migration file (SQL-editor
--    drift). This migration codifies it (drop + recreate) so tracked SQL is the
--    source of truth.
--  * audit_clusters had NO authenticated INSERT policy (only service_role) —
--    added here for manual cluster creation (is_manual=true rows).
--  * cluster_strategy had NO authenticated INSERT/UPDATE; agent_architecture_pages
--    had NO authenticated UPDATE — both added here.
--  * Deliberately NOT added: audit_keywords UPDATE. Keyword→cluster membership
--    stays pipeline-derived (keywords are directional evidence, not human-curated).
--
-- Survivability columns (consumed by scripts/sync-to-dashboard.ts):
--  * audit_clusters.is_manual   — user-created clusters; rebuild never deletes them.
--  * audit_clusters.edited_at/by — user-edited display fields; rebuild preserves them.
--  * execution_pages.assignment_locked — user moved this page to a topic; syncMichael
--    must not overwrite its canonical_key/silo/page_brief.

-- ── audit_clusters ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can update own audit_clusters" ON public.audit_clusters;
CREATE POLICY "Users can update own audit_clusters"
  ON public.audit_clusters FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.audits
            WHERE audits.id = audit_clusters.audit_id AND audits.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.audits
            WHERE audits.id = audit_clusters.audit_id AND audits.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can create own audit_clusters" ON public.audit_clusters;
CREATE POLICY "Users can create own audit_clusters"
  ON public.audit_clusters FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.audits
            WHERE audits.id = audit_clusters.audit_id AND audits.user_id = auth.uid())
  );

GRANT INSERT, UPDATE ON public.audit_clusters TO authenticated;

ALTER TABLE public.audit_clusters
  ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edited_by UUID;

-- ── cluster_strategy ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cluster_strategy_insert_own" ON public.cluster_strategy;
CREATE POLICY "cluster_strategy_insert_own"
  ON public.cluster_strategy FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.audits
            WHERE audits.id = cluster_strategy.audit_id AND audits.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "cluster_strategy_update_own" ON public.cluster_strategy;
CREATE POLICY "cluster_strategy_update_own"
  ON public.cluster_strategy FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.audits
            WHERE audits.id = cluster_strategy.audit_id AND audits.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.audits
            WHERE audits.id = cluster_strategy.audit_id AND audits.user_id = auth.uid())
  );

GRANT INSERT, UPDATE ON public.cluster_strategy TO authenticated;

-- ── agent_architecture_pages ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can update own agent_architecture_pages" ON public.agent_architecture_pages;
CREATE POLICY "Users can update own agent_architecture_pages"
  ON public.agent_architecture_pages FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.audits
            WHERE audits.id = agent_architecture_pages.audit_id AND audits.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.audits
            WHERE audits.id = agent_architecture_pages.audit_id AND audits.user_id = auth.uid())
  );

GRANT UPDATE ON public.agent_architecture_pages TO authenticated;

-- ── execution_pages ─────────────────────────────────────────────────────────
ALTER TABLE public.execution_pages
  ADD COLUMN IF NOT EXISTS assignment_locked BOOLEAN NOT NULL DEFAULT false;
