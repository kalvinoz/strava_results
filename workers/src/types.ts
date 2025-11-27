// TypeScript type definitions for the application

export interface Env {
  DB: D1Database;
  AI: Ai;
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  STRAVA_REDIRECT_URI: string;
  STRAVA_CLUB_ID: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  PARKRUN_API_KEY: string;
}

export interface Athlete {
  id: number;
  strava_id: number;
  firstname: string;
  lastname: string;
  profile_photo?: string;
  access_token: string;
  refresh_token: string;
  token_expiry: number;
  created_at: number;
  updated_at: number;
  last_synced_at?: number;
  current_sync_step?: string;
  last_sync_type?: 'auto' | 'manual';
  sync_status?: string;
  sync_error?: string;
  total_activities_count?: number;
  race_count?: number;
  current_batch_number?: number;
  total_batches_expected?: number;
  sync_session_id?: string;
}

export interface Race {
  id: number;
  athlete_id: number;
  strava_activity_id: number;
  name: string;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  manual_time?: number;
  manual_distance?: number;
  event_name?: string;
  date: string;
  elevation_gain?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  polyline?: string;
  created_at: number;
  // Additional fields for API responses
  athlete_name?: string;
  athlete_strava_id?: number;
}

export interface EventSuggestion {
  id: number;
  race_ids: string; // JSON array
  suggested_event_name: string;
  avg_date: string;
  avg_distance: number;
  race_count: number;
  confidence: number;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_at?: string;
  reviewed_by?: number;
}

export interface StravaTokenResponse {
  token_type: string;
  expires_at: number;
  expires_in: number;
  refresh_token: string;
  access_token: string;
  athlete: StravaAthlete;
}

export interface StravaAthlete {
  id: number;
  firstname: string;
  lastname: string;
  profile: string;
  profile_medium?: string;
}

export interface StravaActivity {
  id: number;
  name: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  type: string;
  workout_type?: number; // 1 = Race
  start_date: string;
  start_date_local: string;
  timezone: string;
  total_elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  description?: string;
  private?: boolean; // True if activity is private
  map?: {
    id: string;
    summary_polyline?: string;
    resource_state: number;
  };
}

export interface RateLimitInfo {
  limit_15min: number;
  usage_15min: number;
  limit_daily: number;
  usage_daily: number;
}
