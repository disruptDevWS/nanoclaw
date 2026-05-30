-- Migration 025: Rename ranking_snapshots.cluster → canonical_topic
-- The column stores canonical_topic values (not cluster names), making the old name misleading.

ALTER TABLE ranking_snapshots RENAME COLUMN cluster TO canonical_topic;
