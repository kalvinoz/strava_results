# Strava Sync System Refactor

## Overview

The Strava data upload system has been completely redesigned with a cleaner, more flexible architecture that:
- Uses a weekly rotation queue that automatically adjusts to athlete count
- Implements a two-phase sync process (bulk fetch → process)
- Only fetches public activities using `activity:read` scope
- Provides detailed step-by-step visibility in the admin dashboard

## Key Changes

### 1. Flexible Rotation Queue

**Old System:**
- All athletes synced at once via cron
- Complex batch-based processing (WOOD-8)
- Fixed batch sizes and timing

**New System:**
- One athlete syncs at a time
- Weekly rotation: each athlete synced once per 7 days
- Automatically distributes sync load across the week based on total athlete count
- Simple priority: athletes with oldest `last_synced_at` go first

### 2. Two-Phase Sync Architecture

**Phase 1: Bulk Fetch**
- Fetch ALL activities from Strava (paginated at 200/request)
- Filter to runs only (type === 'Run')
- Filter to races only (workout_type === 1)
- Store activity IDs in memory

**Phase 2: Process**
- Check which races already exist in database
- For NEW races only:
  - Fetch detailed activity data (polylines + descriptions)
  - Apply event name mappings
  - Save to races table

This prevents unnecessary API calls for activities that already exist.

### 3. OAuth Scope Change

**Changed:** `activity:read_all` → `activity:read`

- Only fetches public activities (respects athlete privacy)
- Users must explicitly mark activities as "Race" in Strava for them to appear

### 4. Detailed Step Tracking

**Sync Steps:**
1. `idle` - Not syncing
2. `queued` - Sync starting
3. `fetching_activities` - Downloading from Strava
4. `filtering_runs` - Finding runs and races
5. `checking_existing` - Deduplicating against database
6. `fetching_details` - Getting polylines and descriptions
7. `saving_races` - Inserting into database
8. `completed` / `error` - Final states

All steps are logged in `sync_step_logs` table for visibility in admin dashboard.

### 5. Sync Type Tracking

- **Auto (A)**: Triggered by weekly rotation queue
- **Manual (M)**: Triggered by admin dashboard

Displayed in admin dashboard with icon + tooltip.

## Database Changes

### Migration: `0030_refactor_sync_system.sql`

**New Tables:**
- `sync_progress` - Tracks individual sync sessions with progress counters
- `sync_step_logs` - Detailed step-by-step log entries
- `fetched_activities` - Staging table for two-phase sync (not currently used, reserved for future optimization)

**Removed Tables:**
- `sync_queue` - Old job queue system
- `sync_batches` - Old batch tracking (WOOD-8)
- `sync_logs` - Old global sync logs

**New Columns (athletes table):**
- `current_sync_step` - Current step for dashboard visibility
- `last_sync_type` - 'auto' or 'manual'

**Updated athlete_sync_logs:**
- Cleanup of entries older than 30 days

## API Changes

### New Endpoints

#### `POST /api/admin/athletes/:id/sync`
Trigger manual sync for a single athlete.

**Request:**
```json
{
  "admin_strava_id": 12345
}
```

**Response:**
```json
{
  "success": true,
  "message": "Manual sync triggered"
}
```

#### `POST /api/admin/sync-all`
Trigger sync for ALL athletes with optional date range.

**Request:**
```json
{
  "admin_strava_id": 12345,
  "after_date": "2025-01-18",  // Optional: ISO date (YYYY-MM-DD)
  "before_date": "2025-01-25"   // Optional: ISO date (YYYY-MM-DD)
}
```

**Response:**
```json
{
  "success": true,
  "message": "Sync triggered for 45 athletes",
  "date_range": {
    "after": "2025-01-18",
    "before": "2025-01-25"
  }
}
```

### Modified Endpoints

#### `GET /api/admin/athletes`
Now returns:
```json
{
  "athletes": [
    {
      "id": 1,
      "strava_id": 12345,
      "firstname": "John",
      "lastname": "Doe",
      "current_sync_step": "fetching_activities",  // NEW
      "last_sync_type": "manual",                   // NEW: 'auto' or 'manual'
      "last_synced_at": 1706198400,
      "next_sync_at": 1706803200,                   // NEW: calculated next sync time
      "race_count": 42,
      "syncProgress": {                              // NEW: only when actively syncing
        "total_activities_fetched": 523,
        "runs_filtered": 156,
        "races_filtered": 42,
        "new_races_added": 3
      }
    }
  ]
}
```

## Code Changes

### New Files

- [workers/src/sync/rotation-sync.ts](workers/src/sync/rotation-sync.ts) - Main sync orchestrator with two-phase architecture

### Modified Files

- [workers/src/utils/strava.ts](workers/src/utils/strava.ts:327) - OAuth scope changed to `activity:read`
- [workers/src/auth/oauth.ts](workers/src/auth/oauth.ts) - Removed old sync queueing logic
- [workers/src/cron/sync.ts](workers/src/cron/sync.ts) - Simplified to call rotation queue
- [workers/src/api/admin.ts](workers/src/api/admin.ts) - Updated sync endpoints
- [workers/src/index.ts](workers/src/index.ts) - Added route for `/api/admin/sync-all`

### Removed Dependencies

The following old sync system files are no longer imported:
- `queue/sync-queue.ts` (complex sync orchestrator)
- `queue/batch-processor.ts` (WOOD-8 batch system)
- `utils/sync-logger.ts` (global sync logging)
- `utils/batch-manager.ts` (batch tracking)

## Admin Dashboard Integration

### Features to Implement (Frontend)

1. **Athlete List Table Updates:**
   - Add "Last Sync" column showing timestamp + badge (A/M) with tooltip
   - Add "Next Sync" column showing calculated next sync time
   - Add "Current Step" indicator showing live sync progress
   - Update "Sync" button to use new API endpoint

2. **Sync All Button:**
   - Add "Sync All" button with date picker modal
   - Default date range: last 7 days
   - Show progress indicator while syncing

3. **Sync Progress Display:**
   - Show current step for each athlete (live updates)
   - Show progress counters:
     - Total activities fetched
     - Runs filtered
     - Races found
     - New races added
   - Display sync step logs in expandable section

### Example UI Flow

```
Admin Dashboard > Athletes Tab

[Sync All] button → Modal:
  Date Range: [2025-01-18] to [2025-01-25]
  [Cancel] [Sync All Athletes]

Athletes Table:
┌────────────────┬──────────────┬──────────────┬───────────────┬─────────┐
│ Name           │ Last Sync    │ Next Sync    │ Status        │ Actions │
├────────────────┼──────────────┼──────────────┼───────────────┼─────────┤
│ John Doe       │ 2h ago (M)ⓘ  │ in 5 days    │ ●  Fetching   │ [Sync]  │
│ Jane Smith     │ 1 day ago (A)│ in 6 days    │ ✓  Completed  │ [Sync]  │
│ Bob Johnson    │ never        │ now          │ ○  Idle       │ [Sync]  │
└────────────────┴──────────────┴──────────────┴───────────────┴─────────┘

ⓘ Tooltip: "M = Manual sync, A = Automatic sync"
```

## Next Steps

### 1. Run Migration

```bash
cd /Users/pqz/Code/strava_results
wrangler d1 migrations apply DB --local  # Test locally first
wrangler d1 migrations apply DB          # Then production
```

### 2. Deploy Worker

```bash
npm run deploy  # or wrangler deploy
```

### 3. Update Frontend

The admin dashboard ([frontend/src/pages/Admin.tsx](frontend/src/pages/Admin.tsx)) needs to be updated to:
- Display new sync fields (`current_sync_step`, `last_sync_type`, `next_sync_at`)
- Add "Sync All" button with date picker
- Show live sync progress during active syncs
- Update table columns as described above

### 4. Testing

1. **Test Single Athlete Sync:**
   ```bash
   curl -X POST https://your-worker.dev/api/admin/athletes/1/sync \
     -H "Content-Type: application/json" \
     -d '{"admin_strava_id": YOUR_ADMIN_ID}'
   ```

2. **Test Sync All:**
   ```bash
   curl -X POST https://your-worker.dev/api/admin/sync-all \
     -H "Content-Type: application/json" \
     -d '{
       "admin_strava_id": YOUR_ADMIN_ID,
       "after_date": "2025-01-18",
       "before_date": "2025-01-25"
     }'
   ```

3. **Monitor Logs:**
   ```bash
   wrangler tail
   ```

4. **Check Admin Dashboard:**
   - Verify sync progress displays correctly
   - Check step logs are visible
   - Confirm Auto/Manual badges appear

## Benefits

✅ **Simpler Architecture:** Removed complex batch system (WOOD-8)
✅ **Flexible Scheduling:** Auto-adjusts to athlete count changes
✅ **Better Privacy:** Only fetches public activities
✅ **Detailed Visibility:** Step-by-step progress tracking
✅ **Manual Control:** Admin can trigger individual or bulk syncs
✅ **Date Range Support:** Sync specific time periods
✅ **Reduced API Calls:** Two-phase sync avoids fetching existing races

## Rollback Plan

If issues arise, you can revert by:

1. Restore previous worker code from git:
   ```bash
   git checkout HEAD~1 workers/src
   ```

2. Redeploy:
   ```bash
   npm run deploy
   ```

The database migration adds new tables but doesn't destroy old data, so the old system can continue using existing tables if needed.
