-- Migration 030: Add UPDATE/INSERT/DELETE RLS policies for citation_snapshots
-- Fixes: dashboard citation edits (cell toggles, URL edits, add/delete directories)
-- silently fail because only SELECT policy existed for authenticated users.

-- UPDATE: allow audit owner to edit citation annotations and URLs
CREATE POLICY "Users can update own citation_snapshots"
  ON public.citation_snapshots
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM audits
      WHERE audits.id = citation_snapshots.audit_id
        AND audits.user_id = auth.uid()
    )
  );

-- INSERT: allow audit owner to add manual directories
CREATE POLICY "Users can insert own citation_snapshots"
  ON public.citation_snapshots
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM audits
      WHERE audits.id = citation_snapshots.audit_id
        AND audits.user_id = auth.uid()
    )
  );

-- DELETE: allow audit owner to remove manual directories
CREATE POLICY "Users can delete own citation_snapshots"
  ON public.citation_snapshots
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM audits
      WHERE audits.id = citation_snapshots.audit_id
        AND audits.user_id = auth.uid()
    )
  );
