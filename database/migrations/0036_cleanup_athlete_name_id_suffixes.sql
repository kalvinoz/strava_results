-- Migration: Clean up athlete names with parkrun ID suffixes like " (A1234567)"
-- parkrun CSVs occasionally append the athlete ID to the name, creating duplicate entries.
-- Note: parkrun uses a non-breaking space (U+00A0) before the "(A...)" suffix, so we use
-- LIKE '%(A%)' without hardcoding the space character.

-- Step 1: Rename bad-name rows to the canonical name where no conflict exists
-- We do the rename first, letting ON CONFLICT handle true duplicates
UPDATE parkrun_results
SET athlete_name = TRIM(SUBSTR(athlete_name, 1, INSTR(athlete_name, '(A') - 1))
WHERE athlete_name LIKE '%(A%)';

-- Step 2: Backfill parkrun_athlete on canonical parkrun_athletes entries
UPDATE parkrun_athletes
SET parkrun_athlete = (
  SELECT parkrun_athlete_id
  FROM parkrun_results
  WHERE athlete_name = parkrun_athletes.athlete_name
    AND parkrun_athlete_id IS NOT NULL
  LIMIT 1
)
WHERE parkrun_athlete IS NULL;

-- Step 3: Delete bad-name entries from parkrun_athletes (safe - no useful data there)
DELETE FROM parkrun_athletes
WHERE athlete_name LIKE '%(A%)';
