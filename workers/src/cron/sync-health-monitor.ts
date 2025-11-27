// Proactive health monitoring for batched syncs
// Detects and fixes stalled enrichment sessions

import { Env } from '../types';
import { logSyncProgress } from '../utils/sync-logger';

/**
 * Clean up orphaned sync_progress records that have no corresponding sync_queue entry
 * These are syncs that were started but never queued or the queue entry was deleted
 */
async function cleanupOrphanedSyncProgress(env: Env): Promise<void> {
  console.log('[Health Monitor] Checking for orphaned sync_progress records...');

  try {
    // Find sync_progress records that are stuck in 'running' for more than 3 hours
    // and have no corresponding sync_queue entry
    // 3 hours allows for large syncs with many queued chunks to complete
    const orphanedSyncs = await env.DB.prepare(`
      SELECT
        sp.id,
        sp.sync_session_id,
        sp.athlete_id,
        sp.current_step,
        sp.started_at,
        a.firstname,
        a.lastname
      FROM sync_progress sp
      LEFT JOIN athletes a ON sp.athlete_id = a.id
      WHERE sp.status = 'running'
        AND sp.started_at < (strftime('%s', 'now') - 10800)
        AND sp.sync_session_id NOT IN (
          SELECT sync_session_id FROM sync_queue
          WHERE status IN ('pending', 'processing')
        )
    `).all<{
      id: number;
      sync_session_id: string;
      athlete_id: number;
      current_step: string;
      started_at: number;
      firstname: string;
      lastname: string;
    }>();

    if (!orphanedSyncs.results || orphanedSyncs.results.length === 0) {
      console.log('[Health Monitor] No orphaned sync_progress records found');
      return;
    }

    console.log(`[Health Monitor] Found ${orphanedSyncs.results.length} orphaned sync_progress record(s)`);

    // Mark each orphaned sync as error
    for (const sync of orphanedSyncs.results) {
      const hoursStuck = Math.floor((Date.now() / 1000 - sync.started_at) / 3600);
      console.log(`[Health Monitor] Marking orphaned sync ${sync.sync_session_id} as error (${sync.firstname} ${sync.lastname}, stuck for ${hoursStuck}h at step: ${sync.current_step})`);

      await env.DB.prepare(
        `UPDATE sync_progress
         SET status = 'error',
             error_message = ?,
             error_step = current_step,
             completed_at = strftime('%s', 'now')
         WHERE id = ?`
      )
        .bind(
          `Orphaned sync - stuck in '${sync.current_step}' for ${hoursStuck}h with no corresponding queue entry. Auto-fixed by health monitor.`,
          sync.id
        )
        .run();

      await logSyncProgress(env, sync.athlete_id, sync.sync_session_id, 'error',
        `Health monitor detected orphaned sync - no queue entry found after ${hoursStuck}h`,
        { hoursStuck, stuckAtStep: sync.current_step, auto_fixed: true }
      );
    }

    console.log(`[Health Monitor] Fixed ${orphanedSyncs.results.length} orphaned sync_progress record(s)`);

  } catch (error) {
    console.error('[Health Monitor] Error cleaning up orphaned syncs:', error);
  }
}

/**
 * Health check for batched sync sessions
 * Runs periodically to detect and fix stalled enrichment syncs
 * and orphaned sync_progress records
 */
export async function healthCheckBatchedSyncs(env: Env): Promise<void> {
  console.log('[Health Monitor] Checking batched sync health...');

  try {
    // FIRST: Check for orphaned sync_progress records (no corresponding sync_queue entry)
    // These are syncs that were started but never queued or the queue entry was deleted
    await cleanupOrphanedSyncProgress(env);

    // Find all in-progress enrichment sessions
    const inProgressSyncs = await env.DB.prepare(`
      SELECT DISTINCT
        a.id as athlete_id,
        a.sync_session_id,
        a.firstname,
        a.lastname
      FROM athletes a
      WHERE a.sync_status = 'in_progress'
        AND a.sync_session_id IS NOT NULL
        AND a.sync_session_id LIKE 'enrich_%'
    `).all<{
      athlete_id: number;
      sync_session_id: string;
      firstname: string;
      lastname: string;
    }>();

    if (!inProgressSyncs.results || inProgressSyncs.results.length === 0) {
      console.log('[Health Monitor] No in-progress enrichment syncs found');
      return;
    }

    console.log(`[Health Monitor] Found ${inProgressSyncs.results.length} in-progress enrichment sync(s)`);

    // Check each sync session
    for (const sync of inProgressSyncs.results) {
      await checkEnrichmentSession(
        sync.athlete_id,
        sync.sync_session_id,
        `${sync.firstname} ${sync.lastname}`,
        env
      );
    }

  } catch (error) {
    console.error('[Health Monitor] Error during health check:', error);
  }
}

/**
 * Check a single enrichment session for issues
 */
async function checkEnrichmentSession(
  athleteId: number,
  sessionId: string,
  athleteName: string,
  env: Env
): Promise<void> {
  console.log(`[Health Monitor] Checking session ${sessionId} for ${athleteName}`);

  // Check if there are races still needing enrichment
  const racesNeedingEnrichment = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM races
     WHERE athlete_id = ? AND needs_enrichment = 1`
  )
    .bind(athleteId)
    .first<{ count: number }>();

  const pendingRaces = racesNeedingEnrichment?.count || 0;

  // Check if there are pending batches
  const pendingBatches = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM sync_batches
     WHERE sync_session_id = ? AND status = 'pending'`
  )
    .bind(sessionId)
    .first<{ count: number }>();

  const pendingBatchCount = pendingBatches?.count || 0;

  // Check total batches
  const allBatches = await env.DB.prepare(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
       MAX(completed_at) as last_completed
     FROM sync_batches
     WHERE sync_session_id = ?`
  )
    .bind(sessionId)
    .first<{ total: number; completed: number; last_completed: number | null }>();

  console.log(`[Health Monitor] ${athleteName}: ${pendingRaces} races need enrichment, ${pendingBatchCount} batches pending, ${allBatches?.completed}/${allBatches?.total} batches completed`);

  // CASE 1: Races need enrichment but no pending batches - CREATE BATCHES
  if (pendingRaces > 0 && pendingBatchCount === 0) {
    console.log(`[Health Monitor] STALLED SYNC DETECTED: ${athleteName} has ${pendingRaces} races but no pending batches`);

    // Find the highest batch number
    const maxBatch = await env.DB.prepare(
      `SELECT MAX(batch_number) as max_batch FROM sync_batches
       WHERE sync_session_id = ?`
    )
      .bind(sessionId)
      .first<{ max_batch: number | null }>();

    const nextBatchNumber = (maxBatch?.max_batch || 0) + 1;
    const batchSize = 15;
    const batchesNeeded = Math.ceil(pendingRaces / batchSize);

    console.log(`[Health Monitor] Creating ${batchesNeeded} new batch(es) starting from batch ${nextBatchNumber}`);

    // Create new batches
    for (let i = 0; i < batchesNeeded; i++) {
      await env.DB.prepare(
        `INSERT INTO sync_batches (
          athlete_id, sync_session_id, batch_number, status, batch_type
        ) VALUES (?, ?, ?, 'pending', 'enrichment')`
      )
        .bind(athleteId, sessionId, nextBatchNumber + i)
        .run();

      console.log(`[Health Monitor] Created batch ${nextBatchNumber + i} for ${athleteName}`);
    }

    await logSyncProgress(env, athleteId, sessionId, 'warning',
      `Health monitor created ${batchesNeeded} missing batch(es) to process ${pendingRaces} races`,
      { pendingRaces, batchesNeeded, nextBatchNumber, auto_fixed: true }
    );
  }
  // CASE 2: No races need enrichment and no pending batches - COMPLETE SYNC
  else if (pendingRaces === 0 && pendingBatchCount === 0) {
    console.log(`[Health Monitor] Session ${sessionId} for ${athleteName} is complete but not marked as such`);

    // Get final counts
    const totalRaces = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM races WHERE athlete_id = ?`
    )
      .bind(athleteId)
      .first<{ count: number }>();

    const failedRaces = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM races
       WHERE athlete_id = ? AND needs_enrichment = -1`
    )
      .bind(athleteId)
      .first<{ count: number }>();

    // Mark sync as complete - keep sync_session_id for historical reference
    await env.DB.prepare(
      `UPDATE athletes
       SET sync_status = 'completed', sync_error = NULL,
           last_synced_at = ?,
           current_batch_number = 0, total_batches_expected = NULL
       WHERE id = ?`
    )
      .bind(Math.floor(Date.now() / 1000), athleteId)
      .run();

    await logSyncProgress(env, athleteId, sessionId, 'success',
      `Health monitor completed sync: ${totalRaces?.count || 0} races, ${failedRaces?.count || 0} enrichment failures`,
      {
        totalRaces: totalRaces?.count || 0,
        failedEnrichments: failedRaces?.count || 0,
        auto_completed: true
      }
    );

    console.log(`[Health Monitor] Marked session ${sessionId} as completed for ${athleteName}`);
  }
  // CASE 3: Everything looks normal
  else {
    console.log(`[Health Monitor] Session ${sessionId} for ${athleteName} is healthy`);
  }
}
