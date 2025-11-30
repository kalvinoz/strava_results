// API endpoints for querying athlete audit logs

import { Env } from '../types';

/**
 * GET /api/audit/athletes - Get audit log for all athletes
 * Query params:
 *   - table: 'parkrun_athletes' or 'athletes' (optional, filter by table)
 *   - field: filter by field name (optional)
 *   - source: filter by change source (optional)
 *   - limit: number of records (default 100, max 1000)
 */
export async function getAthleteAuditLog(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const table = url.searchParams.get('table');
    const field = url.searchParams.get('field');
    const source = url.searchParams.get('source');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000);

    // Build query
    const conditions: string[] = [];
    const bindings: any[] = [];

    if (table) {
      conditions.push('table_name = ?');
      bindings.push(table);
    }
    if (field) {
      conditions.push('field_name = ?');
      bindings.push(field);
    }
    if (source) {
      conditions.push('change_source = ?');
      bindings.push(source);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    bindings.push(limit);

    const result = await env.DB.prepare(
      `SELECT id, table_name, athlete_identifier, field_name, old_value, new_value,
              changed_at, change_source, change_reason, admin_email, metadata
       FROM athlete_audit_log
       ${whereClause}
       ORDER BY changed_at DESC
       LIMIT ?`
    )
      .bind(...bindings)
      .all();

    return new Response(
      JSON.stringify({
        success: true,
        logs: result.results || [],
        count: result.results?.length || 0,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching audit log:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch audit log',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

/**
 * GET /api/audit/athletes/:identifier - Get audit log for specific athlete
 * Path params:
 *   - identifier: athlete_name (for parkrun) or strava_id (for strava athletes)
 * Query params:
 *   - table: 'parkrun_athletes' or 'athletes' (required)
 *   - limit: number of records (default 100, max 500)
 */
export async function getAthleteAuditHistory(
  request: Request,
  env: Env,
  athleteIdentifier: string
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const table = url.searchParams.get('table');
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);

    if (!table || (table !== 'parkrun_athletes' && table !== 'athletes')) {
      return new Response(
        JSON.stringify({
          error: 'Invalid table parameter',
          message: 'table must be "parkrun_athletes" or "athletes"',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const result = await env.DB.prepare(
      `SELECT id, table_name, athlete_identifier, field_name, old_value, new_value,
              changed_at, change_source, change_reason, admin_email, metadata
       FROM athlete_audit_log
       WHERE table_name = ? AND athlete_identifier = ?
       ORDER BY changed_at DESC
       LIMIT ?`
    )
      .bind(table, athleteIdentifier, limit)
      .all();

    return new Response(
      JSON.stringify({
        success: true,
        athlete_identifier: athleteIdentifier,
        table_name: table,
        logs: result.results || [],
        count: result.results?.length || 0,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching athlete audit history:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch athlete audit history',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

/**
 * GET /api/audit/recent-left-club - Get recently auto-detected "left club" changes
 * Query params:
 *   - days: number of days to look back (default 30, max 365)
 */
export async function getRecentLeftClubChanges(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const days = Math.min(parseInt(url.searchParams.get('days') || '30'), 365);
    const sinceTimestamp = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);

    const result = await env.DB.prepare(
      `SELECT id, athlete_identifier, old_value, new_value, changed_at, change_reason, metadata
       FROM athlete_audit_log
       WHERE table_name = 'parkrun_athletes'
         AND field_name = 'has_left_club'
         AND new_value = '1'
         AND changed_at >= ?
       ORDER BY changed_at DESC`
    )
      .bind(sinceTimestamp)
      .all();

    return new Response(
      JSON.stringify({
        success: true,
        days,
        logs: result.results || [],
        count: result.results?.length || 0,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching recent left club changes:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch recent left club changes',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}
