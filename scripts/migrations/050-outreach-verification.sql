-- 050-outreach-verification.sql — Outreach claim verifier (Bucket B) storage.
--
-- One jsonb mirror of the disk-first verdict-log artifact
-- (audits/{domain}/outreach/{date}/verification.json). Railway container disk
-- is ephemeral in the cron path, so the corpus would silently evaporate
-- without a DB mirror — same durability pattern as prospects.scout_scope_json.
-- Deliberately NOT a table: the verdict corpus earns a table only after
-- thresholds are validated (FORGE_OS_OUTREACH_VERIFIER_SPEC §1.5).
--
-- outreach_status is text (no enum): the verifier adds the values
-- 'needs_review' (unresolvable/flagged claims — no Gmail draft) and 'killed'
-- (core hook refuted — routed back) alongside none|generated|drafted|sent.
-- No schema change needed for those; documented in DATA_CONTRACT.md.

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS outreach_verification_json jsonb;

COMMENT ON COLUMN prospects.outreach_verification_json IS
  'Latest claim-verifier verdict log (Bucket B), mirroring audits/{domain}/outreach/{date}/verification.json. Writer: generate-outreach-email.ts. Readers: cron-prospector digest, future corpus reader.';
