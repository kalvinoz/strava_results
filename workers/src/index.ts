// Main Worker entry point

import { Env } from './types';
import { handleAuthorize, handleCallback, handleDisconnect } from './auth/oauth';
import { syncAllAthletes } from './cron/sync';
import { syncAthlete } from './queue/sync-queue';
import { processPendingBatches } from './cron/batch-processor-cron';
import { healthCheckBatchedSyncs } from './cron/sync-health-monitor';
import { getRaces, getStats, getAthletes, updateRaceTime, updateRaceDistance, updateRaceEvent, updateRaceVisibility, bulkEditRaces, fetchRaceDescription } from './api/races';
import { getAdminAthletes, updateAthlete, deleteAthlete, triggerAthleteSync, triggerSyncAll, stopAthleteSync, resetStuckSyncs, getAdminSyncLogs, checkAdmin, getAdminSyncStatus, stopSyncJob, triggerBatchedAthleteSync, getBatchedSyncProgress, getAdminApiKey } from './api/admin';
import { getReviewActivities, updateActivity } from './api/admin-review';
import { getParkrunResults, getParkrunStats, getParkrunAthletes, updateParkrunAthlete, getParkrunByDate, getParkrunWeeklySummary, getParkrunDuplicates, getParkrunMilestones } from './api/parkrun';
import { importParkrunCSV } from './api/parkrun-import';
import { importIndividualParkrunCSV } from './api/parkrun-import-individual';
import { getAthletesToScrape } from './api/parkrun-athletes-to-scrape';
import { getAthleteAuditLog, getAthleteAuditHistory, getRecentLeftClubChanges } from './api/athlete-audit';
import { getEventSuggestions, updateEventSuggestion, triggerEventAnalysis, getEventNames, getEventStats, renameEvent } from './api/events';
import { backfillPolylines } from './api/polyline-backfill';
import { handleRawResponseBackfill } from './api/raw-response-backfill';
import { extractActivities, submitActivities, getManualSubmissions, updateSubmission, approveSubmission, rejectSubmission, deleteSubmission } from './api/manual-submissions';
import { googleLogin, googleCallback, logout, getCurrentAdmin } from './api/google-auth';
import {
  queueAllAthletes,
  getQueueStats,
  cleanupOldJobs,
  cancelPendingJobs,
} from './queue/queue-processor';
import { requireApiKey } from './middleware/auth';

export default {
  /**
   * Handle HTTP requests
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
        },
      });
    }

    // Route handlers
    try {
      // Strava OAuth routes
      if (path === '/auth/authorize' && request.method === 'GET') {
        return handleAuthorize(env);
      }

      if (path === '/auth/callback' && request.method === 'GET') {
        return handleCallback(request, env, ctx);
      }

      if (path === '/auth/disconnect' && request.method === 'DELETE') {
        return handleDisconnect(request, env);
      }

      // Google OAuth routes (Admin login)
      if (path === '/auth/google/login' && request.method === 'GET') {
        return googleLogin(request, env);
      }

      if (path === '/auth/google/callback' && request.method === 'GET') {
        return googleCallback(request, env);
      }

      if (path === '/auth/logout' && request.method === 'POST') {
        return logout(request);
      }

      if (path === '/auth/me' && request.method === 'GET') {
        return getCurrentAdmin(request, env);
      }

      // API routes
      if (path === '/api/races' && request.method === 'GET') {
        return getRaces(request, env);
      }

      if (path === '/api/stats' && request.method === 'GET') {
        return getStats(env);
      }

      if (path === '/api/athletes' && request.method === 'GET') {
        return getAthletes(env);
      }

      // Update race manual time
      const raceTimeMatch = path.match(/^\/api\/races\/(\d+)\/time$/);
      if (raceTimeMatch && request.method === 'PATCH') {
        return updateRaceTime(request, env, parseInt(raceTimeMatch[1]));
      }

      // Update race manual distance
      const raceDistanceMatch = path.match(/^\/api\/races\/(\d+)\/distance$/);
      if (raceDistanceMatch && request.method === 'PATCH') {
        return updateRaceDistance(request, env, parseInt(raceDistanceMatch[1]));
      }

      // Update race event name
      const raceEventMatch = path.match(/^\/api\/races\/(\d+)\/event$/);
      if (raceEventMatch && request.method === 'PATCH') {
        return updateRaceEvent(request, env, parseInt(raceEventMatch[1]));
      }

      // Update race visibility
      const raceVisibilityMatch = path.match(/^\/api\/races\/(\d+)\/visibility$/);
      if (raceVisibilityMatch && request.method === 'PATCH') {
        return updateRaceVisibility(request, env, parseInt(raceVisibilityMatch[1]));
      }

      // Fetch race description from Strava
      const raceDescriptionMatch = path.match(/^\/api\/races\/(\d+)\/fetch-description$/);
      if (raceDescriptionMatch && request.method === 'POST') {
        return fetchRaceDescription(request, env, parseInt(raceDescriptionMatch[1]));
      }

      // Bulk edit races
      if (path === '/api/races/bulk-edit' && request.method === 'POST') {
        return bulkEditRaces(request, env);
      }

      // Admin routes
      if (path === '/api/admin/athletes' && request.method === 'GET') {
        return getAdminAthletes(request, env);
      }

      const adminAthleteMatch = path.match(/^\/api\/admin\/athletes\/(\d+)$/);
      if (adminAthleteMatch && request.method === 'PATCH') {
        return updateAthlete(request, env, parseInt(adminAthleteMatch[1]));
      }

      if (adminAthleteMatch && request.method === 'DELETE') {
        return deleteAthlete(request, env, parseInt(adminAthleteMatch[1]));
      }

      const adminSyncMatch = path.match(/^\/api\/admin\/athletes\/(\d+)\/sync$/);
      if (adminSyncMatch && request.method === 'POST') {
        return triggerAthleteSync(request, env, ctx, parseInt(adminSyncMatch[1]));
      }

      // Sync all athletes (with optional date range)
      if (path === '/api/admin/sync-all' && request.method === 'POST') {
        return triggerSyncAll(request, env, ctx);
      }

      // Stop sync
      const adminStopSyncMatch = path.match(/^\/api\/admin\/athletes\/(\d+)\/sync\/stop$/);
      if (adminStopSyncMatch && request.method === 'POST') {
        return stopAthleteSync(request, env, parseInt(adminStopSyncMatch[1]));
      }

      // WOOD-8: Trigger batched sync
      const adminBatchedSyncMatch = path.match(/^\/api\/admin\/athletes\/(\d+)\/batched-sync$/);
      if (adminBatchedSyncMatch && request.method === 'POST') {
        return triggerBatchedAthleteSync(request, env, ctx, parseInt(adminBatchedSyncMatch[1]));
      }

      // WOOD-8: Get batched sync progress
      const batchedSyncProgressMatch = path.match(/^\/api\/admin\/batched-sync\/([^\/]+)\/progress$/);
      if (batchedSyncProgressMatch && request.method === 'GET') {
        return getBatchedSyncProgress(request, env, batchedSyncProgressMatch[1]);
      }

      // Reset stuck syncs
      if (path === '/api/admin/reset-stuck-syncs' && request.method === 'POST') {
        return resetStuckSyncs(request, env);
      }

      // Get sync logs for a session
      if (path === '/api/admin/sync-logs' && request.method === 'GET') {
        return getAdminSyncLogs(request, env);
      }

      // Get sync status (queue stats)
      if (path === '/api/admin/sync-status' && request.method === 'GET') {
        return getAdminSyncStatus(request, env);
      }

      // Stop sync job
      if (path === '/api/admin/sync/stop' && request.method === 'POST') {
        return stopSyncJob(request, env);
      }

      // Check if user is admin
      if (path === '/api/admin/check' && request.method === 'GET') {
        return checkAdmin(request, env);
      }

      // Get API key (admin only)
      if (path === '/api/admin/api-key' && request.method === 'GET') {
        return getAdminApiKey(request, env);
      }

      // Review dashboard - Get unassigned activities
      if (path === '/api/admin/review' && request.method === 'GET') {
        return getReviewActivities(request, env);
      }

      // Update activity (distance, time, visibility, event)
      const adminActivityMatch = path.match(/^\/api\/admin\/activities\/(\d+)$/);
      if (adminActivityMatch && request.method === 'PATCH') {
        return updateActivity(request, env, parseInt(adminActivityMatch[1]));
      }

      // Manual sync trigger (for testing)
      if (path === '/api/sync' && request.method === 'POST') {
        // In production, you'd want to authenticate this endpoint
        await syncAllAthletes(env);
        return new Response(
          JSON.stringify({ message: 'Sync triggered successfully' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      // Sync routes that accept Strava ID (used by API dashboard)
      // These routes bypass the admin_strava_id check for convenience
      const syncAthleteByStravaIdMatch = path.match(/^\/api\/sync\/athlete\/(\d+)$/);
      if (syncAthleteByStravaIdMatch && request.method === 'POST') {
        const stravaId = parseInt(syncAthleteByStravaIdMatch[1]);

        // Get athlete database ID from Strava ID
        const athlete = await env.DB.prepare(
          'SELECT id, strava_id FROM athletes WHERE strava_id = ?'
        )
          .bind(stravaId)
          .first<{ id: number; strava_id: number }>();

        if (!athlete) {
          return new Response(
            JSON.stringify({ error: 'Athlete not found' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Check if already syncing
        const currentStatus = await env.DB.prepare(
          'SELECT sync_status FROM athletes WHERE id = ?'
        )
          .bind(athlete.id)
          .first<{ sync_status: string }>();

        // If already in_progress, cancel it by resetting to completed first
        if (currentStatus?.sync_status === 'in_progress') {
          console.log(`Athlete ${athlete.strava_id} already syncing - cancelling previous sync`);
          await env.DB.prepare(
            "UPDATE athletes SET sync_status = 'completed', sync_error = 'Cancelled by user' WHERE id = ?"
          )
            .bind(athlete.id)
            .run();
        }

        // Generate unique session ID for tracking this sync
        const sessionId = `sync-${athlete.id}-${Date.now()}`;

        // Update status to in_progress for the new sync
        await env.DB.prepare(
          "UPDATE athletes SET sync_status = 'in_progress', sync_error = NULL WHERE id = ?"
        )
          .bind(athlete.id)
          .run();

        // Trigger FULL sync in background
        ctx.waitUntil(
          (async () => {
            try {
              console.log(`API triggering FULL REFRESH for athlete ${athlete.strava_id} (ID: ${athlete.id}, session: ${sessionId})`);
              await syncAthlete(athlete.strava_id, env, false, true, ctx, undefined, sessionId);
              console.log(`API sync completed successfully for athlete ${athlete.strava_id}`);
            } catch (error) {
              console.error(`API sync failed for athlete ${athlete.strava_id}:`, error);
              try {
                await env.DB.prepare(
                  "UPDATE athletes SET sync_status = 'error', sync_error = ? WHERE id = ?"
                )
                  .bind(error instanceof Error ? error.message : String(error), athlete.id)
                  .run();
              } catch (dbError) {
                console.error(`Failed to update error status for athlete ${athlete.id}:`, dbError);
              }
            }
          })()
        );

        return new Response(
          JSON.stringify({ success: true, message: 'Sync triggered', session_id: sessionId }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          }
        );
      }

      const stopSyncByStravaIdMatch = path.match(/^\/api\/sync\/stop\/(\d+)$/);
      if (stopSyncByStravaIdMatch && request.method === 'POST') {
        const stravaId = parseInt(stopSyncByStravaIdMatch[1]);

        // Get athlete database ID from Strava ID
        const athlete = await env.DB.prepare(
          'SELECT id, sync_status FROM athletes WHERE strava_id = ?'
        )
          .bind(stravaId)
          .first<{ id: number; sync_status: string }>();

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
          "UPDATE athletes SET sync_status = 'completed', sync_error = 'Stopped by user' WHERE id = ?"
        )
          .bind(athlete.id)
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
      }

      const resetStuckSyncsMatch = path.match(/^\/api\/sync\/reset-stuck$/);
      if (resetStuckSyncsMatch && request.method === 'POST') {
        try {
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

      // Parkrun API routes
      if (path === '/api/parkrun' && request.method === 'GET') {
        return getParkrunResults(request, env);
      }

      if (path === '/api/parkrun/stats' && request.method === 'GET') {
        return getParkrunStats(request, env);
      }

      if (path === '/api/parkrun/by-date' && request.method === 'GET') {
        return getParkrunByDate(request, env);
      }

      if (path === '/api/parkrun/weekly-summary' && request.method === 'GET') {
        return getParkrunWeeklySummary(request, env);
      }

      if (path === '/api/parkrun/import' && request.method === 'POST') {
        const authError = await requireApiKey(request, env);
        if (authError) return authError;
        return importParkrunCSV(request, env);
      }

      if (path === '/api/parkrun/import-individual' && request.method === 'POST') {
        const authError = await requireApiKey(request, env);
        if (authError) return authError;
        return importIndividualParkrunCSV(request, env);
      }

      if (path === '/api/parkrun/athletes-to-scrape' && request.method === 'GET') {
        const authError = await requireApiKey(request, env);
        if (authError) return authError;
        return getAthletesToScrape(request, env);
      }

      if (path === '/api/parkrun/athletes' && request.method === 'GET') {
        return getParkrunAthletes(request, env);
      }

      if (path === '/api/parkrun/duplicates' && request.method === 'GET') {
        return getParkrunDuplicates(request, env);
      }

      if (path === '/api/parkrun/milestones' && request.method === 'GET') {
        return getParkrunMilestones(request, env);
      }

      // Update parkrun athlete visibility
      const parkrunAthleteMatch = path.match(/^\/api\/parkrun\/athletes\/(.+)$/);
      if (parkrunAthleteMatch && request.method === 'PATCH') {
        const athleteName = decodeURIComponent(parkrunAthleteMatch[1]);
        return updateParkrunAthlete(request, env, athleteName);
      }

      // Audit log routes
      if (path === '/api/audit/athletes' && request.method === 'GET') {
        return getAthleteAuditLog(request, env);
      }

      if (path === '/api/audit/recent-left-club' && request.method === 'GET') {
        return getRecentLeftClubChanges(request, env);
      }

      const auditAthleteMatch = path.match(/^\/api\/audit\/athletes\/(.+)$/);
      if (auditAthleteMatch && request.method === 'GET') {
        const athleteIdentifier = decodeURIComponent(auditAthleteMatch[1]);
        return getAthleteAuditHistory(request, env, athleteIdentifier);
      }

      // Event routes
      if (path === '/api/events/names' && request.method === 'GET') {
        return getEventNames(request, env);
      }

      if (path === '/api/events/stats' && request.method === 'GET') {
        return getEventStats(request, env);
      }

      if (path === '/api/events/rename' && request.method === 'POST') {
        return renameEvent(request, env);
      }

      // Event suggestion routes
      if (path === '/api/event-suggestions' && request.method === 'GET') {
        return getEventSuggestions(request, env);
      }

      const eventSuggestionMatch = path.match(/^\/api\/event-suggestions\/(\d+)$/);
      if (eventSuggestionMatch && request.method === 'PATCH') {
        return updateEventSuggestion(request, env, parseInt(eventSuggestionMatch[1]));
      }

      if (path === '/api/event-suggestions/analyze' && request.method === 'POST') {
        return triggerEventAnalysis(request, env, ctx);
      }

      // Polyline backfill route
      if (path === '/api/polyline/backfill' && request.method === 'POST') {
        return backfillPolylines(request, env);
      }

      // WOOD-6: Raw response backfill route
      if (path === '/api/backfill/raw-responses' && request.method === 'POST') {
        return handleRawResponseBackfill(request, env);
      }

      // Manual submissions API routes
      if (path === '/api/manual-submissions/extract' && request.method === 'POST') {
        return extractActivities(request, env);
      }

      if (path === '/api/manual-submissions/submit' && request.method === 'POST') {
        return submitActivities(request, env);
      }

      if (path === '/api/admin/manual-submissions' && request.method === 'GET') {
        return getManualSubmissions(request, env);
      }

      const submissionUpdateMatch = path.match(/^\/api\/admin\/manual-submissions\/(\d+)$/);
      if (submissionUpdateMatch && request.method === 'PATCH') {
        return updateSubmission(request, env, parseInt(submissionUpdateMatch[1]));
      }

      const approveMatch = path.match(/^\/api\/admin\/manual-submissions\/(\d+)\/approve$/);
      if (approveMatch && request.method === 'POST') {
        return approveSubmission(request, env, parseInt(approveMatch[1]));
      }

      const rejectMatch = path.match(/^\/api\/admin\/manual-submissions\/(\d+)\/reject$/);
      if (rejectMatch && request.method === 'POST') {
        return rejectSubmission(request, env, parseInt(rejectMatch[1]));
      }

      const deleteMatch = path.match(/^\/api\/admin\/manual-submissions\/(\d+)\/delete$/);
      if (deleteMatch && request.method === 'DELETE') {
        return deleteSubmission(request, env, parseInt(deleteMatch[1]));
      }

      // Queue management API routes
      // Get queue statistics
      if (path === '/api/queue/stats' && request.method === 'GET') {
        const stats = await getQueueStats(env);
        return new Response(JSON.stringify(stats), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Queue all athletes for sync
      if (path === '/api/queue/all' && request.method === 'POST') {
        const body = await request.json() as { jobType?: 'full_sync' | 'incremental_sync'; priority?: number };
        const jobIds = await queueAllAthletes(env, body.jobType || 'full_sync', body.priority || 0);
        return new Response(JSON.stringify({
          message: `Queued ${jobIds.length} athletes`,
          jobIds,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Queue specific athlete for sync is now handled by triggerAthleteSync in admin.ts

      // Clean up old jobs
      if (path === '/api/queue/cleanup' && request.method === 'POST') {
        const deleted = await cleanupOldJobs(env);
        return new Response(JSON.stringify({
          message: `Cleaned up ${deleted} old jobs`,
          deleted,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Cancel pending jobs
      if (path === '/api/queue/cancel' && request.method === 'POST') {
        const body = await request.json() as { jobIds?: number[] };
        const deleted = await cancelPendingJobs(env, body.jobIds);
        return new Response(JSON.stringify({
          message: body.jobIds
            ? `Cancelled ${deleted} specific pending job(s)`
            : `Cancelled ${deleted} pending job(s)`,
          deleted,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Internal sync endpoint (triggered by triggerAthleteSync via fetch)
      const internalSyncMatch = path.match(/^\/internal\/sync\/(\d+)$/);
      if (internalSyncMatch && request.method === 'POST') {
        const stravaId = parseInt(internalSyncMatch[1]);

        try {
          const body = await request.json() as {
            session_id: string;
            after_date?: string;
            before_date?: string;
          };

          // Get athlete
          const athlete = await env.DB.prepare(
            'SELECT * FROM athletes WHERE strava_id = ?'
          )
            .bind(stravaId)
            .first<any>();

          if (!athlete) {
            console.error(`[Internal Sync] Athlete ${stravaId} not found`);
            return new Response(
              JSON.stringify({ error: 'Athlete not found' }),
              { status: 404, headers: { 'Content-Type': 'application/json' } }
            );
          }

          console.log(`[Internal Sync] Starting sync for athlete ${stravaId} (session: ${body.session_id})`);

          // Import and run sync (this will run synchronously in this Worker invocation)
          const { syncAthlete: syncAthleteNew } = await import('./sync/rotation-sync');

          // Execute sync immediately (not in waitUntil) with existing session ID
          await syncAthleteNew(env, athlete, 'manual', {
            afterDate: body.after_date,
            beforeDate: body.before_date,
            sessionId: body.session_id,
          });

          console.log(`[Internal Sync] Completed sync for athlete ${stravaId}`);

          return new Response(
            JSON.stringify({ success: true }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        } catch (error) {
          console.error(`[Internal Sync] Error syncing athlete ${stravaId}:`, error);
          return new Response(
            JSON.stringify({ error: 'Sync failed' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }

      // Health check
      if (path === '/health') {
        return new Response(JSON.stringify({ status: 'healthy' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 404 for unknown routes
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Request handler error:', error);
      return new Response(
        JSON.stringify({
          error: 'Internal server error',
          details: error instanceof Error ? error.message : 'Unknown error',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  },

  /**
   * Handle scheduled cron triggers
   * Two cron schedules:
   * 1. Every hour - Daily rotation sync (one athlete per hour)
   * 2. Every minute - Process sync queue + batches + health check
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('Cron trigger fired:', event.cron, new Date(event.scheduledTime).toISOString());

    try {
      // Determine which cron triggered this
      if (event.cron === '0 * * * *') {
        // Every hour: Process next athlete in daily rotation
        console.log('[DailyRotation] Processing next athlete in rotation...');
        const processed = await syncAllAthletes(env);
        if (processed) {
          console.log('[DailyRotation] Successfully queued next athlete');
        } else {
          console.log('[DailyRotation] No athletes due for sync or already syncing');
        }

        // Clean up old completed jobs (once per day at midnight)
        const hour = new Date(event.scheduledTime).getUTCHours();
        if (hour === 0) {
          const deleted = await cleanupOldJobs(env);
          console.log(`[DailyRotation] Cleaned up ${deleted} old queue jobs`);
        }

      } else if (event.cron === '* * * * *') {
        // Every minute: Process sync queue + batches + health check
        console.log('[QueueProcessor] Processing sync queue...');
        const { processQueuedSyncs } = await import('./cron/queue-processor');
        await processQueuedSyncs(env);

        console.log('[WOOD-8] Batch processor cron: Processing pending batches...');
        await processPendingBatches(env, ctx);

        // Run health check every minute to fix stalled syncs
        console.log('[WOOD-8] Running health check...');
        await healthCheckBatchedSyncs(env);

      } else {
        console.warn('Unknown cron schedule:', event.cron);
      }
    } catch (error) {
      console.error('Scheduled job failed:', error);
      // Error is already logged in the respective functions
    }
  },
};
