// Scheduled job to sync race activities using rotation queue

import { Env } from '../types';
import { processNextAthlete } from '../sync/rotation-sync';

/**
 * Main sync function - called by cron trigger
 * Processes next athlete in rotation queue
 */
export async function syncAllAthletes(env: Env): Promise<void> {
  console.log('[Cron] Starting rotation-based sync...');

  try {
    const processed = await processNextAthlete(env);

    if (processed) {
      console.log('[Cron] Successfully processed next athlete in rotation');
    } else {
      console.log('[Cron] No athletes due for sync (or one already syncing)');
    }
  } catch (error) {
    console.error('[Cron] Sync failed:', error);
    throw error;
  }
}

/**
 * Sleep utility for rate limit handling
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
