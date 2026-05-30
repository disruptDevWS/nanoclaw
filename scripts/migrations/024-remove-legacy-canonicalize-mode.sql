-- Migration 024: Remove legacy canonicalize mode
-- All production clients already on hybrid. Legacy-mode audits are inactive/demo.
-- Sets all to hybrid and changes the default.

UPDATE audits SET canonicalize_mode = 'hybrid' WHERE canonicalize_mode != 'hybrid' OR canonicalize_mode IS NULL;
ALTER TABLE audits ALTER COLUMN canonicalize_mode SET DEFAULT 'hybrid';
