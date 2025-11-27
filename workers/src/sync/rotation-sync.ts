/**
 * New rotation-based sync system for Strava activities
 *
 * Architecture:
 * - Weekly rotation queue: each athlete synced once per week
 * - Flexible: auto-adjusts based on total athlete count
 * - Two-phase sync: bulk fetch → process
 * - Detailed step tracking for admin dashboard
 */

import { Env, StravaActivity, Athlete } from '../types';
import { ensureValidToken, fetchAthleteActivities, filterRaceActivities } from '../utils/strava';
import { v4 as uuidv4 } from 'uuid';

// Sync step definitions
export type SyncStep =
  | 'idle'
  | 'queued'
  | 'fetching_activities'
  | 'filtering_runs'
  | 'checking_existing'
  | 'fetching_details'
  | 'saving_races'
  | 'completed'
  | 'error';

interface SyncSession {
  sessionId: string;
  athleteId: number;
  currentStep: SyncStep;
  startedAt: number;
}

interface SyncProgress {
  totalActivitiesFetched: number;
  runsFiltered: number;
  racesFiltered: number;
  newRacesAdded: number;
  existingRacesUpdated: number;
  racesRemoved: number;
}

/**
 * Get next athlete due for sync based on last_synced_at
 * Returns null if no athletes need syncing or if one is already syncing
 */
export async function getNextAthleteForSync(env: Env): Promise<Athlete | null> {
  // Check if any athlete is currently syncing
  const activeSyncResult = await env.DB.prepare(
    `SELECT id FROM athletes WHERE current_sync_step NOT IN ('idle', 'completed', 'error') LIMIT 1`
  ).first();

  if (activeSyncResult) {
    console.log('[RotationSync] Athlete already syncing, skipping...');
    return null;
  }

  // Get athlete who hasn't been synced in longest time
  // Prioritize athletes with access tokens (skip manual submission athletes)
  const result = await env.DB.prepare(
    `SELECT * FROM athletes
     WHERE access_token IS NOT NULL
     AND is_blocked = 0
     ORDER BY last_synced_at ASC NULLS FIRST
     LIMIT 1`
  ).first<Athlete>();

  return result || null;
}

/**
 * Log sync step with message
 */
async function logSyncStep(
  env: Env,
  sessionId: string,
  athleteId: number,
  step: SyncStep,
  level: 'info' | 'warning' | 'error' | 'success',
  message: string,
  metadata?: Record<string, any>
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sync_step_logs (sync_session_id, athlete_id, step, log_level, message, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      sessionId,
      athleteId,
      step,
      level,
      message,
      metadata ? JSON.stringify(metadata) : null,
      Math.floor(Date.now() / 1000)
    )
    .run();
}

/**
 * Update athlete's current sync step
 */
async function updateSyncStep(
  env: Env,
  athleteId: number,
  step: SyncStep
): Promise<void> {
  await env.DB.prepare(
    `UPDATE athletes SET current_sync_step = ?, updated_at = ? WHERE id = ?`
  )
    .bind(step, Math.floor(Date.now() / 1000), athleteId)
    .run();
}

/**
 * Update sync progress record
 */
async function updateSyncProgress(
  env: Env,
  sessionId: string,
  updates: Partial<{
    currentStep: SyncStep;
    status: 'running' | 'completed' | 'error';
    totalActivitiesFetched: number;
    runsFiltered: number;
    racesFiltered: number;
    newRacesAdded: number;
    existingRacesUpdated: number;
    racesRemoved: number;
    lastActivityTimestamp: number;
    hasMoreActivities: number;
    errorMessage: string;
    errorStep: SyncStep;
    completedAt: number;
    stravaRateLimit15min: number;
    stravaRateLimitDaily: number;
  }>
): Promise<void> {
  const setClauses: string[] = [];
  const values: any[] = [];

  if (updates.currentStep !== undefined) {
    setClauses.push('current_step = ?');
    values.push(updates.currentStep);
  }
  if (updates.status !== undefined) {
    setClauses.push('status = ?');
    values.push(updates.status);
  }
  if (updates.totalActivitiesFetched !== undefined) {
    setClauses.push('total_activities_fetched = ?');
    values.push(updates.totalActivitiesFetched);
  }
  if (updates.runsFiltered !== undefined) {
    setClauses.push('runs_filtered = ?');
    values.push(updates.runsFiltered);
  }
  if (updates.racesFiltered !== undefined) {
    setClauses.push('races_filtered = ?');
    values.push(updates.racesFiltered);
  }
  if (updates.newRacesAdded !== undefined) {
    setClauses.push('new_races_added = ?');
    values.push(updates.newRacesAdded);
  }
  if (updates.existingRacesUpdated !== undefined) {
    setClauses.push('existing_races_updated = ?');
    values.push(updates.existingRacesUpdated);
  }
  if (updates.racesRemoved !== undefined) {
    setClauses.push('races_removed = ?');
    values.push(updates.racesRemoved);
  }
  if (updates.lastActivityTimestamp !== undefined) {
    setClauses.push('last_activity_timestamp = ?');
    values.push(updates.lastActivityTimestamp);
  }
  if (updates.hasMoreActivities !== undefined) {
    setClauses.push('has_more_activities = ?');
    values.push(updates.hasMoreActivities);
  }
  if (updates.errorMessage !== undefined) {
    setClauses.push('error_message = ?');
    values.push(updates.errorMessage);
  }
  if (updates.errorStep !== undefined) {
    setClauses.push('error_step = ?');
    values.push(updates.errorStep);
  }
  if (updates.completedAt !== undefined) {
    setClauses.push('completed_at = ?');
    values.push(updates.completedAt);
  }
  if (updates.stravaRateLimit15min !== undefined) {
    setClauses.push('strava_rate_limit_15min = ?');
    values.push(updates.stravaRateLimit15min);
  }
  if (updates.stravaRateLimitDaily !== undefined) {
    setClauses.push('strava_rate_limit_daily = ?');
    values.push(updates.stravaRateLimitDaily);
  }

  if (setClauses.length === 0) return;

  values.push(sessionId);
  await env.DB.prepare(
    `UPDATE sync_progress SET ${setClauses.join(', ')} WHERE sync_session_id = ?`
  )
    .bind(...values)
    .run();
}

/**
 * Phase 1: Bulk fetch all activities from Strava
 * Uses activity:read scope (public activities only)
 */
async function fetchAllActivities(
  env: Env,
  athlete: Athlete,
  sessionId: string,
  afterTimestamp?: number,
  beforeTimestamp?: number
): Promise<{ activities: StravaActivity[]; rateLimits: any }> {
  const step: SyncStep = 'fetching_activities';
  await updateSyncStep(env, athlete.id, step);

  const dateRangeMsg = afterTimestamp || beforeTimestamp
    ? ` (date range: ${afterTimestamp ? new Date(afterTimestamp * 1000).toISOString().split('T')[0] : 'all'} to ${beforeTimestamp ? new Date(beforeTimestamp * 1000).toISOString().split('T')[0] : 'now'})`
    : '';

  await logSyncStep(env, sessionId, athlete.id, step, 'info', `Starting bulk activity fetch from Strava${dateRangeMsg}`);

  // Ensure valid access token
  const accessToken = await ensureValidToken(athlete, env);

  // Fetch activities in batches of 200 (Strava max per page)
  const { activities, rateLimits } = await fetchAthleteActivities(
    accessToken,
    afterTimestamp, // optional 'after' filter for date range
    beforeTimestamp, // optional 'before' filter for date range
    200 // max per page
  );

  await logSyncStep(
    env,
    sessionId,
    athlete.id,
    step,
    'success',
    `Fetched ${activities.length} total activities from Strava`,
    { count: activities.length, rateLimits }
  );

  await updateSyncProgress(env, sessionId, {
    totalActivitiesFetched: activities.length,
    stravaRateLimit15min: rateLimits.usage_15min,
    stravaRateLimitDaily: rateLimits.usage_daily,
  });

  return { activities, rateLimits };
}

/**
 * Filter activities to runs + races only
 */
async function filterRunsAndRaces(
  env: Env,
  athlete: Athlete,
  sessionId: string,
  activities: StravaActivity[]
): Promise<{ runs: StravaActivity[]; races: StravaActivity[] }> {
  const step: SyncStep = 'filtering_runs';
  await updateSyncStep(env, athlete.id, step);
  await logSyncStep(env, sessionId, athlete.id, step, 'info', 'Filtering activities to runs and races');

  // Filter to runs only
  const runs = activities.filter((a) => a.type === 'Run');

  // Filter to races (workout_type === 1)
  const races = runs.filter((a) => a.workout_type === 1);

  await logSyncStep(
    env,
    sessionId,
    athlete.id,
    step,
    'success',
    `Filtered: ${runs.length} runs, ${races.length} races (${activities.length - runs.length} non-runs discarded)`,
    { totalActivities: activities.length, runs: runs.length, races: races.length }
  );

  await updateSyncProgress(env, sessionId, {
    runsFiltered: runs.length,
    racesFiltered: races.length,
  });

  return { runs, races };
}

/**
 * Phase 2: Check which races already exist in database
 */
async function checkExistingRaces(
  env: Env,
  athlete: Athlete,
  sessionId: string,
  races: StravaActivity[]
): Promise<{ newRaces: StravaActivity[]; existingRaceIds: Set<number> }> {
  const step: SyncStep = 'checking_existing';
  await updateSyncStep(env, athlete.id, step);
  await logSyncStep(env, sessionId, athlete.id, step, 'info', 'Checking which races already exist in database');

  if (races.length === 0) {
    await logSyncStep(env, sessionId, athlete.id, step, 'info', 'No races to check');
    return { newRaces: [], existingRaceIds: new Set() };
  }

  // Get all existing race IDs for this athlete
  const existingRacesResult = await env.DB.prepare(
    `SELECT strava_activity_id FROM races WHERE athlete_id = ?`
  )
    .bind(athlete.id)
    .all<{ strava_activity_id: number }>();

  const existingRaceIds = new Set(existingRacesResult.results.map((r) => r.strava_activity_id));

  // Filter to only new races
  const newRaces = races.filter((race) => !existingRaceIds.has(race.id));

  await logSyncStep(
    env,
    sessionId,
    athlete.id,
    step,
    'success',
    `Found ${newRaces.length} new races (${existingRaceIds.size} already in database)`,
    { newRaces: newRaces.length, existingRaces: existingRaceIds.size }
  );

  return { newRaces, existingRaceIds };
}

/**
 * Phase 3: Fetch detailed activity data for new races (polylines, descriptions)
 */
async function fetchRaceDetails(
  env: Env,
  athlete: Athlete,
  sessionId: string,
  races: StravaActivity[]
): Promise<Map<number, StravaActivity>> {
  const step: SyncStep = 'fetching_details';
  await updateSyncStep(env, athlete.id, step);
  await logSyncStep(
    env,
    sessionId,
    athlete.id,
    step,
    'info',
    `Fetching detailed data for ${races.length} new races`
  );

  if (races.length === 0) {
    return new Map();
  }

  const accessToken = await ensureValidToken(athlete, env);
  const detailedActivities = new Map<number, StravaActivity>();

  // Fetch details for each race (includes polyline + description)
  for (const race of races) {
    try {
      const response = await fetch(
        `https://www.strava.com/api/v3/activities/${race.id}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (response.ok) {
        const detailed = (await response.json()) as StravaActivity;
        detailedActivities.set(race.id, detailed);
      } else {
        console.warn(`Failed to fetch details for activity ${race.id}: ${response.statusText}`);
      }
    } catch (error) {
      console.error(`Error fetching details for activity ${race.id}:`, error);
    }
  }

  await logSyncStep(
    env,
    sessionId,
    athlete.id,
    step,
    'success',
    `Fetched details for ${detailedActivities.size}/${races.length} races`,
    { fetched: detailedActivities.size, total: races.length }
  );

  return detailedActivities;
}

/**
 * Phase 4: Save new races to database
 */
async function saveRaces(
  env: Env,
  athlete: Athlete,
  sessionId: string,
  races: StravaActivity[],
  detailedActivities: Map<number, StravaActivity>
): Promise<number> {
  const step: SyncStep = 'saving_races';
  await updateSyncStep(env, athlete.id, step);
  await logSyncStep(env, sessionId, athlete.id, step, 'info', `Saving ${races.length} new races to database`);

  if (races.length === 0) {
    return 0;
  }

  // Get existing event name mappings for this athlete
  const mappingsResult = await env.DB.prepare(
    `SELECT strava_activity_id, event_name, is_hidden FROM activity_event_mappings WHERE athlete_id = ?`
  )
    .bind(athlete.id)
    .all<{ strava_activity_id: number; event_name: string | null; is_hidden: number }>();

  const mappings = new Map(
    mappingsResult.results.map((m) => [m.strava_activity_id, { eventName: m.event_name, isHidden: m.is_hidden }])
  );

  let savedCount = 0;

  for (const race of races) {
    const detailed = detailedActivities.get(race.id) || race;
    const mapping = mappings.get(race.id);

    try {
      // Insert race
      await env.DB.prepare(
        `INSERT INTO races (
          athlete_id, strava_activity_id, name, distance, elapsed_time, moving_time,
          date, elevation_gain, average_heartrate, max_heartrate, polyline, event_name,
          is_hidden, description, raw_response, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          athlete.id,
          race.id,
          race.name,
          race.distance,
          race.elapsed_time,
          race.moving_time,
          race.start_date.split('T')[0], // ISO date
          race.total_elevation_gain || 0,
          race.average_heartrate || null,
          race.max_heartrate || null,
          detailed.map?.summary_polyline || null,
          mapping?.eventName || null,
          mapping?.isHidden || 0,
          detailed.description || null,
          JSON.stringify(detailed),
          Math.floor(Date.now() / 1000)
        )
        .run();

      savedCount++;
    } catch (error) {
      console.error(`Failed to save race ${race.id}:`, error);
      await logSyncStep(
        env,
        sessionId,
        athlete.id,
        step,
        'error',
        `Failed to save race: ${race.name}`,
        { activityId: race.id, error: String(error) }
      );
    }
  }

  await logSyncStep(
    env,
    sessionId,
    athlete.id,
    step,
    'success',
    `Saved ${savedCount} races to database`,
    { saved: savedCount, total: races.length }
  );

  await updateSyncProgress(env, sessionId, { newRacesAdded: savedCount });

  return savedCount;
}

/**
 * Main sync function - orchestrates all phases
 */
export async function syncAthlete(
  env: Env,
  athlete: Athlete,
  syncType: 'auto' | 'manual' = 'auto',
  options?: {
    afterDate?: string; // ISO date string (YYYY-MM-DD)
    beforeDate?: string; // ISO date string (YYYY-MM-DD)
    sessionId?: string; // Optional: use existing session ID (for manual syncs)
  }
): Promise<void> {
  const sessionId = options?.sessionId || uuidv4();
  const startedAt = Math.floor(Date.now() / 1000);

  const dateRangeMsg = options?.afterDate || options?.beforeDate
    ? ` with date range ${options.afterDate || 'all'} to ${options.beforeDate || 'now'}`
    : '';

  console.log(`[RotationSync] Starting ${syncType} sync for athlete ${athlete.strava_id}${dateRangeMsg} (session: ${sessionId})`);

  try {
    // Create sync progress record if it doesn't exist yet
    // Check if sync_progress already exists for this session
    const existingProgress = await env.DB.prepare(
      `SELECT id FROM sync_progress WHERE sync_session_id = ? LIMIT 1`
    ).bind(sessionId).first();

    if (!existingProgress) {
      await env.DB.prepare(
        `INSERT INTO sync_progress (
          athlete_id, sync_session_id, current_step, status, sync_type, started_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(athlete.id, sessionId, 'queued', 'running', syncType, startedAt)
        .run();
      console.log(`[RotationSync] Created sync_progress record for session ${sessionId}`);
    } else {
      console.log(`[RotationSync] Using existing sync_progress record for session ${sessionId}`);
    }

    await updateSyncStep(env, athlete.id, 'queued');
    await logSyncStep(env, sessionId, athlete.id, 'queued', 'info', `Sync queued and starting${dateRangeMsg}`);

    // Convert ISO dates to Unix timestamps
    const afterTimestamp = options?.afterDate ? Math.floor(new Date(options.afterDate).getTime() / 1000) : undefined;
    const beforeTimestamp = options?.beforeDate ? Math.floor(new Date(options.beforeDate).getTime() / 1000) : undefined;

    // Phase 0: Check if we need to chunk by time (too many total activities)
    // Subrequest limit: 50 total
    // Problem: Activity pages + race detail fetches happen in same Worker invocation
    // Worst case: If we fetch P pages, we might find P * 200 * 10% = 20P new races (assuming 10% are races)
    // Total subrequests = P (pages) + min(20P, 45) (race details, capped by detail chunking)
    // Before detail chunking kicks in: P + 20P = 21P < 50 → P < 2.4
    // So max ~2 pages (400 activities) before we MUST use time chunking
    // This is very conservative but necessary to avoid subrequest limit
    const ACTIVITIES_PER_PAGE = 200;
    const MAX_SAFE_ACTIVITY_PAGES = 2; // Conservative: 2 pages + up to 40 races = ~42 subrequests
    const MAX_SAFE_ACTIVITIES = ACTIVITIES_PER_PAGE * MAX_SAFE_ACTIVITY_PAGES; // 400

    if (athlete.total_activities_count && athlete.total_activities_count > MAX_SAFE_ACTIVITIES && !afterTimestamp) {
      // Too many activities - need to chunk by time
      await logSyncStep(
        env,
        sessionId,
        athlete.id,
        'fetching_activities',
        'info',
        `Large athlete detected: ${athlete.total_activities_count} total activities. Chunking by time to avoid subrequest limits.`
      );

      // Split into 1-year chunks, working backwards from now
      const nowTimestamp = beforeTimestamp || Math.floor(Date.now() / 1000);
      const oneYearSeconds = 365 * 24 * 60 * 60;
      const chunks: Array<{ after: number; before: number }> = [];

      // Determine how far back we need to go
      // Assume athlete joined in 2010 or use afterTimestamp if provided
      const startTimestamp = afterTimestamp || new Date('2010-01-01').getTime() / 1000;

      let currentBefore = nowTimestamp;
      while (currentBefore > startTimestamp) {
        const currentAfter = Math.max(startTimestamp, currentBefore - oneYearSeconds);
        chunks.push({ after: currentAfter, before: currentBefore });
        currentBefore = currentAfter;
      }

      await logSyncStep(
        env,
        sessionId,
        athlete.id,
        'fetching_activities',
        'info',
        `Creating ${chunks.length} time-based chunks (1 year each) to process activities`
      );

      // Create time-chunked jobs in the queue
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const afterDate = new Date(chunk.after * 1000).toISOString().split('T')[0];
        const beforeDate = new Date(chunk.before * 1000).toISOString().split('T')[0];

        await env.DB.prepare(
          `INSERT INTO sync_queue (
            athlete_id, strava_id, sync_session_id, sync_type,
            status, chunk_index, total_chunks, after_date, before_date, parent_session_id
          ) VALUES (?, ?, ?, 'chunked_time_fetch', 'pending', ?, ?, ?, ?, ?)`
        )
          .bind(
            athlete.id,
            athlete.strava_id,
            `${sessionId}-time-${i}`,
            i,
            chunks.length,
            afterDate,
            beforeDate,
            sessionId
          )
          .run();
      }

      await logSyncStep(
        env,
        sessionId,
        athlete.id,
        'fetching_activities',
        'success',
        `Created ${chunks.length} time-chunk jobs for processing activities`
      );

      // Mark sync as pending chunks
      await updateSyncProgress(env, sessionId, {
        currentStep: 'fetching_activities',
      });

      console.log(`[RotationSync] Time-chunked sync for athlete ${athlete.strava_id}: ${chunks.length} chunks queued`);
      return; // Exit - chunks will be processed by queue processor
    }

    // Phase 1: Fetch all activities (normal path - reasonable number of activities)
    const { activities, rateLimits } = await fetchAllActivities(env, athlete, sessionId, afterTimestamp, beforeTimestamp);

    // Phase 2: Filter to runs and races
    const { runs, races } = await filterRunsAndRaces(env, athlete, sessionId, activities);

    // Phase 3: Check which races are new
    const { newRaces, existingRaceIds } = await checkExistingRaces(env, athlete, sessionId, races);

    // Phase 4: Check if we need to chunk this sync (too many new races)
    const MAX_RACES_PER_CHUNK = 40; // Safe limit under Workers 50 subrequest limit
    const CHUNK_THRESHOLD = 45;

    if (newRaces.length > CHUNK_THRESHOLD) {
      // Too many races - split into chunks to avoid subrequest limit
      await logSyncStep(
        env,
        sessionId,
        athlete.id,
        'fetching_details',
        'info',
        `Large sync detected: ${newRaces.length} new races. Splitting into chunks to avoid subrequest limits.`
      );

      const totalChunks = Math.ceil(newRaces.length / MAX_RACES_PER_CHUNK);

      // Create chunk jobs in the queue
      for (let i = 0; i < newRaces.length; i += MAX_RACES_PER_CHUNK) {
        const chunk = newRaces.slice(i, i + MAX_RACES_PER_CHUNK);
        const chunkIndex = Math.floor(i / MAX_RACES_PER_CHUNK);

        await env.DB.prepare(
          `INSERT INTO sync_queue (
            athlete_id, strava_id, sync_session_id, sync_type,
            status, chunk_index, total_chunks, race_ids, parent_session_id
          ) VALUES (?, ?, ?, 'chunked_detail_fetch', 'pending', ?, ?, ?, ?)`
        )
          .bind(
            athlete.id,
            athlete.strava_id,
            `${sessionId}-chunk-${chunkIndex}`,
            chunkIndex,
            totalChunks,
            JSON.stringify(chunk.map(r => r.id)),
            sessionId
          )
          .run();
      }

      await logSyncStep(
        env,
        sessionId,
        athlete.id,
        'fetching_details',
        'success',
        `Created ${totalChunks} chunk jobs for processing ${newRaces.length} races`
      );

      // Mark sync as pending chunks (not fully complete yet)
      await updateSyncProgress(env, sessionId, {
        currentStep: 'fetching_details',
        racesFiltered: races.length,
      });

      console.log(`[RotationSync] Chunked sync for athlete ${athlete.strava_id}: ${totalChunks} chunks queued`);
      return; // Exit - chunks will be processed by queue processor
    }

    // Phase 4: Fetch detailed data for new races (normal path - small number of races)
    const detailedActivities = await fetchRaceDetails(env, athlete, sessionId, newRaces);

    // Phase 5: Save new races
    const savedCount = await saveRaces(env, athlete, sessionId, newRaces, detailedActivities);

    // Mark complete
    const completedAt = Math.floor(Date.now() / 1000);
    await updateSyncStep(env, athlete.id, 'completed');
    await updateSyncProgress(env, sessionId, {
      currentStep: 'completed',
      status: 'completed',
      completedAt,
    });

    // Get total race count for this athlete from database
    const raceCountResult = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM races WHERE athlete_id = ?'
    )
      .bind(athlete.id)
      .first<{ count: number }>();
    const totalRaceCount = raceCountResult?.count || 0;

    // Update athlete's last_synced_at, last_sync_type, and counts
    await env.DB.prepare(
      `UPDATE athletes
       SET last_synced_at = ?,
           last_sync_type = ?,
           sync_status = 'completed',
           sync_error = NULL,
           updated_at = ?,
           total_activities_count = ?,
           race_count = ?
       WHERE id = ?`
    )
      .bind(completedAt, syncType, completedAt, activities.length, totalRaceCount, athlete.id)
      .run();

    await logSyncStep(
      env,
      sessionId,
      athlete.id,
      'completed',
      'success',
      `Sync completed successfully in ${completedAt - startedAt} seconds`,
      {
        duration: completedAt - startedAt,
        totalActivities: activities.length,
        newRaces: savedCount,
        existingRaces: existingRaceIds.size,
      }
    );

    console.log(`[RotationSync] Sync completed for athlete ${athlete.strava_id}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const currentStep = athlete.current_sync_step as SyncStep;

    console.error(`[RotationSync] Sync failed for athlete ${athlete.strava_id}:`, error);

    await updateSyncStep(env, athlete.id, 'error');
    await updateSyncProgress(env, sessionId, {
      currentStep: 'error',
      status: 'error',
      errorMessage,
      errorStep: currentStep,
      completedAt: Math.floor(Date.now() / 1000),
    });

    await env.DB.prepare(
      `UPDATE athletes SET sync_status = 'error', sync_error = ?, updated_at = ? WHERE id = ?`
    )
      .bind(errorMessage, Math.floor(Date.now() / 1000), athlete.id)
      .run();

    await logSyncStep(env, sessionId, athlete.id, 'error', 'error', `Sync failed: ${errorMessage}`, {
      error: errorMessage,
      step: currentStep,
    });

    throw error;
  }
}

/**
 * Process next athlete in rotation queue
 * Called by cron job
 */
export async function processNextAthlete(env: Env): Promise<boolean> {
  const athlete = await getNextAthleteForSync(env);

  if (!athlete) {
    console.log('[RotationSync] No athletes due for sync');
    return false;
  }

  console.log(`[RotationSync] Processing athlete: ${athlete.firstname} ${athlete.lastname} (${athlete.strava_id})`);

  await syncAthlete(env, athlete);
  return true;
}
