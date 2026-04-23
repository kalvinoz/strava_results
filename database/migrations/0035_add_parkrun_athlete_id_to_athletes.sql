-- Migration: Add parkrun_athlete field to parkrun_athletes table
-- This links the athletes table to their parkrun athlete ID for better deduplication

ALTER TABLE parkrun_athletes ADD COLUMN parkrun_athlete TEXT;

-- Index for fast lookups by parkrun athlete ID
CREATE INDEX IF NOT EXISTS idx_parkrun_athletes_parkrun_id ON parkrun_athletes(parkrun_athlete);

-- Backfill parkrun_athlete from parkrun_results for existing athletes
UPDATE parkrun_athletes
SET parkrun_athlete = (
  SELECT parkrun_athlete_id
  FROM parkrun_results
  WHERE athlete_name = parkrun_athletes.athlete_name
    AND parkrun_athlete_id IS NOT NULL
  LIMIT 1
)
WHERE parkrun_athlete IS NULL;
