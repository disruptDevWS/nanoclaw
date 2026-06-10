-- Migration 029: Add DELETE RLS policies for cluster cascade-delete
-- Fixes: dashboard cluster delete silently fails because no DELETE policies exist
-- for authenticated users on audit_clusters, cluster_strategy, execution_pages,
-- or agent_architecture_pages. PostgREST returns 200 with 0 affected rows.

-- audit_clusters: allow owner to delete their own clusters
CREATE POLICY "Users can delete own audit_clusters"
  ON public.audit_clusters
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM audits
      WHERE audits.id = audit_clusters.audit_id
        AND audits.user_id = auth.uid()
    )
  );

-- cluster_strategy: allow owner to delete (cascade from cluster delete)
CREATE POLICY "Users can delete own cluster_strategy"
  ON public.cluster_strategy
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM audits
      WHERE audits.id = cluster_strategy.audit_id
        AND audits.user_id = auth.uid()
    )
  );

-- execution_pages: allow owner to delete (cascade from cluster delete)
CREATE POLICY "Users can delete own execution_pages"
  ON public.execution_pages
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM audits
      WHERE audits.id = execution_pages.audit_id
        AND audits.user_id = auth.uid()
    )
  );

-- agent_architecture_pages: allow owner to delete (cascade from cluster delete)
CREATE POLICY "Users can delete own agent_architecture_pages"
  ON public.agent_architecture_pages
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM audits
      WHERE audits.id = agent_architecture_pages.audit_id
        AND audits.user_id = auth.uid()
    )
  );
