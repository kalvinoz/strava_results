// Queue processor - processes pending sync jobs from database queue
// Runs every minute via cron trigger

import { Env } from '../types';

interface SyncQueueJob {
  id: number;
  athlete_id: number;
  strava_id: number;
  sync_session_id: string;
  sync_type: 'manual' | 'auto' | 'chunked_detail_fetch' | 'chunked_time_fetch';
  after_date: string | null;
  before_date: string | null;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  // Chunking fields
  chunk_index: number | null;
  total_chunks: number | null;
  race_ids: string | null; // JSON array of race IDs for chunked_detail_fetch
  parent_session_id: string | null;
}

/**
 * Process one pending job from the queue (FIFO)
 * Called by cron trigger every minute
 */
export async function processQueuedSyncs(env: Env): Promise<void> {
  console.log('[QueueProcessor] Checking for pending sync jobs...');

  try {
    // Find oldest pending job (FIFO)
    const job = await env.DB.prepare(
      `SELECT * FROM sync_queue
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1`
    ).first<SyncQueueJob>();

    if (!job) {
      console.log('[QueueProcessor] No pending jobs in queue');
      return;
    }

    console.log(`[QueueProcessor] Found pending job ${job.id} (session: ${job.sync_session_id}, attempt ${job.attempts + 1}/${job.max_attempts})`);

    // Check if max attempts reached
    if (job.attempts >= job.max_attempts) {
      console.error(`[QueueProcessor] Job ${job.id} exceeded max attempts (${job.max_attempts})`);
      await markJobFailed(env, job.id, job.sync_session_id, 'Max retry attempts reached');
      return;
    }

    // Mark job as processing
    await env.DB.prepare(
      `UPDATE sync_queue
       SET status = 'processing',
           attempts = attempts + 1,
           started_at = strftime('%s', 'now')
       WHERE id = ?`
    ).bind(job.id).run();

    console.log(`[QueueProcessor] Marked job ${job.id} as processing`);

    try {
      // Get athlete from database
      const athlete = await env.DB.prepare(
        'SELECT * FROM athletes WHERE id = ?'
      ).bind(job.athlete_id).first<any>();

      if (!athlete) {
        throw new Error(`Athlete ${job.athlete_id} not found in database`);
      }

      console.log(`[QueueProcessor] Starting sync for athlete ${athlete.strava_id} (${athlete.firstname} ${athlete.lastname})`);

      // Check job type and process accordingly
      if (job.sync_type === 'chunked_detail_fetch') {
        await processChunkedDetailFetch(env, job, athlete);
      } else if (job.sync_type === 'chunked_time_fetch') {
        await processChunkedTimeFetch(env, job, athlete);
      } else {
        // Normal sync job (manual or auto)
        const { syncAthlete } = await import('../sync/rotation-sync');

        await syncAthlete(env, athlete, job.sync_type as 'manual' | 'auto', {
          sessionId: job.sync_session_id,
          afterDate: job.after_date || undefined,
          beforeDate: job.before_date || undefined,
        });
      }

      // Mark job as completed
      await env.DB.prepare(
        `UPDATE sync_queue
         SET status = 'completed',
             completed_at = strftime('%s', 'now')
         WHERE id = ?`
      ).bind(job.id).run();

      console.log(`[QueueProcessor] Job ${job.id} completed successfully`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[QueueProcessor] Job ${job.id} failed:`, errorMessage);

      // Check if this was the last attempt
      if (job.attempts + 1 >= job.max_attempts) {
        // Max attempts reached - mark as permanently failed
        console.error(`[QueueProcessor] Job ${job.id} permanently failed after ${job.max_attempts} attempts`);
        await markJobFailed(env, job.id, job.sync_session_id, errorMessage);
      } else {
        // Not max attempts yet - reset to pending for retry
        console.log(`[QueueProcessor] Job ${job.id} will be retried (attempt ${job.attempts + 1}/${job.max_attempts})`);
        await env.DB.prepare(
          `UPDATE sync_queue
           SET status = 'pending',
               last_error = ?
           WHERE id = ?`
        ).bind(errorMessage, job.id).run();
      }
    }
  } catch (error) {
    console.error('[QueueProcessor] Queue processor error:', error);
    // Don't throw - we want the cron to continue running
  }
}

/**
 * Mark a job as permanently failed
 */
async function markJobFailed(
  env: Env,
  jobId: number,
  sessionId: string,
  errorMessage: string
): Promise<void> {
  // Mark queue job as failed
  await env.DB.prepare(
    `UPDATE sync_queue
     SET status = 'failed',
         last_error = ?,
         completed_at = strftime('%s', 'now')
     WHERE id = ?`
  ).bind(errorMessage, jobId).run();

  // Also mark sync_progress as error (for dashboard visibility)
  await env.DB.prepare(
    `UPDATE sync_progress
     SET status = 'error',
         error_message = ?,
         error_step = current_step,
         completed_at = strftime('%s', 'now')
     WHERE sync_session_id = ?`
  ).bind(errorMessage, sessionId).run();

  // Update athlete back to idle
  await env.DB.prepare(
    `UPDATE athletes
     SET current_sync_step = 'idle'
     WHERE id = (SELECT athlete_id FROM sync_queue WHERE id = ?)`
  ).bind(jobId).run();

  console.log(`[QueueProcessor] Job ${jobId} marked as failed: ${errorMessage}`);
}

/**
 * Process a time-based chunk job (fetch activities for a specific time range)
 */
async function processChunkedTimeFetch(
  env: Env,
  job: SyncQueueJob,
  athlete: any
): Promise<void> {
  const chunkNum = (job.chunk_index || 0) + 1;
  console.log(`[TimeChunkProcessor] Processing time chunk ${chunkNum}/${job.total_chunks} for sync ${job.parent_session_id}`);
  console.log(`[TimeChunkProcessor] Date range: ${job.after_date} to ${job.before_date}`);

  // Import sync functions
  const { syncAthlete } = await import('../sync/rotation-sync');

  // Process this time chunk as a normal sync with date filters
  // This will fetch activities, filter to races, and save them
  await syncAthlete(env, athlete, 'manual', {
    sessionId: job.sync_session_id,
    afterDate: job.after_date || undefined,
    beforeDate: job.before_date || undefined,
  });

  // Check if all time chunks are complete
  const remainingChunks = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM sync_queue
     WHERE parent_session_id = ? AND sync_type = 'chunked_time_fetch' AND status IN ('pending', 'processing')`
  ).bind(job.parent_session_id).first<{ count: number }>();

  const remaining = remainingChunks?.count || 0;
  console.log(`[TimeChunkProcessor] Time chunk ${chunkNum}/${job.total_chunks} complete. ${remaining} chunks remaining.`);

  if (remaining === 0) {
    // All time chunks processed - finalize parent sync
    const raceCountResult = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM races WHERE athlete_id = ?'
    ).bind(athlete.id).first<{ count: number }>();
    const totalRaceCount = raceCountResult?.count || 0;
    const completedAt = Math.floor(Date.now() / 1000);

    // Get total activities count from all completed time chunks
    const activityCountResult = await env.DB.prepare(
      `SELECT SUM(total_activities_fetched) as total FROM sync_progress
       WHERE sync_session_id LIKE ? AND status = 'completed'`
    ).bind(`${job.parent_session_id}-time-%`).first<{ total: number }>();
    const totalActivities = activityCountResult?.total || 0;

    await env.DB.prepare(
      `UPDATE sync_progress SET status = 'completed', current_step = 'completed', completed_at = ?, total_activities_fetched = ?
       WHERE sync_session_id = ?`
    ).bind(completedAt, totalActivities, job.parent_session_id).run();

    await env.DB.prepare(
      `UPDATE athletes SET current_sync_step = 'completed', last_synced_at = ?, race_count = ?, total_activities_count = ?, updated_at = ?
       WHERE id = ?`
    ).bind(completedAt, totalRaceCount, totalActivities, completedAt, athlete.id).run();

    console.log(`[TimeChunkProcessor] Sync ${job.parent_session_id} finalized. Total activities: ${totalActivities}, Total races: ${totalRaceCount}`);
  }
}

/**
 * Process a race detail chunk job (fetch details for a batch of races)
 */
async function processChunkedDetailFetch(
  env: Env,
  job: SyncQueueJob,
  athlete: any
): Promise<void> {
  const chunkNum = (job.chunk_index || 0) + 1;
  console.log(`[DetailChunkProcessor] Processing detail chunk ${chunkNum}/${job.total_chunks} for sync ${job.parent_session_id}`);

  const raceIds: number[] = JSON.parse(job.race_ids || '[]');
  if (raceIds.length === 0) {
    console.warn(`[DetailChunkProcessor] Chunk ${job.id} has no race IDs`);
    return;
  }

  const { ensureValidToken } = await import('../sync/rotation-sync');
  const accessToken = await ensureValidToken(athlete, env);
  const detailedActivities = new Map<number, any>();

  for (const raceId of raceIds) {
    try {
      const response = await fetch(`https://www.strava.com/api/v3/activities/${raceId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (response.ok) {
        detailedActivities.set(raceId, await response.json());
      }
    } catch (error) {
      console.error(`[DetailChunkProcessor] Error fetching race ${raceId}:`, error);
    }
  }

  const { saveRaceFromDetailed } = await import('../utils/db');
  for (const [raceId, detailed] of detailedActivities) {
    try {
      await saveRaceFromDetailed(env, athlete.id, detailed);
    } catch (error) {
      console.error(`[DetailChunkProcessor] Error saving race ${raceId}:`, error);
    }
  }

  const remainingChunks = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM sync_queue
     WHERE parent_session_id = ? AND sync_type = 'chunked_detail_fetch' AND status IN ('pending', 'processing')`
  ).bind(job.parent_session_id).first<{ count: number }>();

  const remaining = remainingChunks?.count || 0;
  console.log(`[DetailChunkProcessor] Detail chunk ${chunkNum}/${job.total_chunks} complete. ${remaining} chunks remaining.`);

  if (remaining === 0) {
    const raceCountResult = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM races WHERE athlete_id = ?'
    ).bind(athlete.id).first<{ count: number }>();
    const totalRaceCount = raceCountResult?.count || 0;
    const completedAt = Math.floor(Date.now() / 1000);

    await env.DB.prepare(
      `UPDATE sync_progress SET status = 'completed', current_step = 'completed', completed_at = ?
       WHERE sync_session_id = ?`
    ).bind(completedAt, job.parent_session_id).run();

    await env.DB.prepare(
      `UPDATE athletes SET current_sync_step = 'completed', last_synced_at = ?, race_count = ?, updated_at = ?
       WHERE id = ?`
    ).bind(completedAt, totalRaceCount, completedAt, athlete.id).run();

    console.log(`[DetailChunkProcessor] Sync ${job.parent_session_id} finalized. Total races: ${totalRaceCount}`);
  }
}
