-- Migration: Add database-backed sync queue for reliable manual syncs
-- This replaces unreliable ctx.waitUntil() and fire-and-forget fetch patterns

-- Create sync queue table
CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    athlete_id INTEGER NOT NULL,
    strava_id INTEGER NOT NULL,
    sync_session_id TEXT NOT NULL UNIQUE,
    sync_type TEXT NOT NULL DEFAULT 'manual', -- 'manual' or 'auto'

    -- Optional date range filters
    after_date TEXT, -- ISO date string (YYYY-MM-DD)
    before_date TEXT, -- ISO date string (YYYY-MM-DD)

    -- Queue status
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'

    -- Retry logic
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    last_error TEXT,

    -- Timestamps
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    started_at INTEGER, -- when processing started
    completed_at INTEGER, -- when completed or failed

    FOREIGN KEY (athlete_id) REFERENCES athletes(id) ON DELETE CASCADE
);

-- Index for efficient queue processing (find oldest pending jobs)
CREATE INDEX IF NOT EXISTS idx_sync_queue_status_created
    ON sync_queue(status, created_at ASC);

-- Index for finding jobs by session ID
CREATE INDEX IF NOT EXISTS idx_sync_queue_session
    ON sync_queue(sync_session_id);

-- Index for finding athlete's pending jobs
CREATE INDEX IF NOT EXISTS idx_sync_queue_athlete
    ON sync_queue(athlete_id, status);
