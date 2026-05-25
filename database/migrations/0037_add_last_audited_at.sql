-- Migration: Add last_audited_at to parkrun_athletes
-- Tracks when the audit script last successfully verified (or fixed) an athlete's run count.
-- NULL means never audited. Used by the audit script to prioritise un-audited athletes first,
-- then audit oldest-to-newest so each run makes forward progress.

ALTER TABLE parkrun_athletes ADD COLUMN last_audited_at INTEGER; -- Unix timestamp, NULL = never audited

-- Index for fast ORDER BY in the audit query
CREATE INDEX IF NOT EXISTS idx_parkrun_athletes_last_audited ON parkrun_athletes(last_audited_at ASC);
