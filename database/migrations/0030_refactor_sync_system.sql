-- Migration: Refactor sync system to use flexible rotation queue
-- Removes old batch-based complexity and implements simple weekly rotation

-- 1. Add current_sync_step to athletes table for dashboard visibility
ALTER TABLE athletes ADD COLUMN current_sync_step TEXT DEFAULT 'idle';
-- Possible values: 'idle', 'queued', 'fetching_activities', 'filtering_runs',
--                  'checking_existing', 'fetching_details', 'saving_races', 'completed', 'error'

-- Add last_sync_type column to track if sync was automatic or manual
ALTER TABLE athletes ADD COLUMN last_sync_type TEXT; -- 'auto' or 'manual'

-- 2. Drop old batch-based tables (we're replacing this system entirely)
DROP TABLE IF EXISTS sync_queue;
DROP TABLE IF EXISTS sync_batches;
DROP TABLE IF EXISTS sync_logs;

-- 3. Remove old batch tracking columns from athletes
-- Note: SQLite doesn't support DROP COLUMN, so we'll just leave them unused
-- (current_batch_number, total_batches_expected, sync_session_id)

-- 4. Add activity fetch staging table for two-phase sync
CREATE TABLE IF NOT EXISTS fetched_activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_id INTEGER NOT NULL,
    sync_session_id TEXT NOT NULL,
    strava_activity_id INTEGER NOT NULL,
    activity_type TEXT NOT NULL, -- 'Run', 'Ride', etc
    workout_type INTEGER, -- 1 = race, 0 = workout, NULL = casual
    name TEXT NOT NULL,
    distance REAL NOT NULL,
    moving_time INTEGER NOT NULL,
    elapsed_time INTEGER NOT NULL,
    date TEXT NOT NULL, -- ISO 8601
    start_date_local TEXT,
    -- Minimal data from list endpoint
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fetched_activities_session
    ON fetched_activities(sync_session_id);
CREATE INDEX IF NOT EXISTS idx_fetched_activities_athlete
    ON fetched_activities(athlete_id, strava_activity_id);

-- 5. Add sync progress tracking table (replaces old sync_logs and athlete_sync_logs)
CREATE TABLE IF NOT EXISTS sync_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_id INTEGER NOT NULL,
    sync_session_id TEXT NOT NULL UNIQUE,

    -- Current status
    current_step TEXT NOT NULL DEFAULT 'queued',
    status TEXT NOT NULL DEFAULT 'running', -- 'running', 'completed', 'error'
    sync_type TEXT NOT NULL DEFAULT 'auto', -- 'auto' or 'manual'

    -- Timestamps
    started_at INTEGER NOT NULL,
    completed_at INTEGER,

    -- Progress counters
    total_activities_fetched INTEGER DEFAULT 0,
    runs_filtered INTEGER DEFAULT 0,
    races_filtered INTEGER DEFAULT 0,
    new_races_added INTEGER DEFAULT 0,
    existing_races_updated INTEGER DEFAULT 0,
    races_removed INTEGER DEFAULT 0,

    -- Pagination state for resumable syncs
    last_activity_timestamp INTEGER,
    has_more_activities INTEGER DEFAULT 1, -- boolean: 1 = more to fetch, 0 = done

    -- Error tracking
    error_message TEXT,
    error_step TEXT,

    -- Rate limiting
    strava_rate_limit_15min INTEGER,
    strava_rate_limit_daily INTEGER,

    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_progress_athlete
    ON sync_progress(athlete_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_progress_status
    ON sync_progress(status, started_at DESC);

-- 6. Add detailed step logs table (replaces athlete_sync_logs with better structure)
CREATE TABLE IF NOT EXISTS sync_step_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_session_id TEXT NOT NULL,
    athlete_id INTEGER NOT NULL,
    step TEXT NOT NULL, -- 'queued', 'fetching_activities', etc
    log_level TEXT NOT NULL, -- 'info', 'warning', 'error', 'success'
    message TEXT NOT NULL,
    metadata TEXT, -- JSON string
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_step_logs_session
    ON sync_step_logs(sync_session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_sync_step_logs_athlete
    ON sync_step_logs(athlete_id, created_at DESC);

-- 7. Cleanup: Remove old athlete_sync_logs entries older than 30 days
DELETE FROM athlete_sync_logs WHERE created_at < (strftime('%s', 'now') - 2592000);
