-- Rollback 038
-- NOTE: "Users can update own audit_clusters" predates this migration in the
-- live DB (SQL-editor drift); rollback recreates it rather than dropping, to
-- restore the pre-migration live state exactly.
DROP POLICY IF EXISTS "Users can create own audit_clusters" ON public.audit_clusters;
DROP POLICY IF EXISTS "cluster_strategy_insert_own" ON public.cluster_strategy;
DROP POLICY IF EXISTS "cluster_strategy_update_own" ON public.cluster_strategy;
DROP POLICY IF EXISTS "Users can update own agent_architecture_pages" ON public.agent_architecture_pages;

REVOKE INSERT ON public.audit_clusters FROM authenticated;
REVOKE INSERT, UPDATE ON public.cluster_strategy FROM authenticated;
REVOKE UPDATE ON public.agent_architecture_pages FROM authenticated;

ALTER TABLE public.audit_clusters
  DROP COLUMN IF EXISTS is_manual,
  DROP COLUMN IF EXISTS edited_at,
  DROP COLUMN IF EXISTS edited_by;
ALTER TABLE public.execution_pages
  DROP COLUMN IF EXISTS assignment_locked;

-- restore pre-drift live state
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
