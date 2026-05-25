// API endpoints for fetching parkrun data

import { Env } from '../types';
import { cleanupAthleteNames } from './parkrun-import';

/**
 * GET /api/parkrun - Get parkrun results with filtering
 */
export async function getParkrunResults(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const athleteName = url.searchParams.get('athlete');
  const eventName = url.searchParams.get('event');
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');

  // Get sorting parameters with validation
  const sortBy = url.searchParams.get('sort_by') || 'date';
  const sortDir = url.searchParams.get('sort_dir') || 'desc';

  const allowedSortFields = ['date', 'event_name', 'athlete_name', 'position', 'gender_position', 'time_seconds'];
  const allowedSortDirs = ['asc', 'desc'];
  const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'date';
  const validSortDir = allowedSortDirs.includes(sortDir.toLowerCase()) ? sortDir.toUpperCase() : 'DESC';

  try {
    // Build query with filters - exclude hidden athletes
    // Uses COUNT(*) OVER() to get total count in same query (avoids duplicate query)
    let query = `
      SELECT
        pr.id,
        pr.athlete_name,
        pr.parkrun_athlete_id,
        pr.event_name,
        pr.event_number,
        pr.position,
        pr.gender_position,
        pr.time_seconds,
        pr.time_string,
        pr.age_grade,
        pr.age_category,
        pr.date,
        pr.club_name,
        pr.created_at,
        COUNT(*) OVER() as total_count
      FROM parkrun_results pr
      LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
      WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0)
    `;

    const bindings: any[] = [];

    if (athleteName) {
      query += ` AND pr.athlete_name LIKE ?`;
      bindings.push(`%${athleteName}%`);
    }

    if (eventName) {
      query += ` AND pr.event_name LIKE ?`;
      bindings.push(`%${eventName}%`);
    }

    if (dateFrom) {
      query += ` AND pr.date >= ?`;
      bindings.push(dateFrom);
    }

    if (dateTo) {
      query += ` AND pr.date <= ?`;
      bindings.push(dateTo);
    }

    // Add table prefix for sortable columns to avoid ambiguity
    const sortColumn = validSortBy === 'athlete_name' || validSortBy === 'event_name' || validSortBy === 'date' || validSortBy === 'position' || validSortBy === 'gender_position' || validSortBy === 'time_seconds'
      ? `pr.${validSortBy}`
      : validSortBy;
    query += ` ORDER BY ${sortColumn} ${validSortDir} LIMIT ? OFFSET ?`;
    bindings.push(limit, offset);

    const result = await env.DB.prepare(query).bind(...bindings).all();

    // Extract total count from first result row (same for all rows due to window function)
    const total = (result.results && result.results.length > 0)
      ? (result.results[0] as any).total_count || 0
      : 0;

    return new Response(
      JSON.stringify({
        results: result.results,
        pagination: {
          total,
          limit,
          offset,
        },
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching parkrun results:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch parkrun results',
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
 * GET /api/parkrun/stats - Get parkrun statistics
 */
export async function getParkrunStats(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const athleteNames = url.searchParams.getAll('athlete');
    const eventNames = url.searchParams.getAll('event');
    const dateFrom = url.searchParams.get('date_from');
    const dateTo = url.searchParams.get('date_to');

    // Build WHERE clause for filters
    const conditions: string[] = [];
    const bindings: any[] = [];

    if (athleteNames.length > 0) {
      const athleteConditions = athleteNames.map(() => 'pr.athlete_name = ?').join(' OR ');
      conditions.push(`(${athleteConditions})`);
      athleteNames.forEach(name => bindings.push(name));
    }

    if (eventNames.length > 0) {
      const eventConditions = eventNames.map(() => 'pr.event_name = ?').join(' OR ');
      conditions.push(`(${eventConditions})`);
      eventNames.forEach(name => bindings.push(name));
    }

    if (dateFrom) {
      conditions.push('pr.date >= ?');
      bindings.push(dateFrom);
    }

    if (dateTo) {
      conditions.push('pr.date <= ?');
      bindings.push(dateTo);
    }

    // Always filter out hidden athletes
    conditions.push('(pa.is_hidden IS NULL OR pa.is_hidden = 0)');

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total number of parkrun results (excluding hidden athletes)
    const totalResults = await env.DB.prepare(
      `SELECT COUNT(*) as count
       FROM parkrun_results pr
       LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
       ${whereClause}`
    ).bind(...bindings).first<{ count: number }>();

    // Get unique athletes (excluding hidden)
    const uniqueAthletes = await env.DB.prepare(
      `SELECT COUNT(DISTINCT pr.athlete_name) as count
       FROM parkrun_results pr
       LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
       ${whereClause}`
    ).bind(...bindings).first<{ count: number }>();

    // Get unique events (excluding hidden athletes' results)
    const uniqueEvents = await env.DB.prepare(
      `SELECT COUNT(DISTINCT pr.event_name) as count
       FROM parkrun_results pr
       LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
       ${whereClause}`
    ).bind(...bindings).first<{ count: number }>();

    // Get date range (earliest and latest, excluding hidden)
    const dateRange = await env.DB.prepare(
      `SELECT MIN(pr.date) as earliest, MAX(pr.date) as latest
       FROM parkrun_results pr
       LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
       ${whereClause}`
    ).bind(...bindings).first<{ earliest: string; latest: string }>();

    // Get fastest time (excluding hidden)
    const fastestTime = await env.DB.prepare(
      `SELECT pr.athlete_name, pr.event_name, pr.time_string, pr.date
       FROM parkrun_results pr
       LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
       ${whereClause}
       ORDER BY pr.time_seconds ASC
       LIMIT 1`
    ).bind(...bindings).first();

    // Get most recent result (excluding hidden)
    const mostRecentResult = await env.DB.prepare(
      `SELECT pr.athlete_name, pr.event_name, pr.time_string, pr.date
       FROM parkrun_results pr
       LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
       ${whereClause}
       ORDER BY pr.date DESC
       LIMIT 1`
    ).bind(...bindings).first();

    // Get most parkruns by athlete (excluding hidden)
    const mostActiveAthlete = await env.DB.prepare(
      `SELECT pr.athlete_name, COUNT(*) as count
       FROM parkrun_results pr
       LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
       ${whereClause}
       GROUP BY pr.athlete_name
       ORDER BY count DESC
       LIMIT 1`
    ).bind(...bindings).first();

    return new Response(
      JSON.stringify({
        totalResults: totalResults?.count || 0,
        uniqueAthletes: uniqueAthletes?.count || 0,
        uniqueEvents: uniqueEvents?.count || 0,
        earliestDate: dateRange?.earliest,
        latestDate: dateRange?.latest,
        fastestTime,
        mostRecentResult,
        mostActiveAthlete,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching parkrun stats:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch parkrun stats',
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
 * GET /api/parkrun/athletes - Get all parkrun athletes (for admin management)
 */
export async function getParkrunAthletes(request: Request, env: Env): Promise<Response> {
  try {
    // Get all unique athlete names from parkrun results with run counts and left status
    // Get parkrun_athlete_id from parkrun_results (it's only in results table, not athletes table)
    const athleteResults = await env.DB.prepare(
      `SELECT DISTINCT
              pr.athlete_name,
              pa.id,
              pa.is_hidden,
              pa.has_left_club,
              pa.last_club_run_date,
              pa.last_individual_run_date,
              pa.last_audited_at,
              (SELECT parkrun_athlete_id FROM parkrun_results WHERE athlete_name = pr.athlete_name AND parkrun_athlete_id IS NOT NULL LIMIT 1) as parkrun_athlete_id,
              COUNT(pr.id) as run_count
       FROM parkrun_results pr
       LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
       GROUP BY pr.athlete_name
       ORDER BY pr.athlete_name ASC`
    ).all();

    // Get top 3 events for ALL athletes in a single query (fixes N+1 problem)
    const allTopEvents = await env.DB.prepare(
      `SELECT athlete_name, event_name, count
       FROM (
         SELECT
           athlete_name,
           event_name,
           COUNT(*) as count,
           ROW_NUMBER() OVER (PARTITION BY athlete_name ORDER BY COUNT(*) DESC) as rn
         FROM parkrun_results
         GROUP BY athlete_name, event_name
       )
       WHERE rn <= 3`
    ).all();

    // Group top events by athlete name for easy lookup
    const topEventsByAthlete = new Map<string, Array<{event_name: string, count: number}>>();
    for (const row of (allTopEvents.results || []) as Array<{athlete_name: string, event_name: string, count: number}>) {
      if (!topEventsByAthlete.has(row.athlete_name)) {
        topEventsByAthlete.set(row.athlete_name, []);
      }
      topEventsByAthlete.get(row.athlete_name)!.push({
        event_name: row.event_name,
        count: row.count,
      });
    }

    // Combine athlete data with their top events
    const athletesWithTopEvents = (athleteResults.results || []).map((athlete: any) => ({
      ...athlete,
      top_events: topEventsByAthlete.get(athlete.athlete_name) || [],
    }));

    return new Response(
      JSON.stringify({
        athletes: athletesWithTopEvents,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching parkrun athletes:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch parkrun athletes',
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
 * GET /api/parkrun/by-date - Get parkrun results aggregated by date
 * Supports the same filters as the main results endpoint
 */
export async function getParkrunByDate(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const athleteNames = url.searchParams.getAll('athlete');
  const eventNames = url.searchParams.getAll('event');
  const dateFrom = url.searchParams.get('date_from');
  const dateTo = url.searchParams.get('date_to');

  try {
    // Build query with filters - exclude hidden athletes
    let query = `
      SELECT
        pr.date,
        COUNT(*) as run_count,
        COUNT(DISTINCT pr.event_name) as event_count
      FROM parkrun_results pr
      LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
      WHERE (pa.is_hidden IS NULL OR pa.is_hidden = 0)
    `;

    const bindings: any[] = [];

    // Handle multiple athlete filters
    if (athleteNames.length > 0) {
      const athleteConditions = athleteNames.map(() => 'pr.athlete_name = ?').join(' OR ');
      query += ` AND (${athleteConditions})`;
      athleteNames.forEach(name => bindings.push(name));
    }

    // Handle multiple event filters
    if (eventNames.length > 0) {
      const eventConditions = eventNames.map(() => 'pr.event_name = ?').join(' OR ');
      query += ` AND (${eventConditions})`;
      eventNames.forEach(name => bindings.push(name));
    }

    if (dateFrom) {
      query += ` AND pr.date >= ?`;
      bindings.push(dateFrom);
    }

    if (dateTo) {
      query += ` AND pr.date <= ?`;
      bindings.push(dateTo);
    }

    query += ` GROUP BY pr.date ORDER BY pr.date ASC`;

    const result = await env.DB.prepare(query).bind(...bindings).all();

    // Fill in missing parkrun dates (Saturdays + special dates) with zero counts
    let filledData: any[] = [];

    if (dateFrom && dateTo) {
      const start = new Date(dateFrom);
      const end = new Date(dateTo);
      const dataMap = new Map();

      // Create a map of existing data
      if (result.results) {
        for (const row of result.results as any[]) {
          dataMap.set(row.date, row);
        }
      }

      const allDates: string[] = [];

      // Generate all Saturdays in the range
      let current = new Date(start);
      // Find first Saturday
      while (current.getDay() !== 6 && current <= end) {
        current.setDate(current.getDate() + 1);
      }

      // Add all Saturdays
      while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];
        allDates.push(dateStr);
        current.setDate(current.getDate() + 7); // Next Saturday
      }

      // Add special dates (Dec 25 and Jan 1) if they fall in range
      const startYear = start.getFullYear();
      const endYear = end.getFullYear();

      for (let year = startYear; year <= endYear; year++) {
        const dec25 = new Date(year, 11, 25); // December 25
        const jan1 = new Date(year, 0, 1);    // January 1

        if (dec25 >= start && dec25 <= end) {
          const dateStr = dec25.toISOString().split('T')[0];
          if (!allDates.includes(dateStr)) {
            allDates.push(dateStr);
          }
        }

        if (jan1 >= start && jan1 <= end) {
          const dateStr = jan1.toISOString().split('T')[0];
          if (!allDates.includes(dateStr)) {
            allDates.push(dateStr);
          }
        }
      }

      // Sort dates and build filled data
      allDates.sort();
      for (const dateStr of allDates) {
        if (dataMap.has(dateStr)) {
          filledData.push(dataMap.get(dateStr));
        } else {
          filledData.push({
            date: dateStr,
            run_count: 0,
            event_count: 0,
          });
        }
      }
    } else {
      filledData = result.results || [];
    }

    return new Response(
      JSON.stringify({
        data: filledData,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching parkrun by date:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch parkrun data by date',
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
 * GET /api/parkrun/weekly-summary - Get weekly parkrun summary for a specific date
 * Query params: date (optional, defaults to most recent)
 */
export async function getParkrunWeeklySummary(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const requestedDate = url.searchParams.get('date');

    // Get the most recent date if not specified
    let targetDate = requestedDate;
    if (!targetDate) {
      const mostRecentResult = await env.DB.prepare(
        `SELECT MAX(date) as latest_date FROM parkrun_results`
      ).first<{ latest_date: string }>();
      targetDate = mostRecentResult?.latest_date || '';
    }

    if (!targetDate) {
      return new Response(
        JSON.stringify({ error: 'No parkrun data available' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get all available dates for the picker (limit to last 500 dates for performance)
    const availableDatesResult = await env.DB.prepare(
      `SELECT DISTINCT date FROM parkrun_results ORDER BY date DESC LIMIT 500`
    ).all();
    const availableDates = (availableDatesResult.results || []).map((r: any) => r.date);

    // Get summary for the target date (excluding hidden athletes)
    const summaryQuery = `
      SELECT
        COUNT(DISTINCT pr.athlete_name) as athlete_count,
        COUNT(DISTINCT pr.event_name) as event_count
      FROM parkrun_results pr
      LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
      WHERE pr.date = ?
        AND (pa.is_hidden IS NULL OR pa.is_hidden = 0)
    `;
    const summary = await env.DB.prepare(summaryQuery).bind(targetDate).first<{
      athlete_count: number;
      event_count: number;
    }>();

    // Get most popular events for this date (excluding hidden athletes)
    const popularEventsQuery = `
      SELECT
        pr.event_name,
        COUNT(*) as count
      FROM parkrun_results pr
      LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
      WHERE pr.date = ?
        AND (pa.is_hidden IS NULL OR pa.is_hidden = 0)
      GROUP BY pr.event_name
      ORDER BY count DESC
      LIMIT 3
    `;
    const popularEventsResult = await env.DB.prepare(popularEventsQuery).bind(targetDate).all();
    const popularEvents = (popularEventsResult.results || []).map((e: any) => ({
      name: e.event_name,
      count: e.count,
    }));

    // Get all events before this date (excluding hidden athletes)
    const precedingEventsQuery = `
      SELECT DISTINCT pr.event_name
      FROM parkrun_results pr
      LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
      WHERE pr.date < ?
        AND (pa.is_hidden IS NULL OR pa.is_hidden = 0)
    `;
    const precedingEventsResult = await env.DB.prepare(precedingEventsQuery).bind(targetDate).all();
    const precedingEvents = new Set((precedingEventsResult.results || []).map((e: any) => e.event_name));

    // Get events on this date (excluding hidden athletes)
    const currentEventsQuery = `
      SELECT DISTINCT pr.event_name
      FROM parkrun_results pr
      LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
      WHERE pr.date = ?
        AND (pa.is_hidden IS NULL OR pa.is_hidden = 0)
    `;
    const currentEventsResult = await env.DB.prepare(currentEventsQuery).bind(targetDate).all();
    const currentEvents = (currentEventsResult.results || []).map((e: any) => e.event_name);

    // Find first-time events (events on current date that don't appear in preceding dates)
    const firstTimeEvents = currentEvents.filter((event) => !precedingEvents.has(event));

    // Get event occurrence counts before this date for ALL current events in one query (fixes N+1 problem)
    const rarePokemons: Array<{ name: string; visitCount: number }> = [];

    if (currentEvents.length > 0) {
      const placeholders = currentEvents.map(() => '?').join(', ');
      const eventCountsQuery = `
        SELECT pr.event_name, COUNT(DISTINCT pr.date) as visit_count
        FROM parkrun_results pr
        LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
        WHERE pr.event_name IN (${placeholders})
          AND pr.date < ?
          AND (pa.is_hidden IS NULL OR pa.is_hidden = 0)
        GROUP BY pr.event_name
      `;
      const eventCountsResult = await env.DB.prepare(eventCountsQuery)
        .bind(...currentEvents, targetDate)
        .all();

      // Build a map of event -> visit count before current date
      const visitCountMap = new Map<string, number>();
      for (const row of (eventCountsResult.results || []) as Array<{event_name: string, visit_count: number}>) {
        visitCountMap.set(row.event_name, row.visit_count);
      }

      // Check each current event for rare pokemon status
      for (const event of currentEvents) {
        const visitCount = (visitCountMap.get(event) || 0) + 1; // +1 to include current date

        // Only include events with <=5 total visits (including current)
        if (visitCount <= 5 && visitCount > 1) { // >1 to exclude first-time events
          rarePokemons.push({ name: event, visitCount });
        }
      }
    }

    // Sort rare Pokémon by visit count ascending (2nd visit, then 3rd visit, etc.)
    rarePokemons.sort((a, b) => a.visitCount - b.visitCount);

    return new Response(
      JSON.stringify({
        date: targetDate,
        availableDates,
        summary: {
          athleteCount: summary?.athlete_count || 0,
          eventCount: summary?.event_count || 0,
        },
        popularEvents,
        firstTimeEvents,
        rarePokemons,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching parkrun weekly summary:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch weekly summary',
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
 * GET /api/parkrun/duplicates - Get runners with multiple activities on the same day
 * Excludes January 1st (legitimate double parkrun day)
 */
export async function getParkrunDuplicates(request: Request, env: Env): Promise<Response> {
  try {
    const results = await env.DB.prepare(
      `SELECT
        pr.athlete_name,
        pr.date,
        COUNT(*) as activity_count,
        GROUP_CONCAT(pr.event_name, ', ') as events
       FROM parkrun_results pr
       LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
       WHERE pr.date NOT LIKE '%-01-01'
         AND (pa.is_hidden IS NULL OR pa.is_hidden = 0)
       GROUP BY pr.athlete_name, pr.date
       HAVING COUNT(*) > 1
       ORDER BY pr.date DESC, pr.athlete_name
       LIMIT 100`
    ).all<{ athlete_name: string; date: string; activity_count: number; events: string }>();

    return new Response(
      JSON.stringify({
        duplicates: results.results || [],
        count: results.results?.length || 0,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching parkrun duplicates:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch parkrun duplicates',
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
 * GET /api/parkrun/milestones - Get milestone achievements and upcoming milestones for a date
 * Milestones are: 25, 50, 100, 250, 500, 1000
 * Upcoming = within 98% of milestone (rounded down)
 */
export async function getParkrunMilestones(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const requestedDate = url.searchParams.get('date');

    // Get the target date (most recent if not specified)
    let targetDate = requestedDate;
    if (!targetDate) {
      const mostRecentResult = await env.DB.prepare(
        `SELECT MAX(date) as latest_date FROM parkrun_results`
      ).first<{ latest_date: string }>();
      targetDate = mostRecentResult?.latest_date || '';
    }

    if (!targetDate) {
      return new Response(
        JSON.stringify({ error: 'No parkrun data available' }),
        { status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const milestones = [25, 50, 100, 250, 500, 1000];

    // Get athletes who ran on this date with their total run counts up to this date
    // We count total parkruns per athlete (not event_number which is per-event)
    const athletesOnDate = await env.DB.prepare(
      `SELECT DISTINCT pr.athlete_name, pr.event_name, pr.parkrun_athlete_id
       FROM parkrun_results pr
       LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
       WHERE pr.date = ?
         AND (pa.is_hidden IS NULL OR pa.is_hidden = 0)`
    ).bind(targetDate).all<{ athlete_name: string; event_name: string; parkrun_athlete_id: string | null }>();

    // For each athlete, get their total parkrun count up to and including this date
    const achievedMilestones: Array<{
      milestone: number;
      athletes: Array<{ name: string; event: string; parkrun_id: string | null }>;
    }> = milestones.map(m => ({ milestone: m, athletes: [] }));

    const upcomingMilestones: Array<{
      milestone: number;
      athletes: Array<{ name: string; count: number; parkrun_id: string | null }>;
    }> = milestones.map(m => ({ milestone: m, athletes: [] }));

    // Get total run counts for all athletes on this date in one query (fixes N+1 problem)
    const athleteNames = (athletesOnDate.results || []).map((a: any) => a.athlete_name);

    if (athleteNames.length > 0) {
      const placeholders = athleteNames.map(() => '?').join(', ');
      const countsResult = await env.DB.prepare(
        `SELECT athlete_name, COUNT(*) as total
         FROM parkrun_results
         WHERE athlete_name IN (${placeholders}) AND date <= ?
         GROUP BY athlete_name`
      ).bind(...athleteNames, targetDate).all<{ athlete_name: string; total: number }>();

      // Build a map of athlete -> total count
      const countMap = new Map<string, number>();
      for (const row of (countsResult.results || [])) {
        countMap.set(row.athlete_name, row.total);
      }

      // Check each athlete for milestones
      for (const athlete of (athletesOnDate.results || [])) {
        const totalRuns = countMap.get(athlete.athlete_name) || 0;

        // Check if they hit a milestone on this exact date
        for (let i = 0; i < milestones.length; i++) {
          const milestone = milestones[i];
          if (totalRuns === milestone) {
            achievedMilestones[i].athletes.push({
              name: athlete.athlete_name,
              event: athlete.event_name,
              parkrun_id: athlete.parkrun_athlete_id,
            });
          }
        }
      }
    }

    // Get all visible athletes and their current total run counts for upcoming milestones
    // Only include athletes who have run in the last 4 weeks (28 days)
    const fourWeeksAgo = new Date(targetDate);
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 27); // 28 days including targetDate
    const fourWeeksAgoStr = fourWeeksAgo.toISOString().split('T')[0];

    const allAthletes = await env.DB.prepare(
      `SELECT
        pr.athlete_name,
        (SELECT parkrun_athlete_id FROM parkrun_results WHERE athlete_name = pr.athlete_name AND parkrun_athlete_id IS NOT NULL LIMIT 1) as parkrun_id,
        COUNT(*) as total
       FROM parkrun_results pr
       LEFT JOIN parkrun_athletes pa ON pr.athlete_name = pa.athlete_name
       WHERE pr.date <= ?
         AND (pa.is_hidden IS NULL OR pa.is_hidden = 0)
         AND EXISTS (
           SELECT 1 FROM parkrun_results pr2
           WHERE pr2.athlete_name = pr.athlete_name
             AND pr2.date >= ?
             AND pr2.date <= ?
         )
       GROUP BY pr.athlete_name`
    ).bind(targetDate, fourWeeksAgoStr, targetDate).all<{ athlete_name: string; parkrun_id: string | null; total: number }>();

    // Check for upcoming milestones (within 98% but not yet reached)
    for (const athlete of (allAthletes.results || [])) {
      for (let i = 0; i < milestones.length; i++) {
        const milestone = milestones[i];
        const threshold = Math.floor(milestone * 0.98);

        if (athlete.total >= threshold && athlete.total < milestone) {
          upcomingMilestones[i].athletes.push({
            name: athlete.athlete_name,
            count: athlete.total,
            parkrun_id: athlete.parkrun_id,
          });
        }
      }
    }

    // Sort upcoming athletes by count descending (closest to milestone first)
    for (const upcoming of upcomingMilestones) {
      upcoming.athletes.sort((a, b) => b.count - a.count);
    }

    // Filter out empty milestones for cleaner response
    const achieved = achievedMilestones.filter(m => m.athletes.length > 0);
    const upcoming = upcomingMilestones.filter(m => m.athletes.length > 0);

    return new Response(
      JSON.stringify({
        date: targetDate,
        achieved,
        upcoming,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error fetching parkrun milestones:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to fetch parkrun milestones',
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
 * GET /api/parkrun/count-by-athlete-id?parkrun_athlete_id=703426
 * Returns the number of results in the DB for a given parkrun athlete ID.
 * Used by the audit script to verify counts without relying on athlete_name matching.
 */
export async function getParkrunCountByAthleteId(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parkrunAthleteId = url.searchParams.get('parkrun_athlete_id');

  if (!parkrunAthleteId) {
    return new Response(JSON.stringify({ error: 'parkrun_athlete_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const result = await env.DB.prepare(
      `SELECT
         COUNT(*) as count,
         SUM(CASE WHEN time_seconds = 0 OR time_string = '' OR time_string IS NULL THEN 1 ELSE 0 END) as bad_time_count
       FROM parkrun_results WHERE parkrun_athlete_id = ?`
    ).bind(parkrunAthleteId).first<{ count: number; bad_time_count: number }>();

    return new Response(
      JSON.stringify({
        count: result?.count ?? 0,
        bad_time_count: result?.bad_time_count ?? 0,
        parkrun_athlete_id: parkrunAthleteId,
      }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to count results', message: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}

/**
 * POST /api/parkrun/mark-audited
 * Called by the audit script after a successful audit (status 'ok' or 'fixed').
 * Sets last_audited_at = now on the parkrun_athletes row identified by parkrun_athlete_id.
 * Requires API key.
 */
export async function markAthleteAudited(request: Request, env: Env): Promise<Response> {
  let body: { parkrun_athlete_id?: string };
  try {
    body = await request.json() as { parkrun_athlete_id?: string };
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const { parkrun_athlete_id } = body;
  if (!parkrun_athlete_id) {
    return new Response(JSON.stringify({ error: 'parkrun_athlete_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const now = Math.floor(Date.now() / 1000);

    // Update by matching the parkrun_athlete_id stored in parkrun_athletes
    // (populated via migration 0035 / 0036 from parkrun_results).
    // If no row exists yet, upsert using the athlete_name from parkrun_results.
    const result = await env.DB.prepare(
      `UPDATE parkrun_athletes
       SET last_audited_at = ?, updated_at = ?
       WHERE parkrun_athlete = ?`
    ).bind(now, now, parkrun_athlete_id).run();

    if ((result.meta?.changes ?? 0) === 0) {
      // Row may not exist in parkrun_athletes yet — try upserting via athlete_name
      const nameRow = await env.DB.prepare(
        `SELECT athlete_name FROM parkrun_results WHERE parkrun_athlete_id = ? LIMIT 1`
      ).bind(parkrun_athlete_id).first<{ athlete_name: string }>();

      if (nameRow) {
        await env.DB.prepare(
          `INSERT INTO parkrun_athletes (athlete_name, parkrun_athlete, last_audited_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(athlete_name) DO UPDATE SET
             parkrun_athlete = COALESCE(excluded.parkrun_athlete, parkrun_athlete),
             last_audited_at = excluded.last_audited_at,
             updated_at = excluded.updated_at`
        ).bind(nameRow.athlete_name, parkrun_athlete_id, now, now).run();
      }
    }

    return new Response(
      JSON.stringify({ success: true, parkrun_athlete_id, last_audited_at: now }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Failed to mark audited', message: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}

/**
 * POST /api/parkrun/cleanup-athlete-names - Clean up athlete names with ID suffixes
 * Finds names like "Alan BRNABIC (A5141949)" and merges them into "Alan BRNABIC",
 * re-attributing all parkrun_results rows and updating parkrun_athletes accordingly.
 */
export async function cleanupParkrunAthleteNames(request: Request, env: Env): Promise<Response> {
  try {
    const result = await cleanupAthleteNames(env);
    return new Response(
      JSON.stringify({
        success: true,
        namesFixed: result.namesFixed,
        resultsReattributed: result.resultsReattributed,
        merged: result.athletesMerged,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error cleaning up athlete names:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to clean up athlete names',
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
 * PATCH /api/parkrun/athletes/:name - Update parkrun athlete visibility
 */
export async function updateParkrunAthlete(
  request: Request,
  env: Env,
  athleteName: string
): Promise<Response> {
  try {
    const body = await request.json() as { is_hidden: number };
    const { is_hidden } = body;

    // Get current value for audit log
    const existing = await env.DB.prepare(
      `SELECT is_hidden FROM parkrun_athletes WHERE athlete_name = ?`
    ).bind(athleteName).first<{ is_hidden: number | null }>();

    const oldValue = existing?.is_hidden?.toString() || null;
    const newValue = is_hidden ? '1' : '0';

    // Only log if value actually changed
    if (oldValue !== newValue) {
      const { logAthleteChange } = await import('../utils/audit-logger');
      await logAthleteChange(env, {
        tableName: 'parkrun_athletes',
        athleteIdentifier: athleteName,
        fieldName: 'is_hidden',
        oldValue,
        newValue,
        changeSource: 'manual_api',
        changeReason: 'Manual visibility toggle via admin UI',
      });
    }

    // Insert or update athlete record
    await env.DB.prepare(
      `INSERT INTO parkrun_athletes (athlete_name, is_hidden, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(athlete_name) DO UPDATE SET
         is_hidden = excluded.is_hidden,
         updated_at = excluded.updated_at`
    )
      .bind(athleteName, is_hidden ? 1 : 0, Math.floor(Date.now() / 1000))
      .run();

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Athlete visibility updated',
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (error) {
    console.error('Error updating parkrun athlete:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to update athlete',
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
