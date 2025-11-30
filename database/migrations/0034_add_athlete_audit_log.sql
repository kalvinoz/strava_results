-- Add audit log table for tracking changes to athlete records
-- This tracks changes to both parkrun_athletes and strava athletes

CREATE TABLE IF NOT EXISTS athlete_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- What was changed
  table_name TEXT NOT NULL CHECK(table_name IN ('parkrun_athletes', 'athletes')),
  athlete_identifier TEXT NOT NULL, -- athlete_name for parkrun, athlete_id for strava
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,

  -- When and how
  changed_at INTEGER NOT NULL, -- Unix timestamp
  change_source TEXT NOT NULL CHECK(change_source IN ('manual_api', 'individual_scraper', 'club_scraper', 'strava_sync', 'system')),
  change_reason TEXT, -- Optional: why the change was made

  -- Who (if applicable)
  admin_email TEXT, -- For manual changes via admin API

  -- Context
  metadata TEXT -- JSON blob for additional context
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_athlete_audit_table_identifier ON athlete_audit_log(table_name, athlete_identifier);
CREATE INDEX IF NOT EXISTS idx_athlete_audit_changed_at ON athlete_audit_log(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_athlete_audit_field ON athlete_audit_log(field_name);
CREATE INDEX IF NOT EXISTS idx_athlete_audit_source ON athlete_audit_log(change_source);
