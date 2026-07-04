-- Migration 039: cornerstone_pages — user-declared architecture input (overlay lane)
-- Populated by the dashboard (Screaming Frog export upload, section-aware parse:
-- rows with empty Status Code are section labels; URL rows inherit the preceding
-- section). Read by runMichael (scripts/pipeline-generate.ts) as declared silos /
-- architectural anchors — reconciled against, never overwriting, Dwight's crawl.
-- page_facts JSONB: curated subset of the SF export (title, h1, meta_description,
-- word_count, indexability, canonical, inlinks, gsc {clicks,impressions,position}).

CREATE TABLE IF NOT EXISTS public.cornerstone_pages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id      UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  section       TEXT,
  primary_topic TEXT,
  notes         TEXT,
  page_facts    JSONB,
  uploaded_by   UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (audit_id, url)
);

CREATE INDEX IF NOT EXISTS idx_cornerstone_pages_audit
  ON public.cornerstone_pages (audit_id);

-- GRANTs (required since Oct 30, 2026 enforcement — see DECISIONS.md 2026-05-13)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cornerstone_pages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cornerstone_pages TO service_role;

-- RLS
ALTER TABLE public.cornerstone_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_cornerstone_pages"
  ON public.cornerstone_pages FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- User input table: owners get full CRUD
CREATE POLICY "audit_owner_all_cornerstone_pages"
  ON public.cornerstone_pages FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.audits
            WHERE audits.id = cornerstone_pages.audit_id AND audits.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.audits
            WHERE audits.id = cornerstone_pages.audit_id AND audits.user_id = auth.uid())
  );
