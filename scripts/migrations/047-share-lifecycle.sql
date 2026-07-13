-- 047: Share lifecycle — expiry, view logging, booking intent, bridge line.
-- Pre-flight verified 2026-07-13 via Management API: public.prospects has 26
-- columns; none of the 6 below exist. RLS: single super_admin_full_access (ALL)
-- policy — no new policies needed (dashboard writes run as super_admin; share
-- page + booking writes go through scout-config with the service role).
-- Timestamps are the source of truth; expiry is computed at request time from
-- share_expires_at (no cron flips a status). See tmp/scout-share-upgrade-plan.md.

ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS share_expires_at timestamptz;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS first_viewed_at timestamptz;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS last_viewed_at timestamptz;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS booking_intent_at timestamptz;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS prospect_bridge_line text;

COMMENT ON COLUMN public.prospects.share_expires_at IS
  'Capability-link expiry. Set to now()+14d by generate_share_token and again by the dashboard Mark-sent control (clock restarts at send). get_share_report serves 410 past this.';
COMMENT ON COLUMN public.prospects.first_viewed_at IS
  'First share-page token hit (get_share_report). Written once, service role.';
COMMENT ON COLUMN public.prospects.last_viewed_at IS
  'Most recent share-page token hit. Service role.';
COMMENT ON COLUMN public.prospects.view_count IS
  'Total share-page token hits. Service role.';
COMMENT ON COLUMN public.prospects.booking_intent_at IS
  'First /book/scout/:token click (log_booking_intent) — the attributable report→CTA conversion signal. booking_completed stays a manual email-match.';
COMMENT ON COLUMN public.prospects.prospect_bridge_line IS
  'Scout-authored 1–2 sentence bridge from the prospect''s diagnosis to the engagement. Share page falls back to generic copy when null.';

-- Backfill: existing tokens get an expiry anchored to their creation. The two
-- 2026-07-13 tokens stay live for 14 days; April-era tokens expire immediately
-- (correct — they were never sent to a prospect, outreach_status is 'none').
UPDATE public.prospects
SET share_expires_at = share_token_created_at + interval '14 days'
WHERE share_token IS NOT NULL
  AND share_token_created_at IS NOT NULL
  AND share_expires_at IS NULL;
