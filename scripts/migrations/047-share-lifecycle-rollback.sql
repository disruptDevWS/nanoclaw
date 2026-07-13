-- Rollback for 047-share-lifecycle.sql
ALTER TABLE public.prospects DROP COLUMN IF EXISTS share_expires_at;
ALTER TABLE public.prospects DROP COLUMN IF EXISTS first_viewed_at;
ALTER TABLE public.prospects DROP COLUMN IF EXISTS last_viewed_at;
ALTER TABLE public.prospects DROP COLUMN IF EXISTS view_count;
ALTER TABLE public.prospects DROP COLUMN IF EXISTS booking_intent_at;
ALTER TABLE public.prospects DROP COLUMN IF EXISTS prospect_bridge_line;
