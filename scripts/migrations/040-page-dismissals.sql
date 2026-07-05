-- Migration 040: page_dismissals — worklist noise control (overlay input lane)
-- Dashboard-written, URL-keyed per audit, in its OWN table deliberately:
-- agent_technical_pages is delete+reinserted on every Dwight sync, so a flag on
-- the row would be wiped every re-crawl. Same overlay pattern as cornerstone_pages.
-- The Page Optimizer worklist excludes dismissed URLs (restorable, never deleted).

CREATE TABLE IF NOT EXISTS public.page_dismissals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id      UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  reason        TEXT NOT NULL DEFAULT 'irrelevant'
                CHECK (reason IN ('irrelevant','test_page','intentional')),
  dismissed_by  UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (audit_id, url)
);

CREATE INDEX IF NOT EXISTS idx_page_dismissals_audit
  ON public.page_dismissals (audit_id);

-- GRANTs (required since Oct 30, 2026 enforcement — see DECISIONS.md 2026-05-13)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.page_dismissals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.page_dismissals TO service_role;

-- RLS
ALTER TABLE public.page_dismissals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_page_dismissals"
  ON public.page_dismissals FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- User input table: owners get full CRUD (same pattern as cornerstone_pages)
CREATE POLICY "audit_owner_all_page_dismissals"
  ON public.page_dismissals FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.audits
            WHERE audits.id = page_dismissals.audit_id AND audits.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.audits
            WHERE audits.id = page_dismissals.audit_id AND audits.user_id = auth.uid())
  );
