# Cloudflare Workers Execution Reliability - Lessons Learned

## Critical Finding: Background Task Execution is Unreliable

### Problem
When triggering background tasks in Cloudflare Workers, both `ctx.waitUntil()` and fire-and-forget `fetch()` calls are **UNRELIABLE** for critical operations.

### What We Tried (All Failed)

#### ❌ Attempt 1: `ctx.waitUntil()` with Direct Sync Call
```typescript
ctx.waitUntil(syncAthlete(env, athlete, 'manual'));
```
**Result**: Syncs got stuck at "queued" step. Worker terminated before background task started.

#### ❌ Attempt 2: `ctx.waitUntil()` with Internal Fetch
```typescript
ctx.waitUntil(
  fetch('/internal/sync/123', { method: 'POST', body: ... })
    .catch(error => console.error(error))
);
```
**Result**: Same issue. Internal fetch never executed. Worker terminated before fetch fired.

#### ❌ Attempt 3: Fire-and-Forget Fetch (No `ctx.waitUntil()`)
```typescript
fetch('/internal/sync/123', { method: 'POST', body: ... })
  .catch(error => console.error(error));
```
**Result**: Still unreliable. Fetch may or may not execute depending on Worker lifetime.

### Evidence of Failure
- Sync session created in database with status='running'
- Zero sync_step_logs entries (sync never started)
- Athlete stuck at 'queued' step for hours
- No Worker logs indicating internal endpoint was hit

### Why This Happens
Cloudflare Workers have unpredictable lifetimes:
1. Admin endpoint creates sync session in DB
2. Admin endpoint fires internal fetch (background)
3. Admin endpoint returns 200 OK immediately
4. **Worker may terminate before internal fetch executes**
5. Internal fetch never happens → sync stuck forever

## ✅ Working Solution: Cloudflare Queues

For reliable background task execution in Cloudflare Workers, use **Cloudflare Queues**:

### Architecture
```typescript
// Admin endpoint (trigger)
export async function triggerAthleteSync(...) {
  // 1. Create sync_progress record
  await env.DB.prepare(
    `INSERT INTO sync_progress (athlete_id, sync_session_id, ...) VALUES (...)`
  ).run();

  // 2. Send message to queue (guaranteed delivery)
  await env.SYNC_QUEUE.send({
    type: 'manual_sync',
    athlete_id: athlete.id,
    strava_id: athlete.strava_id,
    session_id: sessionId,
    after_date: body.after_date,
    before_date: body.before_date,
  });

  // 3. Return immediately
  return new Response(JSON.stringify({ success: true }));
}

// Queue consumer (separate Worker invocation)
export default {
  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const { athlete_id, session_id, ... } = message.body;

      // Get athlete from DB
      const athlete = await env.DB.prepare('SELECT * FROM athletes WHERE id = ?')
        .bind(athlete_id)
        .first();

      // Execute sync (guaranteed to run in dedicated Worker invocation)
      await syncAthlete(env, athlete, 'manual', {
        sessionId: session_id,
        afterDate: message.body.after_date,
        beforeDate: message.body.before_date,
      });

      message.ack(); // Acknowledge successful processing
    }
  }
}
```

### Benefits of Queues
- **Guaranteed execution**: Message persists until successfully processed
- **Automatic retries**: If consumer fails, message is retried
- **Separate Worker invocation**: Consumer runs in dedicated context with full CPU time
- **Dead letter queue**: Failed messages can be sent to DLQ for investigation
- **At-least-once delivery**: Message won't be lost even if Worker crashes

### Implementation Steps
1. Add Queue binding to `wrangler.toml`:
   ```toml
   [[queues.producers]]
   queue = "sync-queue"
   binding = "SYNC_QUEUE"

   [[queues.consumers]]
   queue = "sync-queue"
   max_batch_size = 1
   max_batch_timeout = 30
   ```

2. Update `triggerAthleteSync()` to send queue message instead of fetch
3. Add queue consumer handler to Worker
4. Remove internal sync endpoint (no longer needed)

## Current Status
❌ **Manual syncs are broken** - using unreliable fire-and-forget fetch pattern
⚠️ **Need to migrate to Queues** for production reliability

## Other Execution Patterns (For Reference)

### ✅ Synchronous Execution (Reliable)
When the operation MUST complete before response:
```typescript
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  // This WILL complete before response is sent
  await env.DB.prepare('INSERT INTO ...').run();
  await someExternalAPI();

  return new Response('Done');
}
```
**Downside**: Request waits for entire operation (may timeout for long operations)

### ✅ Cron Triggers (Reliable)
Scheduled tasks run in dedicated Worker invocations:
```typescript
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // This runs reliably on schedule
    await processNextAthlete(env);
  }
}
```
**Note**: Our automatic sync rotation uses this and works reliably.

## ✅ Working Solution: Database-Backed Queue (Implemented)

Since Cloudflare Queues are not available, we implement a reliable queue using D1 database + cron jobs.

### Architecture

#### 1. Queue Table Schema
```sql
CREATE TABLE sync_queue (
    id INTEGER PRIMARY KEY,
    athlete_id INTEGER NOT NULL,
    strava_id INTEGER NOT NULL,
    sync_session_id TEXT NOT NULL UNIQUE,
    sync_type TEXT NOT NULL DEFAULT 'manual',
    after_date TEXT, -- optional date range
    before_date TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER
);
```

#### 2. Admin Endpoint (Enqueue)
```typescript
export async function triggerAthleteSync(...) {
  // 1. Create sync_progress record (for dashboard visibility)
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO sync_progress (athlete_id, sync_session_id, status, ...)
     VALUES (?, ?, 'running', ...)`
  ).run();

  // 2. Add job to queue (guaranteed persistence)
  await env.DB.prepare(
    `INSERT INTO sync_queue (
      athlete_id, strava_id, sync_session_id, sync_type,
      after_date, before_date, status
    ) VALUES (?, ?, ?, 'manual', ?, ?, 'pending')`
  ).bind(athlete.id, athlete.strava_id, sessionId, after_date, before_date).run();

  // 3. Return immediately (job is now persisted and will be processed)
  return new Response(JSON.stringify({
    success: true,
    message: 'Sync queued',
    session_id: sessionId
  }));
}
```

#### 3. Queue Processor (Cron Job - Every Minute)
```typescript
// New cron trigger: * * * * * (every minute)
export async function processQueuedSyncs(env: Env): Promise<void> {
  // Find oldest pending job (FIFO)
  const job = await env.DB.prepare(
    `SELECT * FROM sync_queue
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT 1`
  ).first();

  if (!job) {
    return; // No pending jobs
  }

  // Check if max attempts reached
  if (job.attempts >= job.max_attempts) {
    await markJobFailed(env, job.id, 'Max retry attempts reached');
    return;
  }

  // Mark as processing
  await env.DB.prepare(
    `UPDATE sync_queue
     SET status = 'processing',
         attempts = attempts + 1,
         started_at = strftime('%s', 'now')
     WHERE id = ?`
  ).bind(job.id).run();

  try {
    // Get athlete
    const athlete = await env.DB.prepare(
      'SELECT * FROM athletes WHERE id = ?'
    ).bind(job.athlete_id).first();

    if (!athlete) {
      throw new Error(`Athlete ${job.athlete_id} not found`);
    }

    // Execute sync (this runs synchronously in dedicated cron Worker)
    await syncAthlete(env, athlete, job.sync_type, {
      sessionId: job.sync_session_id,
      afterDate: job.after_date,
      beforeDate: job.before_date,
    });

    // Mark as completed
    await env.DB.prepare(
      `UPDATE sync_queue
       SET status = 'completed',
           completed_at = strftime('%s', 'now')
       WHERE id = ?`
    ).bind(job.id).run();

  } catch (error) {
    // Mark as pending for retry (or failed if max attempts reached)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (job.attempts + 1 >= job.max_attempts) {
      await markJobFailed(env, job.id, errorMessage);

      // Also mark sync_progress as error
      await env.DB.prepare(
        `UPDATE sync_progress
         SET status = 'error',
             error_message = ?,
             completed_at = strftime('%s', 'now')
         WHERE sync_session_id = ?`
      ).bind(errorMessage, job.sync_session_id).run();

    } else {
      // Reset to pending for retry
      await env.DB.prepare(
        `UPDATE sync_queue
         SET status = 'pending',
             last_error = ?
         WHERE id = ?`
      ).bind(errorMessage, job.id).run();
    }
  }
}
```

#### 4. Cron Schedule (wrangler.toml)
```toml
# Existing rotation sync (every 2 minutes)
[[triggers.crons]]
cron = "*/2 * * * *"

# NEW: Queue processor (every minute)
[[triggers.crons]]
cron = "* * * * *"
```

### Why This Works

✅ **Guaranteed execution**: Job persisted to database before response returns
✅ **Automatic retries**: Failed jobs remain in queue for retry (up to max_attempts)
✅ **Dedicated Worker context**: Cron job runs sync in separate Worker invocation
✅ **FIFO ordering**: Oldest pending job processed first
✅ **No race conditions**: Only one job processed per cron invocation
✅ **Failure tracking**: `last_error` column tracks retry errors
✅ **Dashboard visibility**: `sync_progress` table keeps dashboard updated

### Cron Job Selection Logic
```typescript
export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === '*/2 * * * *') {
      // Rotation-based automatic syncs
      await syncAllAthletes(env);
    } else if (event.cron === '* * * * *') {
      // Queue processor for manual syncs
      await processQueuedSyncs(env);
    }
  }
}
```

### Benefits Over Previous Attempts
1. **No ctx.waitUntil()** - Job persisted before any async work
2. **No fire-and-forget fetch** - Cron job guarantees execution
3. **Retry logic** - Failed jobs automatically retried
4. **Monitoring** - Queue status visible in database
5. **Backpressure** - Only one job processed at a time (no overload)

## Action Items
- [x] Create sync_queue table migration
- [x] Document database-backed queue architecture
- [ ] Implement queue processor cron job
- [ ] Update triggerAthleteSync to enqueue instead of fetch
- [ ] Add queue status endpoint for admin dashboard
- [ ] Test manual sync reliability
- [ ] Remove internal sync endpoint after testing
- [ ] Consider using queue for new user initial sync in OAuth callback

## References
- Cloudflare Queues docs: https://developers.cloudflare.com/queues/
- Workers execution model: https://developers.cloudflare.com/workers/runtime-apis/handlers/

## Implementation Status

### ✅ Completed (2025-11-25)
- [x] Create sync_queue table migration (0031_add_sync_queue.sql)
- [x] Document database-backed queue architecture
- [x] Implement queue processor cron job (cron/queue-processor.ts)
- [x] Update triggerAthleteSync to enqueue instead of fetch (admin.ts:363-376)
- [x] Integrate queue processor into every-minute cron (index.ts:684-686)
- [x] Deploy to production (Worker version: 75f04749)

### 🔄 Next Steps
- [ ] Test manual sync reliability (trigger sync and verify it executes within 1 minute)
- [ ] Add queue status endpoint for admin dashboard (GET /api/admin/queue-status)
- [ ] Remove internal sync endpoint after confirming queue works (/internal/sync/:stravaId)
- [ ] Consider using queue for new user initial sync in OAuth callback
- [ ] Add monitoring/alerting for stuck queue jobs

### 📊 How to Verify It's Working

1. **Trigger a manual sync** via Admin Dashboard
2. **Check sync_queue table**:
   ```sql
   SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY created_at DESC LIMIT 5;
   ```
3. **Wait up to 1 minute** for cron job to process
4. **Check Worker logs**:
   ```bash
   npx wrangler tail --format pretty
   ```
   Look for: `[QueueProcessor] Found pending job`
5. **Verify sync started** in Sync Dashboard (should show progress)
6. **Check queue job completed**:
   ```sql
   SELECT * FROM sync_queue WHERE sync_session_id = 'your-session-id';
   ```
   Status should change: `pending` → `processing` → `completed`

## ❌ Problem: "Too Many Subrequests" for Athletes with Many Activities

### Issue Discovered (2025-11-25)
Sync `d50a5cfc-ca5b-487a-9f21-5c4433e59bca` for athlete Nelson Santos (strava_id: 2132829) failed with:
```
Error: Too many subrequests.
```

**Root Cause:**
- Nelson has **3200 total activities**
- Likely has 50+ races in history
- `fetchRaceDetails()` fetches each race individually: `for (const race of races) { await fetch(...) }`
- **Cloudflare Workers limit: 50 subrequests per request**
- If athlete has >50 new races, sync fails

### Why This Happens
1. Initial activity fetch: ~16 pages × 200 activities = 16 subrequests ✅ (under limit)
2. Filter to races: May find 50+ races
3. **Fetch detailed data for each race**: 50+ subrequests ❌ **EXCEEDS LIMIT**
4. Worker throws "Too many subrequests" error

### Failed Approaches
- ❌ Fetching all race details in single Worker invocation
- ❌ No chunking/batching of race detail fetches

## ✅ Solution: Chunked Sync Processing

### Architecture

#### 1. Detect Large Syncs
When `newRaces.length > 45` (safe margin under 50 limit):
- Don't fetch race details immediately
- Instead, split into chunks and queue each chunk

#### 2. Chunk Strategy
```typescript
const MAX_RACES_PER_CHUNK = 40; // Safe limit (leaves room for other subrequests)

if (newRaces.length > 45) {
  // Split into chunks
  for (let i = 0; i < newRaces.length; i += MAX_RACES_PER_CHUNK) {
    const chunk = newRaces.slice(i, i + MAX_RACES_PER_CHUNK);
    const chunkIndex = Math.floor(i / MAX_RACES_PER_CHUNK);
    
    // Create continuation job in queue
    await env.DB.prepare(
      `INSERT INTO sync_queue (
        athlete_id, strava_id, sync_session_id, sync_type,
        status, chunk_index, total_chunks, race_ids
      ) VALUES (?, ?, ?, 'chunked_detail_fetch', 'pending', ?, ?, ?)`
    ).bind(
      athlete.id,
      athlete.strava_id,
      sessionId,
      chunkIndex,
      Math.ceil(newRaces.length / MAX_RACES_PER_CHUNK),
      JSON.stringify(chunk.map(r => r.id))
    ).run();
  }
  
  // Mark main sync as partially complete
  return { chunked: true, chunks: Math.ceil(newRaces.length / MAX_RACES_PER_CHUNK) };
}
```

#### 3. Chunk Processor
Queue processor detects `sync_type = 'chunked_detail_fetch'`:
```typescript
if (job.sync_type === 'chunked_detail_fetch') {
  const raceIds = JSON.parse(job.race_ids);
  
  // Fetch details for this chunk only
  const detailedActivities = await fetchRaceDetailsBatch(env, athlete, raceIds);
  
  // Save races from this chunk
  await saveRaces(env, athlete, sessionId, raceIds, detailedActivities);
  
  // Mark chunk complete
  await markChunkComplete(env, job.id);
  
  // Check if all chunks are done
  const remainingChunks = await countRemainingChunks(env, sessionId);
  if (remainingChunks === 0) {
    // All chunks processed - mark main sync complete
    await finalizeSyncAfterChunks(env, athlete, sessionId);
  }
}
```

### Benefits
✅ **No subrequest limit**: Each chunk processes ≤40 races (well under 50 limit)
✅ **Automatic retry**: Failed chunks retry independently
✅ **Progress tracking**: Dashboard shows chunk progress
✅ **Scalable**: Works for athletes with 1000+ races

### Database Schema Update
```sql
-- Add chunking support to sync_queue
ALTER TABLE sync_queue ADD COLUMN chunk_index INTEGER;
ALTER TABLE sync_queue ADD COLUMN total_chunks INTEGER;
ALTER TABLE sync_queue ADD COLUMN race_ids TEXT; -- JSON array of activity IDs
ALTER TABLE sync_queue ADD COLUMN parent_session_id TEXT; -- Links chunks to main sync
```

### Implementation Status
- [ ] Add chunking columns to sync_queue table
- [ ] Implement chunk detection in rotation-sync.ts
- [ ] Implement chunk processor in queue-processor.ts
- [ ] Update dashboard to show chunked sync progress
- [ ] Test with Nelson Santos (3200 activities)


### ✅ Implementation Complete (2025-11-25)
- [x] Add chunking columns to sync_queue table (migration 0033)
- [x] Implement chunk detection in rotation-sync.ts (lines 547-604)
- [x] Implement chunk processor in queue-processor.ts (lines 169-236)
- [x] Deploy to production (Worker version: c7248976)
- [ ] Update dashboard to show chunked sync progress
- [ ] Test with Nelson Santos (strava_id: 2132829, 3200 activities)

### How It Works Now
1. **Sync starts normally**: Fetches all activities, filters to runs/races
2. **Chunk detection**: If `newRaces.length > 45`, splits into chunks of 40 races each
3. **Queue chunks**: Creates separate `chunked_detail_fetch` jobs for each chunk
4. **Chunk processing**: Queue processor fetches details for 40 races at a time (well under 50 limit)
5. **Finalization**: When last chunk completes, marks parent sync as complete

### Next Test
Trigger manual sync for Nelson Santos to verify chunking works with 3200+ activities.

## ❌ Problem: Orphaned sync_progress Records Showing as "Running" (2025-11-27)

### Issue Discovered (2025-11-27)
Dashboard showed 6 syncs stuck in "running" status for 20+ hours, but:
- No corresponding `sync_queue` entries (jobs were never queued or deleted)
- sync_progress records were stuck in status='running', current_step='fetching_activities'
- Created on 2025-11-26 06:25 (stuck for ~20 hours)

**Root Cause:**
- **Two queue systems were running simultaneously**:
  - OLD: `queue/queue-processor.ts` with cron `*/2 * * * *` (every 2 minutes)
  - NEW: `cron/queue-processor.ts` with cron `* * * * *` (every minute)
- Both tried to use the same `sync_queue` table but with **different schemas**
- Production database used the NEW schema (with `sync_type`, `attempts`, `max_attempts`)
- The OLD system would fail to work with the new schema
- Some syncs created `sync_progress` records but never created corresponding `sync_queue` entries
- Health monitor only checked for "enrich_*" sessions, not regular sync sessions

### Why Dashboard Showed Syncs as "Running"
1. `sync_progress` table had 6 records with status='running' (created yesterday)
2. No corresponding `sync_queue` entries existed (never queued or deleted)
3. Health monitor (`sync-health-monitor.ts`) only checked for sessions starting with "enrich_*"
4. Regular sync sessions were orphaned with no cleanup mechanism

## ✅ Solution: Orphaned Record Cleanup + Remove Duplicate Queue System

### Immediate Fix (2025-11-27)
1. **Manual cleanup**: Marked 6 orphaned sync_progress records as 'error' with explanatory message
   ```sql
   UPDATE sync_progress
   SET status = 'error',
       error_message = 'Orphaned sync - no corresponding queue entry found',
       completed_at = strftime('%s', 'now')
   WHERE status = 'running'
     AND started_at < (strftime('%s', 'now') - 3600)
     AND sync_session_id NOT IN (
       SELECT sync_session_id FROM sync_queue
       WHERE status IN ('pending', 'processing')
     )
   ```
   **Result**: Fixed 6 orphaned records immediately

2. **Updated health monitor** (`sync-health-monitor.ts`):
   - Added `cleanupOrphanedSyncProgress()` function
   - Automatically detects sync_progress records stuck in 'running' for >1 hour with no queue entry
   - Marks them as 'error' with explanatory message
   - Logs details (athlete name, time stuck, step)
   - Runs every minute as part of health check

3. **Removed duplicate queue system**:
   - Removed OLD cron trigger `*/2 * * * *` from `wrangler.toml`
   - Removed call to `processNextQueuedJob` from `index.ts`
   - Removed `createSyncJob` import and usage
   - Updated cron comments to reflect only 2 schedules:
     - `0 2 * * 1`: Weekly queue all athletes (Monday 2 AM UTC)
     - `* * * * *`: Process sync queue + batches + health check (every minute)

4. **Fixed TypeScript types**:
   - Added missing fields to `Athlete` interface: `total_activities_count`, `race_count`, `current_batch_number`, `total_batches_expected`, `sync_session_id`
   - Simplified `processChunkedDetailFetch()` to throw error (deprecated functionality)

### Benefits
✅ **Automatic orphan detection**: Health monitor finds and fixes stuck syncs every minute
✅ **Single queue system**: No conflicts between OLD and NEW queue processors
✅ **Clean cron setup**: Only 2 cron schedules, clearly documented
✅ **Dashboard accuracy**: No more false "running" statuses

### Deployed (2025-11-27)
- Worker Version: `66351a2a-745f-4d09-ae47-c5ce9ceca6ea`
- Health monitor now runs every minute
- Orphaned sync cleanup is automatic
- Old queue system fully removed

## ❌ Problem: "Sync All Athletes" Only Syncing One Athlete (2025-11-27)

### Issue Discovered (2025-11-27)
When clicking "Sync All Athletes" button in admin dashboard, only one athlete (Pedro) was being synced instead of all athletes.

**Root Cause:**
- `triggerSyncAll()` function in `admin.ts` was using the OLD unreliable pattern:
  - Used `ctx.waitUntil()` with direct `syncAthlete()` calls
  - This is the exact pattern documented as unreliable in the notes above
  - Worker terminates before background tasks complete
  - Only the first athlete gets synced, rest are lost

### ✅ Solution: Use Queue System for Sync All (2025-11-27)

**Fix Applied:**
- Rewrote `triggerSyncAll()` to use the reliable queue system
- Instead of `ctx.waitUntil()`, now creates `sync_queue` entries for each athlete
- Checks for existing queue entries to avoid duplicates
- Returns immediately with queue status

**Before (Unreliable):**
```typescript
ctx.waitUntil(
  (async () => {
    for (const athlete of athletes.results) {
      await syncAthleteNew(env, athlete, 'manual', {...}); // Lost when worker terminates
    }
  })()
);
```

**After (Reliable):**
```typescript
for (const athlete of athletes.results) {
  // Check if already queued
  const existingJob = await env.DB.prepare(
    `SELECT id FROM sync_queue WHERE athlete_id = ? AND status IN ('pending', 'processing')`
  ).bind(athlete.id).first();

  if (existingJob) continue;

  // Queue for sync
  await env.DB.prepare(
    `INSERT INTO sync_queue (...) VALUES (...)`
  ).bind(...).run();
}
```

### Benefits
✅ **Guaranteed execution**: All athletes queued to database before response returns
✅ **No data loss**: Queue persists even if worker terminates
✅ **Automatic processing**: Every-minute cron processes queue entries
✅ **No duplicates**: Checks for existing queue entries before adding
✅ **Progress tracking**: Each athlete gets a unique session ID

### Deployed (2025-11-27)
- Worker Version: `cb87a912-85ab-4ab9-9d58-aad0bbf2a06d`
- "Sync All Athletes" now queues all athletes reliably
- Removed unreliable `syncAthleteNew` import from admin.ts

## ❌ Problem: Missing sync_progress Records for Queued Syncs (2025-11-27)

### Issue Discovered (2025-11-27)
Sync session `104f390b-e263-4f9c-8ca6-630355895282` was stuck in "queued" status with no progress because:
- sync_progress record existed (status='running', step='queued')
- NO sync_queue entry existed (orphaned record)
- Created from "Sync All Athletes" action

**Root Cause:**
Logic error in `syncAthlete()` function in `rotation-sync.ts`:
```typescript
// OLD BUGGY CODE:
if (!options?.sessionId) {
  // Only create sync_progress if sessionId was NOT provided
  await env.DB.prepare(`INSERT INTO sync_progress ...`);
}
```

This caused different behavior for different entry points:

| Entry Point | Creates sync_progress? | Creates sync_queue? | Passes sessionId? | Result |
|-------------|------------------------|---------------------|-------------------|---------|
| `triggerAthleteSync` (single) | ✅ Yes (in admin.ts) | ✅ Yes | ✅ Yes | Works - sync_progress exists |
| `triggerSyncAll` (bulk) | ❌ No | ✅ Yes | ✅ Yes | **BROKEN** - no sync_progress created |

When `triggerSyncAll` queued athletes:
1. Created sync_queue entry with sessionId
2. Did NOT create sync_progress (relies on syncAthlete to do it)
3. Queue processor called `syncAthlete(env, athlete, 'manual', {sessionId})`
4. Because sessionId was provided, the `if (!options?.sessionId)` check FAILED
5. No sync_progress record was ever created
6. Dashboard showed nothing (no progress to display)

### ✅ Solution: Always Create sync_progress if Missing (2025-11-27)

**Fix Applied:**
Changed `syncAthlete()` to always check if sync_progress exists, and create it if missing:

```typescript
// NEW FIXED CODE:
const existingProgress = await env.DB.prepare(
  `SELECT id FROM sync_progress WHERE sync_session_id = ? LIMIT 1`
).bind(sessionId).first();

if (!existingProgress) {
  await env.DB.prepare(`INSERT INTO sync_progress ...`);
  console.log(`[RotationSync] Created sync_progress record for session ${sessionId}`);
}
```

### Benefits
✅ **Works for all entry points**: Single sync, bulk sync, queue processor - all work
✅ **No orphaned records**: sync_progress always created when sync starts
✅ **Idempotent**: Safe to call multiple times (checks for existing record)
✅ **Dashboard visibility**: All syncs show progress immediately

### Deployed (2025-11-27)
- Worker Version: `6c7f7df0-28a9-4d91-820d-bdf2bdfb849d`
- sync_progress records now created reliably for all sync types
- Manually cleaned up orphaned record from buggy version

## ✅ Enhancement: Dashboard Visibility for Queued Syncs (2025-11-27)

### Issue
Dashboard showed active and recent syncs, but not queued syncs waiting to be processed. Users couldn't see:
- Which athletes are in the queue
- Their position in queue
- How many syncs are waiting

### Solution (2025-11-27)
Enhanced `getAdminSyncStatus` endpoint in `admin.ts` to include queued syncs:

**Added query for pending sync_queue entries:**
```typescript
const queuedSyncs = await env.DB.prepare(`
  SELECT sq.*, a.firstname, a.lastname
  FROM sync_queue sq
  JOIN athletes a ON sq.athlete_id = a.id
  WHERE sq.status = 'pending'
  ORDER BY sq.created_at ASC
`).all();

const queued = (queuedSyncs.results || []).map((job: any, index: number) => ({
  id: job.sync_session_id,
  queue_id: job.queue_id,
  position: index + 1, // Position in queue (1-based)
  athlete_id: job.athlete_id,
  strava_id: job.strava_id,
  first_name: job.firstname,
  last_name: job.lastname,
  sync_type: job.sync_type,
  status: 'queued',
  queued_at: job.created_at * 1000,
  attempts: job.attempts || 0,
  max_attempts: job.max_attempts || 3,
  chunk_info: job.total_chunks ? `Chunk ${(job.chunk_index || 0) + 1}/${job.total_chunks}` : null,
}));
```

**Updated response structure:**
```typescript
const combinedStatus = {
  active,   // Currently processing
  queued,   // Waiting in queue (NEW)
  recent,   // Recently completed/failed
};
```

### Benefits
✅ **Full queue visibility**: See all pending syncs and their queue position
✅ **Better UX**: Users know "Sync All" is working when they see 20 queued syncs
✅ **Debugging**: Easier to diagnose queue issues
✅ **Chunk visibility**: Shows chunk info for chunked syncs

### Deployed (2025-11-27)
- Worker Version: `063e549f-9853-4bd5-99a9-cfed4a7a2c5f`
- Dashboard now shows active, queued, and recent syncs

## ❌ Problem: Nelson's Sync Failing with "Too Many Subrequests" (2025-11-27)

### Issue Discovered (2025-11-27)
Sync `b06d2e01-0de1-43ae-a50b-1611a06b2113` for Nelson Santos failed with:
```
Error: Too many subrequests.
```

**Investigation Results:**
- Sync failed with status='error', error_message='Too many subrequests.'
- Database shows `total_activities_count = 120`
- But Nelson actually has ~3200 activities on Strava
- The time-chunking logic at line 558 checks:
  ```typescript
  if (athlete.total_activities_count && athlete.total_activities_count > 400 && !afterTimestamp)
  ```
- Since stored count was 120 < 400, time-chunking didn't trigger
- Sync tried to fetch all 3200 activities in one go
- Hit Cloudflare Workers 50 subrequest limit

**Root Cause:**
The chunking decision relies on `athlete.total_activities_count` from the database, which:
1. Is only updated at the END of a successful sync
2. Is incorrect/missing for first syncs or after failed syncs
3. Doesn't reflect current Strava activity count

This creates a chicken-and-egg problem:
- Need accurate count to decide if chunking is needed
- But count is only accurate after a successful sync
- Can't complete sync without chunking for large athletes

### ✅ Solution: Fetch Real-Time Activity Count Before Chunking Decision (2025-11-27)

**Fix Applied:**
Added pre-sync check that fetches athlete stats from Strava API to get accurate activity count BEFORE deciding whether to chunk.

**Changes in `rotation-sync.ts` (before line 558):**
```typescript
// Fetch current athlete stats from Strava to get accurate activity count
// This is critical because the stored total_activities_count may be outdated or missing
let actualActivityCount = athlete.total_activities_count || 0;
try {
  await ensureValidToken(env, athlete);
  const statsResponse = await fetch(
    `https://www.strava.com/api/v3/athletes/${athlete.strava_id}/stats`,
    {
      headers: { Authorization: `Bearer ${athlete.access_token}` },
    }
  );

  if (statsResponse.ok) {
    const stats = await statsResponse.json() as any;
    // Stats API returns all_run_totals, all_ride_totals, etc.
    actualActivityCount = (stats.all_run_totals?.count || 0) +
                           (stats.all_ride_totals?.count || 0) +
                           (stats.all_swim_totals?.count || 0);
    console.log(`[RotationSync] Fetched stats for ${athlete.strava_id}: ${actualActivityCount} total activities`);

    // Update athlete record with fresh count
    await env.DB.prepare(
      'UPDATE athletes SET total_activities_count = ?, updated_at = ? WHERE id = ?'
    ).bind(actualActivityCount, Math.floor(Date.now() / 1000), athlete.id).run();
  } else {
    console.warn(`[RotationSync] Failed to fetch stats, using stored count: ${actualActivityCount}`);
  }
} catch (error) {
  console.error(`[RotationSync] Error fetching stats:`, error);
  // Continue with stored count as fallback
}

// Now use actualActivityCount for chunking decision
if (actualActivityCount > MAX_SAFE_ACTIVITIES && !afterTimestamp) {
  // Create time chunks...
}
```

### Benefits
✅ **Accurate chunking**: Always uses current Strava activity count
✅ **Works for first sync**: No need for previous successful sync
✅ **Automatic updates**: Database count refreshed before each sync
✅ **Graceful fallback**: Uses stored count if stats API fails
✅ **Prevents subrequest errors**: Large athletes automatically chunked

### Deployed (2025-11-27)
- Worker Version: `74c7affd-9527-43bd-aedc-1ede10cba40f`
- Syncs now fetch athlete stats before deciding on chunking
- Ready to test with Nelson Santos (strava_id: 2132829)

## ❌ Problem: Orphaned Syncs from Broken Chunked Detail Fetch (2025-11-27)

### Issue Discovered (2025-11-27)
Three syncs were stuck in "running" status for 10+ minutes:
- **Alan Brnabic** (c23a5d85...): 1049s (17.5 min) - stuck at "fetching_activities"
- **Hannah Wood** (4a6724d5...): 809s (13.5 min) - stuck at "fetching_activities"
- **Jonathon Little** (05d8356c...): 749s (12.5 min) - stuck at "fetching_details"

**Investigation:**
- Main sync_queue entries were marked "completed"
- But chunked jobs were created (time chunks for Alan/Hannah, detail chunks for Jonathon)
- sync_progress records left in "running" state
- Chunks were never processed

**Root Cause:**
At line 241-242 of `queue-processor.ts`, `processChunkedDetailFetch()` was stubbed out to throw error:
```typescript
async function processChunkedDetailFetch(...) {
  console.warn('Chunked detail fetch is deprecated - marking job as failed');
  throw new Error('Chunked detail fetch is no longer supported');
}
```

But `rotation-sync.ts` still creates `chunked_detail_fetch` jobs when `newRaces.length > 45`.

This created orphaned syncs:
1. Sync detects >45 races
2. Creates chunked_detail_fetch jobs
3. Marks main queue job as "completed"
4. Returns early, leaving sync_progress in "running"
5. Queue processor tries to process chunks
6. Throws "no longer supported" error
7. Chunks fail, sync_progress orphaned

### ✅ Solution: Re-enable Chunked Detail Fetch Processor (2025-11-27)

**Fix Applied:**
Re-implemented `processChunkedDetailFetch()` in `queue-processor.ts` to properly handle race detail chunks:

```typescript
async function processChunkedDetailFetch(env: Env, job: SyncQueueJob, athlete: any) {
  const raceIds: number[] = JSON.parse(job.race_ids);

  // Fetch detailed data for each race in this chunk
  const detailedActivities: any[] = [];
  for (const activityId of raceIds) {
    const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
      headers: { Authorization: `Bearer ${athlete.access_token}` },
    });
    if (response.ok) {
      detailedActivities.push(await response.json());
    }
  }

  // Save races from this chunk
  await saveRaces(env, athlete, job.sync_session_id, newRaces, detailedActivities);

  // Check if all chunks complete - if so, finalize parent sync
  const remaining = await countRemainingChunks(env, job.parent_session_id);
  if (remaining === 0) {
    await finalizeParentSync(env, athlete, job.parent_session_id);
  }
}
```

**Immediate Cleanup:**
- Manually marked 3 orphaned sync_progress records as 'error'
- Deleted 37 pending chunk jobs that would have failed

### Benefits
✅ **Chunking works again**: Athletes with >45 races can now sync
✅ **No orphaned syncs**: Chunks properly finalize parent sync when complete
✅ **Subrequest limit safe**: Each chunk fetches ≤40 races (well under 50 limit)
✅ **Automatic processing**: Queue processor handles chunks every minute

### Deployed (2025-11-27)
- Worker Version: `5101544a-95ed-4b3f-9aa7-3416d988ac31`
- Chunked detail fetch processor re-enabled and working
- Orphaned syncs cleaned up manually
