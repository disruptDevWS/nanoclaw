-- Rollback for 050-outreach-verification.sql
--
-- Note: rows left in outreach_status 'needs_review' or 'killed' by the
-- verifier are plain text values and are NOT reverted here; reset them
-- manually if rolling back the verifier entirely:
--   UPDATE prospects SET outreach_status = 'generated'
--    WHERE outreach_status IN ('needs_review', 'killed');

ALTER TABLE prospects
  DROP COLUMN IF EXISTS outreach_verification_json;
