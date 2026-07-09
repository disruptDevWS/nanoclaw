-- 046: strategy_brief_markdown column on audit_snapshots
-- Closes the last Pam disk-context gap (DECISIONS.md 2026-07-09): strategy_brief.md
-- existed only on disk, and Railway container disk is ephemeral. Phase 1b
-- (scripts/strategy-brief.ts) now upserts the brief markdown into a dedicated
-- audit_snapshots row (agent_name='strategy-brief', snapshot_version=1,
-- latest-wins); generate-brief.ts reads it as the fallback when the disk file
-- is absent.
ALTER TABLE public.audit_snapshots
  ADD COLUMN IF NOT EXISTS strategy_brief_markdown TEXT;

COMMENT ON COLUMN public.audit_snapshots.strategy_brief_markdown IS
  'Phase 1b strategy brief markdown. Populated only on agent_name=''strategy-brief'' rows (snapshot_version pinned to 1, upsert = latest wins). Writer: scripts/strategy-brief.ts. Reader: scripts/generate-brief.ts (Pam context 7b disk fallback).';
