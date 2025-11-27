// Scheduled job to sync race activities using rotation queue

import { Env } from '../types';

/**
 * Main sync function - called by cron trigger (every hour)
 * Queues next athlete in rotation for incremental sync (last 7 days)
 * Dynamically spreads syncs to ensure all athletes get synced at least once per day
 */
export async function syncAllAthletes(env: Env): Promise<boolean> {
  console.log('[DailyRotation] Starting rotation-based sync...');

  try {
    // Check if any athlete is currently syncing
    const activeSyncResult = await env.DB.prepare(
      `SELECT id FROM athletes WHERE current_sync_step NOT IN ('idle', 'completed', 'error') LIMIT 1`
    ).first();

    if (activeSyncResult) {
      console.log('[DailyRotation] Athlete already syncing, skipping...');
      return false;
    }

    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    const oneDayAgo = now - (24 * 60 * 60); // 24 hours ago

    // Get athlete who hasn't been synced in the last 24 hours
    // Prioritize athletes who haven't been synced in longest time
    const athlete = await env.DB.prepare(
      `SELECT * FROM athletes
       WHERE access_token IS NOT NULL
       AND is_blocked = 0
       AND (last_synced_at IS NULL OR last_synced_at < ?)
       ORDER BY last_synced_at ASC NULLS FIRST
       LIMIT 1`
    ).bind(oneDayAgo).first<any>();

    if (!athlete) {
      console.log('[DailyRotation] All athletes synced within last 24 hours');
      return false;
    }

    // Check if already in queue
    const existingJob = await env.DB.prepare(
      `SELECT id FROM sync_queue
       WHERE athlete_id = ? AND status IN ('pending', 'processing')
       LIMIT 1`
    ).bind(athlete.id).first();

    if (existingJob) {
      console.log(`[DailyRotation] Athlete ${athlete.strava_id} already in queue, skipping`);
      return false;
    }

    // Calculate date range: 7 days ago to now
    // This ensures we catch any new activities they might have added
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const afterDate = sevenDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD format

    // Create sync queue entry
    const sessionId = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO sync_queue (
        athlete_id, strava_id, sync_session_id, sync_type,
        after_date, before_date, status, created_at
      ) VALUES (?, ?, ?, 'rotation', ?, NULL, 'pending', strftime('%s', 'now'))`
    ).bind(
      athlete.id,
      athlete.strava_id,
      sessionId,
      afterDate
    ).run();

    console.log(`[DailyRotation] Queued athlete ${athlete.firstname} ${athlete.lastname} (${athlete.strava_id}) for sync from ${afterDate}`);
    return true;

  } catch (error) {
    console.error('[DailyRotation] Sync failed:', error);
    throw error;
  }
}

/**
 * Sleep utility for rate limit handling
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
