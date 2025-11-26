-- Migration: Add race_count column to athletes table
-- This will be automatically updated when syncs complete

ALTER TABLE athletes ADD COLUMN race_count INTEGER DEFAULT 0;

-- Update existing athletes with their current race counts
UPDATE athletes
SET race_count = (
    SELECT COUNT(*)
    FROM races
    WHERE races.athlete_id = athletes.id
);
