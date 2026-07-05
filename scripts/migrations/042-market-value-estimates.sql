-- 042: Cached market-value estimates for Scout revenue math.
-- Verified 2026-07-05 via Management API: table absent from live schema.
-- Written by the pipeline (service role) when no owner-provided job value and
-- no vertical benchmark exists; keyed per vertical+region so estimates are
-- stable across scout re-runs and reusable across prospects.
CREATE TABLE public.market_value_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_key text NOT NULL,
  region_key text NOT NULL,
  acv_low numeric,
  acv_mid numeric NOT NULL,
  acv_high numeric,
  cr numeric NOT NULL,
  value_label text NOT NULL,
  basis text,
  sources jsonb,
  confidence text,
  estimated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vertical_key, region_key)
);

-- Service-role-only access: RLS on with no policies (service role bypasses RLS).
ALTER TABLE public.market_value_estimates ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.market_value_estimates IS
  'Web-search-grounded typical job/customer value estimates per vertical+region. Scout revenue tier 2 (owner value overrides). Rows are editable by hand to override a bad estimate.';
