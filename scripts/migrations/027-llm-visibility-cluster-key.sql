-- Migration 027: Add cluster_canonical_key to llm_visibility_snapshots
-- Links LLM visibility snapshots to the cluster strategy that generated the query.
-- Null for legacy top-5-by-volume keyword snapshots (fallback mode).

ALTER TABLE public.llm_visibility_snapshots
  ADD COLUMN IF NOT EXISTS cluster_canonical_key TEXT;

CREATE INDEX IF NOT EXISTS idx_llm_vis_cluster
  ON public.llm_visibility_snapshots(audit_id, cluster_canonical_key)
  WHERE cluster_canonical_key IS NOT NULL;
