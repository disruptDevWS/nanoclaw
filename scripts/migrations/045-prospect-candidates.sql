-- 045-prospect-candidates.sql
-- Prospector discovery queue: one row per candidate domain surfaced by the
-- daily cron-prospector.ts run. Serves as the dedup source (a domain seen
-- once — any status — is never re-discovered) and the qualification record.
--
-- Verified live 2026-07-08 before writing: public.prospect_candidates absent,
-- public.prospects.id is uuid, has_role(uuid, app_role) in use by the live
-- prospects RLS policy (super_admin_full_access), which this mirrors.

CREATE TABLE public.prospect_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL UNIQUE,
  business_name text,
  seed_query text,
  vertical text,
  geo jsonb,
  serp_rank integer,
  signals jsonb,
  qualify jsonb,
  score integer,
  -- discovered | qualified | rejected | scouted | drafted | error
  -- Text not enum so future values are free (matches 043 convention).
  status text NOT NULL DEFAULT 'discovered',
  rejection_reason text,
  prospect_id uuid REFERENCES public.prospects(id) ON DELETE SET NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.prospect_candidates IS
  'Daily prospector discovery queue (scripts/cron-prospector.ts). Written by pipeline service role; dashboard read access super_admin only.';

CREATE INDEX idx_prospect_candidates_status ON public.prospect_candidates (status);
CREATE INDEX idx_prospect_candidates_discovered_at ON public.prospect_candidates (discovered_at DESC);

ALTER TABLE public.prospect_candidates ENABLE ROW LEVEL SECURITY;

-- Mirrors prospects.super_admin_full_access (service role bypasses RLS).
CREATE POLICY super_admin_full_access ON public.prospect_candidates
  FOR ALL
  USING (has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));
