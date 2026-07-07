-- Rollback for 043-prospect-outreach.sql
ALTER TABLE public.prospects DROP COLUMN IF EXISTS contact_email;
ALTER TABLE public.prospects DROP COLUMN IF EXISTS contact_name;
ALTER TABLE public.prospects DROP COLUMN IF EXISTS outreach_subject;
ALTER TABLE public.prospects DROP COLUMN IF EXISTS outreach_body;
ALTER TABLE public.prospects DROP COLUMN IF EXISTS outreach_variant;
ALTER TABLE public.prospects DROP COLUMN IF EXISTS outreach_status;
ALTER TABLE public.prospects DROP COLUMN IF EXISTS gmail_draft_id;
ALTER TABLE public.prospects DROP COLUMN IF EXISTS outreach_generated_at;
