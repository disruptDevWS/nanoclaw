-- Rollback 046: drop strategy_brief_markdown from audit_snapshots.
-- Also removes the strategy-brief rows written by strategy-brief.ts so no
-- orphaned agent_name='strategy-brief' rows with all-null payloads remain.
DELETE FROM public.audit_snapshots WHERE agent_name = 'strategy-brief';

ALTER TABLE public.audit_snapshots
  DROP COLUMN IF EXISTS strategy_brief_markdown;
