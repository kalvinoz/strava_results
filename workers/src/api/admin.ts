// Admin API endpoints
import { Env } from '../types';

/**
 * Check if a user is an admin
 */
async function isAdmin(stravaId: number, env: Env): Promise<boolean> {
  const result = await env.DB.prepare(
    'SELECT is_admin FROM athletes WHERE strava_id = ?'
  )
    .bind(stravaId)
    .first<{ is_admin: number }>();

  return result?.is_admin === 1;
}

/**
 * GET /api/admin/athletes - Get all athletes with admin info
 */
export async function getAdminAthletes(request: Request, env: Env): Promise<Response> {
  try {
    // Get admin_strava_id from query params
    const url = new URL(request.url);
    const adminStravaId = parseInt(url.searchParams.get('admin_strava_id') || '0');

    if (!adminStravaId || !(await isAdmin(adminStravaId, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get all athletes with race count
    // Try new schema first, fall back to old if migration hasn't run
    let result;
    try {
      result = await env.DB.prepare(
        `SELECT
          a.id,
          a.strava_id,
          a.firstname,
          a.lastname,
          a.profile_photo,
          a.is_admin,
          a.is_hidden,
          a.is_blocked,
          a.sync_status,
          a.sync_error,
          a.current_sync_step,
          a.last_sync_type,
          a.total_activities_count,
          a.last_synced_at,
          a.created_at,
          COALESCE(COUNT(DISTINCT r.id), 0) as race_count
        FROM athletes a
        LEFT JOIN races r ON r.athlete_id = a.id
        GROUP BY a.id
        ORDER BY a.lastname, a.firstname`
      ).all();
    } catch (error) {
      // Fall back to old schema (before migration)
      console.log('Using old schema (migration not yet run)');
      result = await env.DB.prepare(
        `SELECT
          a.id,
          a.strava_id,
          a.firstname,
          a.lastname,
          a.profile_photo,
          a.is_admin,
          a.is_hidden,
          a.is_blocked,
          a.sync_status,
          a.sync_error,
          a.total_activities_count,
          a.last_synced_at,
          a.created_at,
          COALESCE(COUNT(DISTINCT r.id), 0) as race_count
        FROM athletes a
        LEFT JOIN races r ON r.athlete_id = a.id
        GROUP BY a.id
        ORDER BY a.lastname, a.firstname`
      ).all();
    }

    // Calculate next sync time for each athlete
    // Simple formula: distribute athletes evenly across 7 days
    const totalAthletes = result.results.length;
    const SYNC_INTERVAL_DAYS = 7;
    const secondsPerAthlete = (SYNC_INTERVAL_DAYS * 24 * 60 * 60) / Math.max(totalAthletes, 1);

    const athletesWithProgress = [];
    const nowSeconds = Math.floor(Date.now() / 1000);

    for (let i = 0; i < result.results.length; i++) {
      const athlete: any = result.results[i];
      const athleteData: any = { ...athlete };

      // Calculate next scheduled sync time
      // Stagger athletes evenly across 7-day rotation period
      athleteData.next_sync_at = nowSeconds + (i * secondsPerAthlete);

      // Check if there's a pending/processing sync in the queue
      try {
        const queueJob = await env.DB.prepare(
          `SELECT id, status FROM sync_queue
           WHERE athlete_id = ? AND status IN ('pending', 'processing')
           LIMIT 1`
        )
          .bind(athlete.id)
          .first<any>();

        athleteData.has_queued_sync = !!queueJob;
      } catch (error) {
        // sync_queue table doesn't exist yet
        athleteData.has_queued_sync = false;
      }

      // Get latest sync progress if currently syncing (only if new schema exists)
      if (athlete.current_sync_step && !['idle', 'completed', 'error'].includes(athlete.current_sync_step)) {
        try {
          const syncProgress = await env.DB.prepare(
            `SELECT * FROM sync_progress
             WHERE athlete_id = ?
             ORDER BY started_at DESC
             LIMIT 1`
          )
            .bind(athlete.id)
            .first<any>();

          if (syncProgress) {
            athleteData.syncProgress = syncProgress;
          }
        } catch (error) {
          // sync_progress table doesn't exist yet
          console.log('sync_progress table not found, skipping progress query');
        }
      }

      athletesWithProgress.push(athleteData);
    }

    return new Response(JSON.stringify({ athletes: athletesWithProgress }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error fetching admin athletes:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch athletes' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * PATCH /api/admin/athletes/:stravaId - Update athlete admin fields
 * Note: athleteId parameter is actually a Strava ID
 */
export async function updateAthlete(
  request: Request,
  env: Env,
  stravaIdParam: number
): Promise<Response> {
  try {
    const body = await request.json() as {
      admin_strava_id: number;
      is_admin?: boolean;
      is_hidden?: boolean;
      is_blocked?: boolean;
    };

    if (!body.admin_strava_id || !(await isAdmin(body.admin_strava_id, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Convert Strava ID to internal athlete ID
    const athlete = await env.DB.prepare(
      'SELECT id FROM athletes WHERE strava_id = ?'
    )
      .bind(stravaIdParam)
      .first<{ id: number }>();

    if (!athlete) {
      return new Response(
        JSON.stringify({ error: 'Athlete not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Build update query dynamically based on provided fields
    const updates: string[] = [];
    const bindings: any[] = [];

    if (body.is_admin !== undefined) {
      updates.push('is_admin = ?');
      bindings.push(body.is_admin ? 1 : 0);
    }
    if (body.is_hidden !== undefined) {
      updates.push('is_hidden = ?');
      bindings.push(body.is_hidden ? 1 : 0);
    }
    if (body.is_blocked !== undefined) {
      updates.push('is_blocked = ?');
      bindings.push(body.is_blocked ? 1 : 0);
    }

    if (updates.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No fields to update' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    bindings.push(athlete.id);

    await env.DB.prepare(
      `UPDATE athletes SET ${updates.join(', ')} WHERE id = ?`
    )
      .bind(...bindings)
      .run();

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error updating athlete:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to update athlete' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * DELETE /api/admin/athletes/:stravaId - Delete athlete and all their data
 * Note: athleteId parameter is actually a Strava ID
 */
export async function deleteAthlete(
  request: Request,
  env: Env,
  stravaIdParam: number
): Promise<Response> {
  try {
    const body = await request.json() as { admin_strava_id: number };

    if (!body.admin_strava_id || !(await isAdmin(body.admin_strava_id, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Convert Strava ID to internal athlete ID
    const athlete = await env.DB.prepare(
      'SELECT id FROM athletes WHERE strava_id = ?'
    )
      .bind(stravaIdParam)
      .first<{ id: number }>();

    if (!athlete) {
      return new Response(
        JSON.stringify({ error: 'Athlete not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Delete all races first (foreign key constraint)
    await env.DB.prepare('DELETE FROM races WHERE athlete_id = ?')
      .bind(athlete.id)
      .run();

    // Delete the athlete
    await env.DB.prepare('DELETE FROM athletes WHERE id = ?')
      .bind(athlete.id)
      .run();

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error deleting athlete:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to delete athlete' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * POST /api/admin/athletes/:stravaId/sync - Trigger manual sync for athlete
 * Note: athleteId parameter is actually a Strava ID
 */
export async function triggerAthleteSync(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  stravaIdParam: number
): Promise<Response> {
  try {
    const body = await request.json() as {
      admin_strava_id: number;
      after_date?: string;
      before_date?: string;
    };

    if (!body.admin_strava_id || !(await isAdmin(body.admin_strava_id, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get athlete by Strava ID
    const athlete = await env.DB.prepare(
      'SELECT * FROM athletes WHERE strava_id = ?'
    )
      .bind(stravaIdParam)
      .first<any>();

    if (!athlete) {
      return new Response(
        JSON.stringify({ error: 'Athlete not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if already syncing
    if (athlete.current_sync_step && !['idle', 'completed', 'error'].includes(athlete.current_sync_step)) {
      return new Response(
        JSON.stringify({ error: 'Athlete is already syncing', current_step: athlete.current_sync_step }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create sync_progress record first (for dashboard visibility)
    const sessionId = crypto.randomUUID();
    const startedAt = Math.floor(Date.now() / 1000);

    await env.DB.prepare(
      `INSERT INTO sync_progress (
        athlete_id, sync_session_id, current_step, status, sync_type, started_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(athlete.id, sessionId, 'queued', 'running', 'manual', startedAt)
      .run();

    await env.DB.prepare(
      `UPDATE athletes SET current_sync_step = 'queued' WHERE id = ?`
    )
      .bind(athlete.id)
      .run();

    console.log(`[Admin] Created sync session ${sessionId} for athlete ${athlete.strava_id}`);

    // Add job to sync_queue (reliable database-backed queue)
    // This job will be processed by the queue processor cron job
    await env.DB.prepare(
      `INSERT INTO sync_queue (
        athlete_id, strava_id, sync_session_id, sync_type,
        after_date, before_date, status, attempts, max_attempts
      ) VALUES (?, ?, ?, 'manual', ?, ?, 'pending', 0, 3)`
    )
      .bind(
        athlete.id,
        athlete.strava_id,
        sessionId,
        body.after_date || null,
        body.before_date || null
      )
      .run();

    console.log(`[Admin] Enqueued sync job for athlete ${athlete.strava_id} (session: ${sessionId})`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Manual sync queued and will start within 1 minute. Check the Sync Dashboard tab for progress.',
        session_id: sessionId,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error triggering sync:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to trigger sync' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * POST /api/admin/sync-all - Trigger sync for all athletes with optional date range
 */
export async function triggerSyncAll(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    const body = await request.json() as {
      admin_strava_id: number;
      after_date?: string; // ISO date (YYYY-MM-DD)
      before_date?: string; // ISO date (YYYY-MM-DD)
    };

    if (!body.admin_strava_id || !(await isAdmin(body.admin_strava_id, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get all athletes
    const athletes = await env.DB.prepare(
      `SELECT * FROM athletes WHERE access_token IS NOT NULL AND is_blocked = 0`
    ).all<any>();

    if (!athletes.results || athletes.results.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No athletes found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const totalAthletes = athletes.results.length;
    let queuedCount = 0;
    let skippedCount = 0;

    // Queue all athletes for sync using the reliable queue system
    console.log(`[Admin] Sync All: Queuing ${totalAthletes} athletes for sync`);

    for (const athlete of athletes.results) {
      try {
        // Check if already syncing (has an active queue entry)
        const existingJob = await env.DB.prepare(
          `SELECT id FROM sync_queue
           WHERE athlete_id = ? AND status IN ('pending', 'processing')
           LIMIT 1`
        ).bind(athlete.id).first();

        if (existingJob) {
          console.log(`[Admin] Skipping athlete ${athlete.strava_id} - already in queue`);
          skippedCount++;
          continue;
        }

        // Create sync queue entry
        const sessionId = crypto.randomUUID();

        await env.DB.prepare(
          `INSERT INTO sync_queue (
            athlete_id, strava_id, sync_session_id, sync_type,
            after_date, before_date, status, created_at
          ) VALUES (?, ?, ?, 'manual', ?, ?, 'pending', strftime('%s', 'now'))`
        ).bind(
          athlete.id,
          athlete.strava_id,
          sessionId,
          body.after_date || null,
          body.before_date || null
        ).run();

        queuedCount++;
        console.log(`[Admin] Queued athlete ${athlete.strava_id} (session: ${sessionId})`);

      } catch (error) {
        console.error(`[Admin] Failed to queue athlete ${athlete.strava_id}:`, error);
      }
    }

    console.log(`[Admin] Sync All: Queued ${queuedCount} athletes, skipped ${skippedCount} already in queue`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Queued ${queuedCount} athletes for sync${skippedCount > 0 ? ` (${skippedCount} already queued)` : ''}`,
        queued: queuedCount,
        skipped: skippedCount,
        total: totalAthletes,
        date_range: body.after_date || body.before_date
          ? { after: body.after_date || 'all', before: body.before_date || 'now' }
          : null,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error triggering sync all:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to trigger sync all' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * POST /api/admin/athletes/:id/sync/stop - Stop an in-progress sync
 */
export async function stopAthleteSync(
  request: Request,
  env: Env,
  athleteId: number
): Promise<Response> {
  try {
    const body = await request.json() as { admin_strava_id: number };

    if (!body.admin_strava_id || !(await isAdmin(body.admin_strava_id, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check current status
    const athlete = await env.DB.prepare(
      'SELECT sync_status FROM athletes WHERE id = ?'
    )
      .bind(athleteId)
      .first<{ sync_status: string }>();

    if (!athlete) {
      return new Response(
        JSON.stringify({ error: 'Athlete not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (athlete.sync_status !== 'in_progress') {
      return new Response(
        JSON.stringify({ error: 'No sync in progress for this athlete' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Stop the sync by setting status back to completed
    await env.DB.prepare(
      "UPDATE athletes SET sync_status = 'completed', sync_error = 'Stopped by admin' WHERE id = ?"
    )
      .bind(athleteId)
      .run();

    return new Response(
      JSON.stringify({ success: true, message: 'Sync stopped' }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error stopping sync:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to stop sync' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * POST /api/admin/reset-stuck-syncs - Reset all athletes stuck in "in_progress"
 */
export async function resetStuckSyncs(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = await request.json() as { admin_strava_id: number };

    if (!body.admin_strava_id || !(await isAdmin(body.admin_strava_id, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Reset all stuck syncs
    const result = await env.DB.prepare(
      `UPDATE athletes
       SET sync_status = 'completed',
           sync_error = 'Reset from stuck state'
       WHERE sync_status = 'in_progress'`
    ).run();

    return new Response(
      JSON.stringify({
        success: true,
        message: `Reset ${result.meta.changes} stuck athlete(s)`
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error resetting stuck syncs:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to reset stuck syncs' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * GET /api/admin/sync-logs - Get sync logs for a session
 */
export async function getAdminSyncLogs(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('session_id');
    const adminStravaId = parseInt(url.searchParams.get('admin_strava_id') || '0');

    if (!adminStravaId || !(await isAdmin(adminStravaId, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!sessionId) {
      return new Response(
        JSON.stringify({ error: 'session_id parameter is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Fetch sync step logs from new system
    const logs = await env.DB.prepare(
      `SELECT * FROM sync_step_logs WHERE sync_session_id = ? ORDER BY created_at ASC`
    )
      .bind(sessionId)
      .all();

    return new Response(
      JSON.stringify({ logs: logs.results || [] }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching sync logs:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch sync logs' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * GET /api/admin/check - Check if user is an admin
 */
export async function checkAdmin(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const stravaId = parseInt(url.searchParams.get('strava_id') || '0');

    if (!stravaId) {
      return new Response(
        JSON.stringify({ is_admin: false }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const adminStatus = await isAdmin(stravaId, env);

    return new Response(
      JSON.stringify({ is_admin: adminStatus }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error checking admin status:', error);
    return new Response(
      JSON.stringify({ is_admin: false }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * GET /api/admin/api-key - Get the parkrun scraper API key (admin only)
 */
export async function getAdminApiKey(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const adminStravaId = parseInt(url.searchParams.get('admin_strava_id') || '0');

    if (!adminStravaId || !(await isAdmin(adminStravaId, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Return the API key from environment
    const apiKey = env.PARKRUN_API_KEY || '';

    return new Response(
      JSON.stringify({ api_key: apiKey }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error getting API key:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * GET /api/admin/sync-status - Get sync queue status (includes both legacy queue and batched syncs)
 */
export async function getAdminSyncStatus(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const adminStravaId = parseInt(url.searchParams.get('admin_strava_id') || '0');

    if (!adminStravaId || !(await isAdmin(adminStravaId, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Get current sync progress (new system)
    // Only show syncs that are truly running (status='running' in sync_progress)
    const activeSyncs = await env.DB.prepare(`
      SELECT
        sp.sync_session_id,
        sp.athlete_id,
        sp.sync_type,
        sp.current_step,
        sp.status,
        sp.total_activities_fetched,
        sp.runs_filtered,
        sp.races_filtered,
        sp.new_races_added,
        sp.started_at,
        sp.completed_at,
        sp.error_message,
        a.strava_id,
        a.firstname,
        a.lastname,
        a.current_sync_step
      FROM sync_progress sp
      JOIN athletes a ON sp.athlete_id = a.id
      WHERE sp.status = 'running'
      ORDER BY sp.started_at DESC
    `).all();

    const active = (activeSyncs.results || []).map((sync: any) => ({
      id: sync.sync_session_id,
      athlete_id: sync.athlete_id,
      strava_id: sync.strava_id,
      first_name: sync.firstname,
      last_name: sync.lastname,
      current_step: sync.current_step,
      sync_type: sync.sync_type,
      job_type: `${sync.sync_type}_sync`,
      status: sync.status,
      started_at: sync.started_at ? sync.started_at * 1000 : null,
      total_activities_fetched: sync.total_activities_fetched || 0,
      runs_filtered: sync.runs_filtered || 0,
      races_filtered: sync.races_filtered || 0,
      new_races_added: sync.new_races_added || 0,
      error_message: sync.error_message,
    }));

    // Get recently completed syncs
    const recentSyncs = await env.DB.prepare(`
      SELECT
        sp.*,
        a.strava_id,
        a.firstname,
        a.lastname
      FROM sync_progress sp
      JOIN athletes a ON sp.athlete_id = a.id
      WHERE sp.status IN ('completed', 'error')
      ORDER BY sp.completed_at DESC
      LIMIT 10
    `).all();

    const recent = (recentSyncs.results || []).map((sync: any) => ({
      id: sync.sync_session_id,
      athlete_id: sync.athlete_id,
      strava_id: sync.strava_id,
      first_name: sync.firstname,
      last_name: sync.lastname,
      sync_type: sync.sync_type,
      job_type: `${sync.sync_type}_sync`,
      status: sync.status,
      started_at: sync.started_at ? sync.started_at * 1000 : null,
      completed_at: sync.completed_at ? sync.completed_at * 1000 : null,
      total_activities_fetched: sync.total_activities_fetched || 0,
      races_filtered: sync.races_filtered || 0,
      new_races_added: sync.new_races_added || 0,
      error_message: sync.error_message,
    }));

    const combinedStatus = {
      active,
      recent,
    };

    return new Response(
      JSON.stringify(combinedStatus),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error getting sync status:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to get sync status' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}

/**
 * POST /api/admin/sync/stop - Stop a stalled sync
 */
export async function stopSyncJob(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const adminStravaId = parseInt(url.searchParams.get('admin_strava_id') || '0');

    if (!adminStravaId || !(await isAdmin(adminStravaId, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const body = await request.json() as { sync_id: number };

    if (!body.sync_id) {
      return new Response(
        JSON.stringify({ error: 'sync_id is required' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // First, check if sync exists and is running
    const sync = await env.DB.prepare(
      `SELECT athlete_id, current_step FROM sync_progress WHERE sync_session_id = ? AND status = 'running'`
    )
      .bind(body.sync_id)
      .first<{ athlete_id: number; current_step: string }>();

    if (!sync) {
      return new Response(
        JSON.stringify({ error: 'Sync not found or already completed' }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Update sync_progress table to mark as stopped
    await env.DB.prepare(
      `UPDATE sync_progress
       SET status = 'error',
           error_message = 'Stopped by admin',
           error_step = ?,
           completed_at = strftime('%s', 'now')
       WHERE sync_session_id = ?`
    )
      .bind(sync.current_step, body.sync_id)
      .run();

    // Update athlete's current_sync_step to idle
    await env.DB.prepare(
      `UPDATE athletes SET current_sync_step = 'idle' WHERE id = ?`
    )
      .bind(sync.athlete_id)
      .run();

    console.log(`[Admin] Stopped sync ${body.sync_id} for athlete ${sync.athlete_id}`);

    return new Response(
      JSON.stringify({ message: 'Sync stopped successfully', sync_id: body.sync_id }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error stopping sync:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to stop sync' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}

/**
 * WOOD-8: POST /api/admin/athletes/:id/batched-sync - Trigger batched sync for athlete
 * Uses new batched sync architecture for handling large activity datasets
 */
export async function triggerBatchedAthleteSync(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  athleteId: number
): Promise<Response> {
  try {
    const body = await request.json() as { admin_strava_id: number; full_sync?: boolean };

    if (!body.admin_strava_id || !(await isAdmin(body.admin_strava_id, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get athlete
    const athlete = await env.DB.prepare(
      'SELECT strava_id, firstname, lastname FROM athletes WHERE id = ?'
    )
      .bind(athleteId)
      .first<{ strava_id: number; firstname: string; lastname: string }>();

    if (!athlete) {
      return new Response(
        JSON.stringify({ error: 'Athlete not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Cancel any existing in-progress sync
    const currentStatus = await env.DB.prepare(
      'SELECT sync_status, sync_session_id FROM athletes WHERE id = ?'
    )
      .bind(athleteId)
      .first<{ sync_status: string; sync_session_id: string }>();

    // Note: This endpoint uses old batched sync system which has been deprecated
    // Kept for backwards compatibility but should use the new rotation sync instead
    return new Response(
      JSON.stringify({
        error: 'This endpoint is deprecated. Use POST /api/admin/athletes/:id/sync instead'
      }),
      { status: 410, headers: { 'Content-Type': 'application/json' } }
    );

    /*
    // OLD CODE - kept for reference
    if (currentStatus?.sync_status === 'in_progress' && currentStatus.sync_session_id) {
      console.log(`[WOOD-8] Cancelling existing sync session ${currentStatus.sync_session_id}`);
      // await cancelSession(currentStatus.sync_session_id, env);
    }

    // Initiate new two-phase batched sync (discovery + enrichment)
    const fullSync = body.full_sync !== false; // Default to full sync
    const sessionId = await initiateDiscoverySync(athleteId, fullSync, env);

    console.log(`[WOOD-8] Initiated ${fullSync ? 'FULL' : 'incremental'} discovery sync for ${athlete.firstname} ${athlete.lastname} (session: ${sessionId})`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `${fullSync ? 'Full' : 'Incremental'} batched sync initiated`,
        session_id: sessionId,
        athlete: {
          id: athleteId,
          strava_id: athlete.strava_id,
          name: `${athlete.firstname} ${athlete.lastname}`,
        }
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
    */
  } catch (error) {
    console.error('Error triggering batched sync:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorDetails = error instanceof Error ? error.stack : String(error);
    console.error('Error details:', errorDetails);

    return new Response(
      JSON.stringify({
        error: 'Failed to trigger batched sync',
        details: errorMessage,
        hint: 'Check if migration 0023 has been applied to the database'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * WOOD-8: GET /api/admin/batched-sync/:sessionId/progress - Get batch progress
 */
export async function getBatchedSyncProgress(
  request: Request,
  env: Env,
  sessionId: string
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const adminStravaId = parseInt(url.searchParams.get('admin_strava_id') || '0');

    if (!adminStravaId || !(await isAdmin(adminStravaId, env))) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get sync progress from new system
    const progress = await env.DB.prepare(
      `SELECT * FROM sync_progress WHERE sync_session_id = ?`
    )
      .bind(sessionId)
      .first();

    const logs = await env.DB.prepare(
      `SELECT * FROM sync_step_logs WHERE sync_session_id = ? ORDER BY created_at ASC`
    )
      .bind(sessionId)
      .all();

    return new Response(
      JSON.stringify({
        session_id: sessionId,
        progress,
        logs: logs.results || [],
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('[WOOD-8] Error fetching batch progress:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to fetch batch progress' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * WOOD-8: Initiate discovery sync (Phase 1 of two-phase sync)
 * Creates first discovery batch to find races
 */
async function initiateDiscoverySync(
  athleteId: number,
  fullSync: boolean,
  env: Env
): Promise<string> {
  const sessionId = `discovery_${Date.now()}_${athleteId}`;
  const now = Math.floor(Date.now() / 1000);

  // Update athlete status
  await env.DB.prepare(
    `UPDATE athletes
     SET sync_status = 'in_progress',
         sync_error = NULL,
         sync_session_id = ?,
         current_batch_number = 1,
         total_batches_expected = NULL
     WHERE id = ?`
  )
    .bind(sessionId, athleteId)
    .run();

  // Create first discovery batch
  // For full sync: no after_timestamp, start from oldest
  // For incremental: use last_synced_at as after_timestamp
  const athlete = await env.DB.prepare(
    `SELECT last_synced_at FROM athletes WHERE id = ?`
  )
    .bind(athleteId)
    .first<{ last_synced_at: number | null }>();

  const afterTimestamp = fullSync ? undefined : (athlete?.last_synced_at || undefined);

  await env.DB.prepare(
    `INSERT INTO sync_batches (
      athlete_id, sync_session_id, batch_number,
      before_timestamp, after_timestamp, status, batch_type
    ) VALUES (?, ?, ?, ?, ?, 'pending', 'discovery')`
  )
    .bind(
      athleteId,
      sessionId,
      1,
      null, // Will be set during pagination
      afterTimestamp || null
    )
    .run();

  console.log(`[WOOD-8] Created discovery session ${sessionId} for athlete ${athleteId}`);

  return sessionId;
}
