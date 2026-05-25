// API endpoint for importing individual athlete parkrun results

import { Env } from '../types';
import { stripAthleteIdSuffix, cleanupAthleteNames } from './parkrun-import';

interface CSVRow {
  [key: string]: string;
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
 * POST /api/parkrun/import-individual - Import individual athlete parkrun results from CSV
 *
 * Expected CSV format from individual athlete page:
 * Parkrun ID,parkrunner,Event,Date,Run Number,Pos,Time,Age Grade,PB,Data Source
 *
 * Note: Individual pages don't include gender position, only overall position
 */
export async function importIndividualParkrunCSV(request: Request, env: Env): Promise<Response> {
  try {
    const formData = await request.formData();
    const fileEntry = formData.get('file');
    const parkrunAthleteId = formData.get('parkrun_athlete_id');
    const athleteName = formData.get('athlete_name');

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

    if (!parkrunAthleteId || typeof parkrunAthleteId !== 'string') {
      return new Response(
        JSON.stringify({ error: 'parkrun_athlete_id is required' }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const file = fileEntry as File;
    const csvText = await file.text();
    const rows = parseCSV(csvText);

    let imported = 0;
    let duplicatesSkipped = 0;
    let errors = 0;

    const scrapeStartTime = Math.floor(Date.now() / 1000);

    try {
      // Fetch ALL event name mappings once (instead of per-row)
      const allMappings = await env.DB.prepare(
        `SELECT from_name, to_name FROM parkrun_event_name_mappings`
      ).all<{ from_name: string; to_name: string }>();

      const eventNameMap = new Map<string, string>();
      for (const mapping of (allMappings.results || [])) {
        eventNameMap.set(mapping.from_name, mapping.to_name);
      }

      // Pre-process all rows to get normalized event names and parsed data
      const processedRows: Array<{
        date: string;
        eventName: string;
        position: number;
        timeString: string;
        timeSeconds: number;
        ageGrade: string | null;
        runNumber: number;
        athleteName: string;
        parkrunId: string;
      }> = [];

      for (const row of rows) {
        // Parse CSV row
        const date = parseParkrunDate(row.Date || row.date);
        let eventName = row.Event || row.event;
        const position = parseInt(row.Pos || row.pos || row.Position || '0');
        const timeString = row.Time || row.time;
        const ageGrade = row['Age Grade'] || row.ageGrade || row['age grade'] || null;
        const runNumber = parseInt(row['Run Number'] || row.runNumber || row['run number'] || '0');

        // Get athlete info from row or form data; strip any " (A1234567)" suffix parkrun appends
        const rowAthleteName = stripAthleteIdSuffix((row.parkrunner || row.Parkrunner || athleteName || '') as string);
        const rowParkrunId = row['Parkrun ID'] || row.parkrunId || parkrunAthleteId;

        if (!date || !eventName || !timeString || !rowAthleteName) {
          console.warn('Skipping invalid row:', row);
          errors++;
          continue;
        }

        // Normalize event name: remove " parkrun" from middle or end
        eventName = eventName.replace(/\s+parkrun,/i, ',');
        eventName = eventName.replace(/\s+parkrun$/i, '');
        eventName = eventName.trim();

        // Remove language-specific prefixes FIRST (e.g., "parkrun de/du Montsouris" → "Montsouris")
        if (eventName.startsWith('parkrun de ')) {
          eventName = eventName.substring(11);
        } else if (eventName.startsWith('parkrun du ')) {
          eventName = eventName.substring(11);
        } else if (eventName.startsWith('parkrun ')) {
          eventName = eventName.substring(8);
        }

        eventName = eventName.trim();

        // Apply event name mapping from pre-fetched map
        const mappedName = eventNameMap.get(eventName);
        if (mappedName) {
          eventName = mappedName;
        }

        const timeSeconds = parseTimeToSeconds(timeString);

        processedRows.push({
          date,
          eventName,
          position,
          timeString,
          timeSeconds,
          ageGrade,
          runNumber,
          athleteName: rowAthleteName as string,
          parkrunId: rowParkrunId as string,
        });
      }

      // Batch check for existing results - build lookup keys
      // SQLite has a limit of ~999 variables
      // For existence check: 3 variables per row, so max ~330 rows
      // For inserts: 10 variables per statement, so max ~99 statements
      // Using 20 for existence checks (60 variables) and separate limit for inserts
      const EXISTENCE_BATCH_SIZE = 20;
      const STATEMENT_BATCH_SIZE = 50; // Each INSERT has 10 vars = 500 total
      const existingResults = new Map<string, { id: number; data_source: string | null; time_seconds: number }>();

      for (let i = 0; i < processedRows.length; i += EXISTENCE_BATCH_SIZE) {
        const batch = processedRows.slice(i, i + EXISTENCE_BATCH_SIZE);

        // Build query for this batch
        const placeholders = batch.map(() => '(parkrun_athlete_id = ? AND event_name = ? AND date = ?)').join(' OR ');
        const bindings: any[] = [];
        batch.forEach(row => {
          bindings.push(row.parkrunId, row.eventName, row.date);
        });

        const existingQuery = await env.DB.prepare(
          `SELECT id, parkrun_athlete_id, event_name, date, data_source, time_seconds
           FROM parkrun_results
           WHERE ${placeholders}`
        ).bind(...bindings).all<{ id: number; parkrun_athlete_id: string; event_name: string; date: string; data_source: string | null; time_seconds: number }>();

        for (const result of (existingQuery.results || [])) {
          const key = `${result.parkrun_athlete_id}|${result.event_name}|${result.date}`;
          existingResults.set(key, { id: result.id, data_source: result.data_source, time_seconds: result.time_seconds });
        }
      }

      // Now process rows with batched inserts/updates
      const insertStatements: D1PreparedStatement[] = [];
      const updateStatements: D1PreparedStatement[] = [];

      for (const row of processedRows) {
        const key = `${row.parkrunId}|${row.eventName}|${row.date}`;
        const existing = existingResults.get(key);

        if (existing) {
          // Row exists - handle based on data source
          if (existing.data_source === 'club' || existing.data_source === null) {
            // Club data exists - update parkrun_athlete_id but KEEP club data
            updateStatements.push(
              env.DB.prepare(
                `UPDATE parkrun_results
                 SET parkrun_athlete_id = ?,
                     age_grade = COALESCE(age_grade, ?)
                 WHERE id = ?`
              ).bind(row.parkrunId, row.ageGrade, existing.id)
            );
            imported++;
          } else if (existing.time_seconds === 0 && row.timeSeconds > 0) {
            // Existing individual row has bad time data (0 seconds) — overwrite with correct values
            updateStatements.push(
              env.DB.prepare(
                `UPDATE parkrun_results
                 SET time_seconds = ?, time_string = ?, position = ?, event_number = ?,
                     age_grade = ?, parkrun_athlete_id = ?
                 WHERE id = ?`
              ).bind(row.timeSeconds, row.timeString, row.position, row.runNumber,
                     row.ageGrade, row.parkrunId, existing.id)
            );
            imported++;
          } else {
            // Already exists with good data from individual scraping - skip
            duplicatesSkipped++;
          }
        } else {
          // New row - insert it
          insertStatements.push(
            env.DB.prepare(
              `INSERT INTO parkrun_results
               (athlete_name, parkrun_athlete_id, event_name, event_number, position,
                time_seconds, time_string, age_grade, date, data_source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'individual')`
            ).bind(
              row.athleteName,
              row.parkrunId,
              row.eventName,
              row.runNumber,
              row.position,
              row.timeSeconds,
              row.timeString,
              row.ageGrade,
              row.date
            )
          );
          imported++;
        }
      }

      // Execute batched statements
      const allStatements = [...insertStatements, ...updateStatements];

      // D1 batch has variable limits - INSERT has 10 vars each, UPDATE has 3
      // Using smaller batches to stay under SQLite's ~999 variable limit
      for (let i = 0; i < allStatements.length; i += STATEMENT_BATCH_SIZE) {
        const batch = allStatements.slice(i, i + STATEMENT_BATCH_SIZE);
        if (batch.length > 0) {
          await env.DB.batch(batch);
        }
      }

      // Update or create athlete scraping log
      const scrapeCompletedTime = Math.floor(Date.now() / 1000);

      await env.DB.prepare(
        `INSERT INTO parkrun_athlete_scraping_log
         (parkrun_athlete_id, athlete_name, last_scraped_at, scrape_count,
          total_results_found, new_results_added, status)
         VALUES (?, ?, ?, 1, ?, ?, 'success')
         ON CONFLICT(parkrun_athlete_id) DO UPDATE SET
           athlete_name = excluded.athlete_name,
           last_scraped_at = excluded.last_scraped_at,
           scrape_count = scrape_count + 1,
           total_results_found = excluded.total_results_found,
           new_results_added = excluded.new_results_added,
           status = 'success',
           error_message = NULL,
           updated_at = excluded.last_scraped_at`
      )
        .bind(
          parkrunAthleteId,
          athleteName || 'Unknown',
          scrapeCompletedTime,
          rows.length,
          imported
        )
        .run();

      // Check if athlete has left the club
      // Logic: If most recent individual run is > 2 weeks after most recent club run, they've left
      const athleteNameToUse = athleteName || 'Unknown';

      // Get most recent club run (data_source='club' or NULL for old data)
      const lastClubRun = await env.DB.prepare(
        `SELECT MAX(date) as last_date
         FROM parkrun_results
         WHERE athlete_name = ?
           AND (data_source = 'club' OR data_source IS NULL)
           AND parkrun_athlete_id = ?`
      )
        .bind(athleteNameToUse, parkrunAthleteId)
        .first<{ last_date: string | null }>();

      // Get most recent individual run
      const lastIndividualRun = await env.DB.prepare(
        `SELECT MAX(date) as last_date
         FROM parkrun_results
         WHERE athlete_name = ?
           AND data_source = 'individual'
           AND parkrun_athlete_id = ?`
      )
        .bind(athleteNameToUse, parkrunAthleteId)
        .first<{ last_date: string | null }>();

      let hasLeftClub = false;
      const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

      if (lastClubRun?.last_date && lastIndividualRun?.last_date) {
        const clubDate = new Date(lastClubRun.last_date).getTime();
        const individualDate = new Date(lastIndividualRun.last_date).getTime();

        // If individual runs are more than 2 weeks after last club run, they've left
        if (individualDate - clubDate > TWO_WEEKS_MS) {
          hasLeftClub = true;
        }
      }

      // Get existing status for audit log
      const existingAthlete = await env.DB.prepare(
        `SELECT has_left_club, is_hidden FROM parkrun_athletes WHERE athlete_name = ?`
      ).bind(athleteNameToUse).first<{ has_left_club: number | null; is_hidden: number | null }>();

      // Log changes if detected left club status changed
      if (hasLeftClub && (!existingAthlete || existingAthlete.has_left_club !== 1)) {
        const { logAthleteChanges } = await import('../utils/audit-logger');
        const auditEntries: any[] = [];

        auditEntries.push({
          tableName: 'parkrun_athletes' as const,
          athleteIdentifier: athleteNameToUse,
          fieldName: 'has_left_club',
          oldValue: existingAthlete?.has_left_club?.toString() || '0',
          newValue: '1',
          changeSource: 'individual_scraper' as const,
          changeReason: `Auto-detected: Last individual run (${lastIndividualRun?.last_date}) is >2 weeks after last club run (${lastClubRun?.last_date})`,
          metadata: {
            last_club_run_date: lastClubRun?.last_date,
            last_individual_run_date: lastIndividualRun?.last_date,
            parkrun_athlete_id: parkrunAthleteId,
          },
        });

        // Also log the auto-hide
        if (!existingAthlete || existingAthlete.is_hidden !== 1) {
          auditEntries.push({
            tableName: 'parkrun_athletes' as const,
            athleteIdentifier: athleteNameToUse,
            fieldName: 'is_hidden',
            oldValue: existingAthlete?.is_hidden?.toString() || '0',
            newValue: '1',
            changeSource: 'individual_scraper' as const,
            changeReason: 'Auto-hidden because athlete left club',
          });
        }

        await logAthleteChanges(env, auditEntries);
      }

      // Update parkrun_athletes table with dates, left status, and parkrun athlete ID
      await env.DB.prepare(
        `INSERT INTO parkrun_athletes
         (athlete_name, parkrun_athlete, has_left_club, last_club_run_date, last_individual_run_date,
          left_club_detected_at, is_hidden)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(athlete_name) DO UPDATE SET
           parkrun_athlete = excluded.parkrun_athlete,
           last_club_run_date = excluded.last_club_run_date,
           last_individual_run_date = excluded.last_individual_run_date,
           has_left_club = excluded.has_left_club,
           left_club_detected_at = excluded.left_club_detected_at,
           is_hidden = CASE
             WHEN excluded.has_left_club = 1 THEN 1
             ELSE is_hidden
           END,
           updated_at = strftime('%s', 'now')`
      )
        .bind(
          athleteNameToUse,
          parkrunAthleteId,
          hasLeftClub ? 1 : 0,
          lastClubRun?.last_date || null,
          lastIndividualRun?.last_date || null,
          hasLeftClub ? scrapeCompletedTime : null,
          hasLeftClub ? 1 : 0 // Auto-hide if they left
        )
        .run();

      // Clean up any athlete names with " (A<id>)" suffixes
      const nameCleanup = await cleanupAthleteNames(env);
      if (nameCleanup.namesFixed > 0) {
        console.log(`Cleaned up ${nameCleanup.namesFixed} athlete name(s) with ID suffixes:`, nameCleanup.athletesMerged);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Individual athlete parkrun data imported successfully',
          parkrun_athlete_id: parkrunAthleteId,
          athlete_name: athleteName,
          total_results: rows.length,
          new_results_added: imported,
          duplicates_skipped: duplicatesSkipped,
          errors,
          has_left_club: hasLeftClub,
          last_club_run_date: lastClubRun?.last_date || null,
          last_individual_run_date: lastIndividualRun?.last_date || null,
          athleteNameCleanup: {
            namesFixed: nameCleanup.namesFixed,
            resultsReattributed: nameCleanup.resultsReattributed,
            merged: nameCleanup.athletesMerged,
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
      // Update athlete scraping log with failure
      await env.DB.prepare(
        `INSERT INTO parkrun_athlete_scraping_log
         (parkrun_athlete_id, athlete_name, last_scraped_at, status, error_message)
         VALUES (?, ?, ?, 'failed', ?)
         ON CONFLICT(parkrun_athlete_id) DO UPDATE SET
           last_scraped_at = excluded.last_scraped_at,
           status = 'failed',
           error_message = excluded.error_message,
           updated_at = excluded.last_scraped_at`
      )
        .bind(
          parkrunAthleteId,
          athleteName || 'Unknown',
          Math.floor(Date.now() / 1000),
          error instanceof Error ? error.message : 'Unknown error'
        )
        .run();

      throw error;
    }

  } catch (error) {
    console.error('Error importing individual parkrun CSV:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to import individual parkrun data',
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
 */
function parseCSV(csvText: string): CSVRow[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows: CSVRow[] = [];

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
        current += '"';
        i += 2;
        continue;
      } else {
        inQuotes = !inQuotes;
        i++;
        continue;
      }
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      i++;
      continue;
    }

    current += char;
    i++;
  }

  values.push(current.trim());
  return values;
}

/**
 * Parse parkrun date format to ISO 8601
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
