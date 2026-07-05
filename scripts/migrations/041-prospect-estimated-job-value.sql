-- 041: Owner-provided typical job value for Scout revenue estimates.
-- Verified 2026-07-05 via Management API: public.prospects exists, column absent.
ALTER TABLE public.prospects ADD COLUMN estimated_job_value numeric;

COMMENT ON COLUMN public.prospects.estimated_job_value IS
  'Owner-provided typical job/customer value in USD. When set, Scout uses it as ACV (method=owner_provided) instead of vertical benchmarks; when absent and no vertical benchmark matches, revenue estimates are suppressed.';
