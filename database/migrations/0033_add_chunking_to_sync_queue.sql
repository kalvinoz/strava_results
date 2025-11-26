-- Migration: Add chunking support to sync_queue for handling large syncs
-- Allows splitting large syncs (>45 races) into smaller chunks to avoid subrequest limits

-- Add chunking columns
ALTER TABLE sync_queue ADD COLUMN chunk_index INTEGER DEFAULT 0;
ALTER TABLE sync_queue ADD COLUMN total_chunks INTEGER DEFAULT 1;
ALTER TABLE sync_queue ADD COLUMN race_ids TEXT; -- JSON array of race IDs to process in this chunk
ALTER TABLE sync_queue ADD COLUMN parent_session_id TEXT; -- Links chunk jobs to parent sync session
