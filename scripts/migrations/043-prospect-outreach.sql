-- 043: Outreach email draft queue for scouted prospects.
-- Verified 2026-07-07 via Management API: public.prospects has 18 columns
-- (base + 041 + share migration); none of the 8 column names below exist.
-- Contact fields are entered manually (SQL/dashboard); generated fields are
-- written by scripts/generate-outreach-email.ts. The Gmail draft is a
-- materialization of outreach_subject/outreach_body — the row is source of truth.
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS outreach_subject text;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS outreach_body text;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS outreach_variant text;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS outreach_status text NOT NULL DEFAULT 'none';
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS gmail_draft_id text;
ALTER TABLE public.prospects ADD COLUMN IF NOT EXISTS outreach_generated_at timestamptz;

COMMENT ON COLUMN public.prospects.contact_email IS
  'Manually entered recipient email. Nullable — drafts generate with empty To: when absent.';
COMMENT ON COLUMN public.prospects.contact_name IS
  'Manually entered recipient first name for the greeting. Nullable.';
COMMENT ON COLUMN public.prospects.outreach_subject IS
  'Generated email subject. Source of truth; the Gmail draft is a materialization.';
COMMENT ON COLUMN public.prospects.outreach_body IS
  'Generated plain-text email body.';
COMMENT ON COLUMN public.prospects.outreach_variant IS
  'pitch | courtesy_note — courtesy_note when addressable_revenue_monthly < $2,500/mo fit threshold.';
COMMENT ON COLUMN public.prospects.outreach_status IS
  'none | generated (copy in DB, no Gmail draft yet) | drafted (Gmail draft exists). Text not enum so future values (e.g. sent) are free.';
COMMENT ON COLUMN public.prospects.gmail_draft_id IS
  'Gmail API draft id in the sender mailbox; idempotency anchor for update-in-place on regeneration.';
COMMENT ON COLUMN public.prospects.outreach_generated_at IS
  'When the outreach copy was last generated.';
