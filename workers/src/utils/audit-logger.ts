// Utility for logging athlete audit changes

import { Env } from '../types';

export type AuditTableName = 'parkrun_athletes' | 'athletes';
export type AuditChangeSource = 'manual_api' | 'individual_scraper' | 'club_scraper' | 'strava_sync' | 'system';

export interface AuditLogEntry {
  tableName: AuditTableName;
  athleteIdentifier: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  changeSource: AuditChangeSource;
  changeReason?: string;
  adminEmail?: string;
  metadata?: Record<string, any>;
}

/**
 * Log a change to an athlete record
 */
export async function logAthleteChange(
  env: Env,
  entry: AuditLogEntry
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO athlete_audit_log
     (table_name, athlete_identifier, field_name, old_value, new_value,
      changed_at, change_source, change_reason, admin_email, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      entry.tableName,
      entry.athleteIdentifier,
      entry.fieldName,
      entry.oldValue,
      entry.newValue,
      now,
      entry.changeSource,
      entry.changeReason || null,
      entry.adminEmail || null,
      entry.metadata ? JSON.stringify(entry.metadata) : null
    )
    .run();
}

/**
 * Log multiple changes in a batch (for efficiency)
 */
export async function logAthleteChanges(
  env: Env,
  entries: AuditLogEntry[]
): Promise<void> {
  if (entries.length === 0) return;

  const now = Math.floor(Date.now() / 1000);
  const statements: D1PreparedStatement[] = [];

  for (const entry of entries) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO athlete_audit_log
         (table_name, athlete_identifier, field_name, old_value, new_value,
          changed_at, change_source, change_reason, admin_email, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        entry.tableName,
        entry.athleteIdentifier,
        entry.fieldName,
        entry.oldValue,
        entry.newValue,
        now,
        entry.changeSource,
        entry.changeReason || null,
        entry.adminEmail || null,
        entry.metadata ? JSON.stringify(entry.metadata) : null
      )
    );
  }

  // D1 batch has a limit, process in chunks of 50
  const BATCH_SIZE = 50;
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    const batch = statements.slice(i, i + BATCH_SIZE);
    await env.DB.batch(batch);
  }
}

/**
 * Get audit history for a specific athlete
 */
export async function getAthleteAuditHistory(
  env: Env,
  tableName: AuditTableName,
  athleteIdentifier: string,
  limit: number = 100
): Promise<Array<{
  id: number;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: number;
  change_source: string;
  change_reason: string | null;
  admin_email: string | null;
  metadata: string | null;
}>> {
  const result = await env.DB.prepare(
    `SELECT id, field_name, old_value, new_value, changed_at, change_source, change_reason, admin_email, metadata
     FROM athlete_audit_log
     WHERE table_name = ? AND athlete_identifier = ?
     ORDER BY changed_at DESC
     LIMIT ?`
  )
    .bind(tableName, athleteIdentifier, limit)
    .all();

  return result.results || [];
}
