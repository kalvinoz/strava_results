// API endpoint for manually importing parkrun CSV data

import { Env } from '../types';

interface CSVRow {
  [key: string]: string;
}

// Australian state abbreviations for expanding short forms
const AU_STATE_ABBREVS: Record<string, string> = {
  'QLD': 'Queensland',
  'NSW': 'New South Wales',
  'VIC': 'Victoria',
  'SA': 'South Australia',
  'WA': 'Western Australia',
  'TAS': 'Tasmania',
  'NT': 'Northern Territory',
  'ACT': 'Australian Capital Territory',
};

interface ParkrunEvent {
  properties: {
    EventShortName: string;
    EventLongName: string;
    seriesid: number;
  };
}

interface EventsJSON {
  features: ParkrunEvent[];
}

/**
 * Normalize event long name by removing "parkrun" variations
 */
function normalizeEventLongName(longName: string): string {
  let normalized = longName;

  // Remove " parkrun," -> ","
  normalized = normalized.replace(/\s+parkrun,/gi, ',');

  // Remove " parkrun" at end
  normalized = normalized.replace(/\s+parkrun$/gi, '');

  // Remove "parkrun " at start (handles "parkrun de/du" prefixes)
  if (normalized.toLowerCase().startsWith('parkrun de ')) {
    normalized = normalized.substring(11);
  } else if (normalized.toLowerCase().startsWith('parkrun du ')) {
    normalized = normalized.substring(11);
  } else if (normalized.toLowerCase().startsWith('parkrun ')) {
    normalized = normalized.substring(8);
  }

  return normalized.trim();
}

/**
 * Expand Australian state abbreviations in event names
 */
function expandStateAbbreviation(name: string): string {
  for (const [abbrev, full] of Object.entries(AU_STATE_ABBREVS)) {
    const pattern = new RegExp(`\\s+${abbrev}$`, 'i');
    if (pattern.test(name)) {
      return name.replace(pattern, `, ${full}`);
    }
  }
  return name;
}

/**
 * Fetch parkrun events.json and refresh the event name mappings table
 */
async function refreshEventNameMappings(env: Env): Promise<{ updated: number; added: number }> {
  console.log('Refreshing event name mappings from parkrun events.json...');

  const response = await fetch('https://images.parkrun.com/events.json');
  if (!response.ok) {
    throw new Error(`Failed to fetch events.json: ${response.status}`);
  }

  const data = await response.json() as EventsJSON;

  if (!data.features || !Array.isArray(data.features)) {
    throw new Error('Invalid events.json format: missing features array');
  }

  let updated = 0;
  let added = 0;
  const seenFrom = new Set<string>();

  for (const event of data.features) {
    // Skip junior parkruns (seriesid 2)
    if (event.properties.seriesid === 2) {
      continue;
    }

    const shortName = event.properties.EventShortName;
    const longName = event.properties.EventLongName;

    if (!shortName || !longName) continue;

    // Skip duplicates
    if (seenFrom.has(shortName)) continue;
    seenFrom.add(shortName);

    // Normalize the long name
    const normalized = normalizeEventLongName(longName);

    // Also handle expanded state abbreviations
    const expandedShortName = expandStateAbbreviation(shortName);

    // Insert or update mapping
    const result = await env.DB.prepare(
      `INSERT INTO parkrun_event_name_mappings (from_name, to_name, notes)
       VALUES (?, ?, 'Auto-refreshed from events.json')
       ON CONFLICT(from_name) DO UPDATE SET
         to_name = excluded.to_name,
         notes = excluded.notes`
    ).bind(shortName, normalized).run();

    if (result.meta.changes > 0) {
      // Check if it was an insert or update
      const existing = await env.DB.prepare(
        `SELECT id FROM parkrun_event_name_mappings WHERE from_name = ?`
      ).bind(shortName).first();

      if (existing) {
        updated++;
      } else {
        added++;
      }
    }

    // Also add mapping for expanded state abbreviation if different
    if (expandedShortName !== shortName) {
      await env.DB.prepare(
        `INSERT INTO parkrun_event_name_mappings (from_name, to_name, notes)
         VALUES (?, ?, 'Auto-refreshed from events.json (state expanded)')
         ON CONFLICT(from_name) DO UPDATE SET
           to_name = excluded.to_name,
           notes = excluded.notes`
      ).bind(expandedShortName, normalized).run();
    }
  }

  console.log(`Mappings refreshed: ${added} added, ${updated} updated`);
  return { updated, added };
}

/**
 * Re-apply event name mappings to all parkrun results
 */
async function reapplyEventNameMappings(env: Env): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE parkrun_results
     SET event_name = (
       SELECT to_name
       FROM parkrun_event_name_mappings
       WHERE parkrun_event_name_mappings.from_name = parkrun_results.event_name
     )
     WHERE event_name IN (SELECT from_name FROM parkrun_event_name_mappings)`
  ).run();

  return result.meta.changes || 0;
}

/**
 * Delete results that have event names matching from_name in mappings table
 * These are unmapped/duplicate entries that should be cleaned up
 */
async function deleteUnmappedResults(env: Env): Promise<number> {
  const result = await env.DB.prepare(
    `DELETE FROM parkrun_results
     WHERE event_name IN (SELECT from_name FROM parkrun_event_name_mappings)`
  ).run();

  return result.meta.changes || 0;
}

/**
 * Detect runners with multiple activities on the same day (excluding Jan 1)
 */
async function detectDuplicateSameDayActivities(env: Env): Promise<Array<{ athlete_name: string; date: string; count: number }>> {
  const results = await env.DB.prepare(
    `SELECT athlete_name, date, COUNT(*) as count
     FROM parkrun_results
     WHERE date NOT LIKE '%-01-01'
     GROUP BY athlete_name, date
     HAVING COUNT(*) > 1
     ORDER BY date DESC, athlete_name
     LIMIT 100`
  ).all<{ athlete_name: string; date: string; count: number }>();

  return results.results || [];
}

/**
 * Parse time string (MM:SS or HH:MM:SS) to seconds
 */
function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

/**
 * POST /api/parkrun/import - Import parkrun results from CSV
 *
 * Expected CSV format from parkrun consolidated club results:
 * Date,Event,Pos,parkrunner,Parkrun ID,Time,Gender Pos,Age Grade,Age Cat
 */
export async function importParkrunCSV(request: Request, env: Env): Promise<Response> {
  try {
    // Check if we should replace existing data
    const url = new URL(request.url);
    const shouldReplace = url.searchParams.get('replace') === 'true';
    const firstBatch = url.searchParams.get('first_batch') === 'true'; // Only delete on first batch
    const dateFrom = url.searchParams.get('date_from'); // Optional: restrict delete to date range
    const dateTo = url.searchParams.get('date_to');

    const formData = await request.formData();
    const fileEntry = formData.get('file');

    if (!fileEntry || typeof fileEntry === 'string') {
      return new Response(
        JSON.stringify({ error: 'No file provided' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // At this point, fileEntry is guaranteed to be a File
    const file = fileEntry as File;
    const csvText = await file.text();
    const rows = parseCSV(csvText);

    let imported = 0;
    let skipped = 0;
    let errors = 0;
    let deleted = 0;

    // If replace mode AND first batch, handle deletion based on query params or CSV content
    // Only delete on the first batch to avoid wiping out previously imported batches
    if (shouldReplace && firstBatch) {
      let minDate: string | null = null;
      let maxDate: string | null = null;

      // Option 1: Use date range from query parameters (preferred for batch scraping)
      if (dateFrom && dateTo) {
        minDate = dateFrom;
        maxDate = dateTo;
      } else {
        // Option 2: Extract dates from CSV to determine the date range
        const dates: string[] = [];
        for (const row of rows) {
          const date = parseParkrunDate(row.Date || row.date);
          if (date) {
            dates.push(date);
          }
        }

        if (dates.length > 0) {
          minDate = dates.reduce((min, date) => date < min ? date : min, dates[0]);
          maxDate = dates.reduce((max, date) => date > max ? date : max, dates[0]);
        }
      }

      if (minDate && maxDate) {
        // Delete only club results within the specified date range (preserve individual results)
        // Include NULL data_source for backwards compatibility with old data
        const deleteResult = await env.DB.prepare(
          'DELETE FROM parkrun_results WHERE date >= ? AND date <= ? AND (data_source = ? OR data_source IS NULL)'
        ).bind(minDate, maxDate, 'club').run();
        deleted = deleteResult.meta.changes || 0;
        console.log(`Replace mode (first batch): Deleted ${deleted} club results between ${minDate} and ${maxDate}`);
      } else {
        // No date range specified and CSV is empty: Delete ALL club data (fallback for legacy usage)
        const deleteResult = await env.DB.prepare(
          'DELETE FROM parkrun_results WHERE data_source = ? OR data_source IS NULL'
        ).bind('club').run();
        deleted = deleteResult.meta.changes || 0;
        console.log(`Replace mode (first batch, no date range): Deleted all ${deleted} club results`);
      }
    }

    // Create sync log entry
    const syncStartTime = Math.floor(Date.now() / 1000);
    const syncLogResult = await env.DB.prepare(
      `INSERT INTO parkrun_sync_logs (sync_started_at, club_num, status)
       VALUES (?, ?, 'running')
       RETURNING id`
    )
      .bind(syncStartTime, 19959) // Woodstock club
      .first<{ id: number }>();

    const syncLogId = syncLogResult?.id;

    // Pre-load all event name mappings to avoid N+1 queries (one query per CSV row)
    const allMappings = await env.DB.prepare(
      `SELECT from_name, to_name FROM parkrun_event_name_mappings`
    ).all<{ from_name: string; to_name: string }>();

    const eventNameMappings = new Map<string, string>();
    for (const mapping of (allMappings.results || [])) {
      eventNameMappings.set(mapping.from_name, mapping.to_name);
    }

    try {
      for (const row of rows) {
        try {
          // Parse CSV row
          const date = parseParkrunDate(row.Date || row.date);
          let eventName = row.Event || row.event;
          const position = parseInt(row.Pos || row.pos || row.Position || '0');
          const genderPositionStr = row['Gender Pos'] || row.genderPos || row['gender pos'] || row.GenderPos || '';
          const genderPosition = genderPositionStr ? parseInt(genderPositionStr) : null;
          const athleteName = row.parkrunner || row.Parkrunner || row['Park Runner'];
          const parkrunId = row['Parkrun ID'] || row.parkrunId || row['parkrun id'] || row.ParkrunID || '';
          const timeString = row.Time || row.time;
          const ageGrade = row['Age Grade'] || row.ageGrade || row['age grade'];
          const ageCategory = row['Age Cat'] || row.ageCat || row['age cat'];

          if (!date || !eventName || !athleteName || !timeString) {
            console.warn('Skipping invalid row:', row);
            skipped++;
            continue;
          }

          // Normalize event name: remove " parkrun" from middle or end
          // Examples: "Albert parkrun, Melbourne" → "Albert, Melbourne"
          //          "Cooks River parkrun" → "Cooks River"
          eventName = eventName.replace(/\s+parkrun,/i, ','); // "Name parkrun, Location" → "Name, Location"
          eventName = eventName.replace(/\s+parkrun$/i, '');  // "Name parkrun" → "Name"
          eventName = eventName.trim();

          // Remove language-specific prefixes FIRST (e.g., "parkrun de/du Montsouris" → "Montsouris")
          // Must check these BEFORE "parkrun " to avoid leaving language prefix
          if (eventName.startsWith('parkrun de ')) {
            eventName = eventName.substring(11); // Remove "parkrun de " (11 characters)
          } else if (eventName.startsWith('parkrun du ')) {
            eventName = eventName.substring(11); // Remove "parkrun du " (11 characters)
          }
          // Remove "parkrun " prefix (e.g., "parkrun Ogród Saski, Lublin" → "Ogród Saski, Lublin")
          else if (eventName.startsWith('parkrun ')) {
            eventName = eventName.substring(8); // Remove "parkrun " (8 characters)
          }

          eventName = eventName.trim();

          // Apply database-driven event name mappings (using pre-loaded map)
          const mappedName = eventNameMappings.get(eventName);
          if (mappedName) {
            eventName = mappedName;
          }

          // Extract event number from event name (e.g., "Event name #123" -> 123)
          const eventNumberMatch = eventName.match(/#(\d+)/);
          const eventNumber = eventNumberMatch ? parseInt(eventNumberMatch[1]) : 0;

          const timeSeconds = parseTimeToSeconds(timeString);

          // Check if record exists with this parkrun_athlete_id
          const existing = parkrunId
            ? await env.DB.prepare(
                `SELECT id, data_source FROM parkrun_results
                 WHERE parkrun_athlete_id = ? AND event_name = ? AND date = ?`
              )
                .bind(parkrunId, eventName.replace(/#\d+/, '').trim(), date)
                .first<{ id: number; data_source: string | null }>()
            : null;

          if (existing) {
            // Update existing record - club data takes precedence (has gender_position)
            await env.DB.prepare(
              `UPDATE parkrun_results
               SET athlete_name = ?,
                   parkrun_athlete_id = ?,
                   event_number = ?,
                   position = ?,
                   gender_position = ?,
                   time_seconds = ?,
                   time_string = ?,
                   age_grade = ?,
                   age_category = ?,
                   club_name = ?,
                   data_source = 'club'
               WHERE id = ?`
            )
              .bind(
                athleteName,
                parkrunId || null,
                eventNumber,
                position,
                genderPosition,
                timeSeconds,
                timeString,
                ageGrade || null,
                ageCategory || null,
                'Woodstock',
                existing.id
              )
              .run();
            imported++;
          } else {
            // Insert new record
            await env.DB.prepare(
              `INSERT INTO parkrun_results
               (athlete_name, parkrun_athlete_id, event_name, event_number, position, gender_position, time_seconds,
                time_string, age_grade, age_category, date, club_name, data_source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'club')
               ON CONFLICT(athlete_name, event_name, event_number, date) DO UPDATE SET
                 parkrun_athlete_id = excluded.parkrun_athlete_id,
                 gender_position = excluded.gender_position,
                 age_category = excluded.age_category,
                 club_name = excluded.club_name,
                 data_source = 'club'`
            )
              .bind(
                athleteName,
                parkrunId || null,
                eventName.replace(/#\d+/, '').trim(), // Remove event number from name
                eventNumber,
                position,
                genderPosition,
                timeSeconds,
                timeString,
                ageGrade || null,
                ageCategory || null,
                date,
                'Woodstock'
              )
              .run();
            imported++;
          }
        } catch (error) {
          console.error('Error importing row:', error);
          errors++;
        }
      }

      // Update sync log
      const syncCompletedTime = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        `UPDATE parkrun_sync_logs
         SET sync_completed_at = ?,
             results_fetched = ?,
             new_results_added = ?,
             errors_encountered = ?,
             status = 'completed'
         WHERE id = ?`
      )
        .bind(
          syncCompletedTime,
          rows.length,
          imported,
          errors,
          syncLogId
        )
        .run();

      // Check for duplicate same-day activities (potential naming inconsistencies)
      const duplicates = await detectDuplicateSameDayActivities(env);
      let mappingsRefreshed = false;
      let mappingsUpdated = 0;
      let resultsRemapped = 0;
      let resultsDeleted = 0;

      if (duplicates.length > 0) {
        console.log(`Detected ${duplicates.length} runners with multiple activities on same day (excluding Jan 1)`);
        console.log('Refreshing event name mappings to resolve potential naming inconsistencies...');

        try {
          // Refresh mappings from parkrun events.json
          const { updated, added } = await refreshEventNameMappings(env);
          mappingsUpdated = updated + added;

          // Re-apply mappings to fix any naming issues
          resultsRemapped = await reapplyEventNameMappings(env);

          // Delete any remaining results with from_name values (duplicates)
          resultsDeleted = await deleteUnmappedResults(env);

          mappingsRefreshed = true;
          console.log(`Mappings refreshed: ${mappingsUpdated} mappings, ${resultsRemapped} results remapped, ${resultsDeleted} results deleted`);
        } catch (refreshError) {
          console.error('Failed to refresh event name mappings:', refreshError);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: shouldReplace ? 'Parkrun data replaced successfully' : 'Parkrun data imported successfully',
          imported,
          skipped,
          errors,
          total: rows.length,
          deleted: shouldReplace ? deleted : 0,
          duplicateSameDayDetected: duplicates.length,
          mappingsRefreshed,
          mappingsUpdated,
          resultsRemapped,
          resultsDeletedFromMapping: resultsDeleted,
          duplicateDetails: duplicates.slice(0, 10), // Return first 10 for debugging
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    } catch (error) {
      // Update sync log with failure
      await env.DB.prepare(
        `UPDATE parkrun_sync_logs
         SET status = 'failed',
             error_message = ?,
             results_fetched = ?,
             errors_encountered = ?
         WHERE id = ?`
      )
        .bind(
          error instanceof Error ? error.message : 'Unknown error',
          rows.length,
          errors + 1,
          syncLogId
        )
        .run();

      throw error;
    }
  } catch (error) {
    console.error('Error importing parkrun CSV:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to import parkrun data',
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
 * Parse CSV text into array of objects
 * Properly handles quoted fields with commas
 */
function parseCSV(csvText: string): CSVRow[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  // Parse header row
  const headers = parseCSVLine(lines[0]);
  const rows: CSVRow[] = [];

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: CSVRow = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });

    rows.push(row);
  }

  return rows;
}

/**
 * Parse a single CSV line, properly handling quoted fields
 * Handles: commas inside quotes, escaped quotes (""), and mixed quoted/unquoted fields
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote ("")
        current += '"';
        i += 2;
        continue;
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
        i++;
        continue;
      }
    }

    if (char === ',' && !inQuotes) {
      // End of field
      values.push(current.trim());
      current = '';
      i++;
      continue;
    }

    // Regular character
    current += char;
    i++;
  }

  // Push the last field
  values.push(current.trim());

  return values;
}

/**
 * Parse parkrun date format to ISO 8601
 * Parkrun typically uses DD/MM/YYYY format
 */
function parseParkrunDate(dateStr: string): string {
  if (!dateStr) return '';

  // Try DD/MM/YYYY format
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }

  // Try YYYY-MM-DD format (already ISO)
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return dateStr;
  }

  return dateStr;
}
