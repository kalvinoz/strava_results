-- Migration: Clean up athlete names with parkrun ID suffixes like " (A1234567)"
-- parkrun CSVs occasionally append the athlete ID to the name, creating duplicate entries

-- Step 1: In parkrun_results, re-attribute rows with bad names to the canonical name
-- where the canonical name already has a row for the same event+date (delete the dupe)
DELETE FROM parkrun_results
WHERE athlete_name LIKE '% (A%)'
  AND EXISTS (
    SELECT 1 FROM parkrun_results AS other
    WHERE other.athlete_name = TRIM(SUBSTR(parkrun_results.athlete_name, 1, INSTR(parkrun_results.athlete_name, ' (A') - 1))
      AND other.event_name = parkrun_results.event_name
      AND other.event_number = parkrun_results.event_number
      AND other.date = parkrun_results.date
  );

-- Step 2: Rename remaining bad-name rows to the canonical name
UPDATE parkrun_results
SET athlete_name = TRIM(SUBSTR(athlete_name, 1, INSTR(athlete_name, ' (A') - 1))
WHERE athlete_name LIKE '% (A%)';

-- Step 3: Set parkrun_athlete on canonical parkrun_athletes entries from results
UPDATE parkrun_athletes
SET parkrun_athlete = (
  SELECT parkrun_athlete_id
  FROM parkrun_results
  WHERE athlete_name = parkrun_athletes.athlete_name
    AND parkrun_athlete_id IS NOT NULL
  LIMIT 1
)
WHERE parkrun_athlete IS NULL;

-- Step 4: Delete bad-name entries from parkrun_athletes
DELETE FROM parkrun_athletes
WHERE athlete_name LIKE '% (A%)';
