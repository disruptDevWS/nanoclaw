-- Migration 028: Add coverage_role column to agent_architecture_pages
-- coverage_role captures entity-authority intent purpose (commercial, informational, geographic, etc.)
-- Distinct from existing `role` column (pillar/cluster/support) which is load-bearing for Pam's model selection.

ALTER TABLE public.agent_architecture_pages
  ADD COLUMN IF NOT EXISTS coverage_role TEXT;
