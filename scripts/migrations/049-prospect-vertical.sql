-- 049-prospect-vertical.sql
-- Add `vertical` to prospects so outreach share links can carry a real
-- utm_campaign=scout_{vertical} instead of base `scout` (FORGE_OS_OUTREACH_
-- TRACKING_SPEC §3; see DECISIONS.md 2026-07-21 — this was the documented gap).
--
-- Verified live 2026-07-21 via Management API: public.prospects has no `vertical`
-- column; public.prospect_candidates.vertical holds clean slugs (plumbing / hvac
-- / electrical) and links to prospects via prospect_id (28 of 51 prospects
-- backfillable). RLS unchanged (single super_admin_full_access policy).

ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS vertical text;

COMMENT ON COLUMN public.prospects.vertical IS
  'Business vertical slug (e.g. plumbing, hvac, electrical). Drives utm_campaign=scout_{vertical} on outreach share links. Sources: cron-prospector stamps it from the seed vertical post-scout; the dashboard New Prospect form sets it for manual prospects; backfilled from prospect_candidates.vertical (migration 049). Nullable — outreach falls back to base `scout` campaign when absent.';

-- Backfill from the discovery candidate that produced each prospect.
UPDATE public.prospects p
SET vertical = pc.vertical
FROM public.prospect_candidates pc
WHERE pc.prospect_id = p.id
  AND pc.vertical IS NOT NULL
  AND p.vertical IS NULL;
