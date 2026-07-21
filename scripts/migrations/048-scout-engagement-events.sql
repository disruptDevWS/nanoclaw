-- 048-scout-engagement-events.sql
-- Token-keyed engagement log for the Scout share funnel
-- (FORGE_OS_OUTREACH_TRACKING_SPEC §7 "dual-write"). GA4 is enrichment; this
-- table is the ad-blocker-resistant system of record the fitness function
-- reads. The share page POSTs fitness-critical events (scroll, section view,
-- dwell, CTA) to the scout-engagement edge function (service role), which
-- resolves the token → prospect and inserts here.
--
-- Verified live 2026-07-21 via Management API before writing: public
-- .scout_engagement_events absent; public.prospects.id + .share_token are uuid;
-- has_role(uuid, app_role) present; prospects RLS policy super_admin_full_access
-- in use (this mirrors it — service role bypasses RLS for the edge-fn writes,
-- authenticated dashboard reads gated to super_admin, anon has no policy).

CREATE TABLE public.scout_engagement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid REFERENCES public.prospects(id) ON DELETE CASCADE,
  scout_token uuid NOT NULL,
  -- scout_view | scroll_50 | scroll_75 | section_view | engaged_30s
  --   | engaged_90s | cta_click | book_redirect
  -- Text not enum so future event names are free (matches 043/045 convention).
  event text NOT NULL,
  section_name text,        -- set when event = section_view (revenue_tile, gap_table, positioning, cta)
  variant_id text,          -- echoed from utm_content — the fitness-function join key
  campaign text,            -- utm_campaign (scout / scout_{vertical})
  market text,              -- utm_term
  meta jsonb,               -- forward-compat overflow (percent, seconds, client_ts, link_url…)
  occurred_at timestamptz NOT NULL DEFAULT now(),  -- server truth; client ts kept in meta
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.scout_engagement_events IS
  'Token-keyed Scout share-page engagement log (dual-write from the scout-engagement edge fn, service role). Primary fitness-function source; GA4 is parallel enrichment. See FORGE_OS_OUTREACH_TRACKING_SPEC §7.';
COMMENT ON COLUMN public.scout_engagement_events.variant_id IS
  'Email variant id echoed from the share link utm_content. Placeholder = outreach_variant until a genome population exists; the join key for variant↔engagement fitness.';
COMMENT ON COLUMN public.scout_engagement_events.occurred_at IS
  'Server receipt time (source of truth). Any client-reported timestamp is preserved in meta.client_ts.';

CREATE INDEX idx_scout_engagement_prospect ON public.scout_engagement_events (prospect_id);
CREATE INDEX idx_scout_engagement_token ON public.scout_engagement_events (scout_token);
CREATE INDEX idx_scout_engagement_variant ON public.scout_engagement_events (variant_id);
CREATE INDEX idx_scout_engagement_occurred_at ON public.scout_engagement_events (occurred_at DESC);

ALTER TABLE public.scout_engagement_events ENABLE ROW LEVEL SECURITY;

-- Mirrors prospects.super_admin_full_access. Service role (edge-fn writes,
-- analysis scripts) bypasses RLS; authenticated dashboard access is super_admin
-- only; anon has no policy → no read/write of prospect engagement data.
CREATE POLICY super_admin_full_access ON public.scout_engagement_events
  FOR ALL
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));
