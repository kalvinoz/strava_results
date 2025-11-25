// API Commands Configuration
// This file defines all available API commands for the Admin API Control Panel
// To add a new command, add an entry to the API_COMMANDS array below

export interface ApiParameter {
  name: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'date' | 'textarea' | 'json';
  label: string;
  placeholder?: string;
  required?: boolean;
  default?: any;
  options?: Array<{ value: string | number; label: string }>;
  description?: string;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

export interface ApiCommand {
  id: string;
  category: string;
  name: string;
  description: string;
  endpoint: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  parameters?: ApiParameter[];
  requiresAuth?: boolean;
  confirmMessage?: string;
  successMessage?: string;
  dangerous?: boolean;
}

export const API_COMMANDS: ApiCommand[] = [
  // ========================================
  // SYNC OPERATIONS
  // ========================================
  {
    id: 'sync-status',
    category: 'sync',
    name: 'Get Sync Status',
    description: 'View current sync status including active and recent syncs',
    endpoint: '/api/admin/sync-status',
    method: 'GET',
    successMessage: 'Sync status retrieved successfully',
  },
  {
    id: 'sync-all-athletes',
    category: 'sync',
    name: 'Sync All Athletes',
    description: 'Trigger sync for all athletes with optional date range',
    endpoint: '/api/admin/sync-all',
    method: 'POST',
    parameters: [
      {
        name: 'after_date',
        type: 'date',
        label: 'After Date (Optional)',
        placeholder: '2025-01-18',
        description: 'Only sync activities after this date (ISO format: YYYY-MM-DD)',
      },
      {
        name: 'before_date',
        type: 'date',
        label: 'Before Date (Optional)',
        placeholder: '2025-01-25',
        description: 'Only sync activities before this date (ISO format: YYYY-MM-DD)',
      },
    ],
    confirmMessage: 'This will trigger sync for all athletes. Continue?',
    successMessage: 'All athletes sync triggered successfully',
  },
  {
    id: 'sync-athlete',
    category: 'sync',
    name: 'Trigger Athlete Sync',
    description: 'Manually trigger a sync for a specific athlete',
    endpoint: '/api/admin/athletes/:athleteId/sync',
    method: 'POST',
    parameters: [
      {
        name: 'athleteId',
        type: 'number',
        label: 'Athlete ID',
        required: true,
        placeholder: '42',
        description: 'The athlete database ID (not Strava ID)',
      },
      {
        name: 'after_date',
        type: 'date',
        label: 'After Date (Optional)',
        placeholder: '2025-01-18',
        description: 'Only sync activities after this date (ISO format: YYYY-MM-DD)',
      },
      {
        name: 'before_date',
        type: 'date',
        label: 'Before Date (Optional)',
        placeholder: '2025-01-25',
        description: 'Only sync activities before this date (ISO format: YYYY-MM-DD)',
      },
    ],
    successMessage: 'Athlete sync triggered successfully',
  },

  // ========================================
  // EVENT MANAGEMENT
  // ========================================
  {
    id: 'analyze-events',
    category: 'events',
    name: 'Analyze Event Names',
    description: 'Use AI to analyze and standardize race event names',
    endpoint: '/api/event-suggestions/analyze',
    method: 'POST',
    confirmMessage: 'This will analyze all race names using AI. This may take time and use AI credits. Continue?',
    successMessage: 'Event analysis started successfully',
  },
  {
    id: 'event-stats',
    category: 'events',
    name: 'Get Event Statistics',
    description: 'View statistics about detected events and mappings',
    endpoint: '/api/events/stats',
    method: 'GET',
    successMessage: 'Event statistics retrieved successfully',
  },
  {
    id: 'rename-event',
    category: 'events',
    name: 'Rename Event',
    description: 'Rename an event across all activities',
    endpoint: '/api/events/rename',
    method: 'POST',
    parameters: [
      {
        name: 'oldName',
        type: 'text',
        label: 'Old Event Name',
        required: true,
        placeholder: 'parkrun',
        description: 'Current event name to rename',
      },
      {
        name: 'newName',
        type: 'text',
        label: 'New Event Name',
        required: true,
        placeholder: 'Parkrun',
        description: 'New event name',
      },
    ],
    confirmMessage: 'This will rename the event across all activities. Continue?',
    successMessage: 'Event renamed successfully',
  },

  // ========================================
  // RACE OPERATIONS
  // ========================================
  {
    id: 'backfill-polylines',
    category: 'races',
    name: 'Backfill Polylines',
    description: 'Download detailed polylines for races that are missing them',
    endpoint: '/api/polyline/backfill',
    method: 'POST',
    parameters: [
      {
        name: 'limit',
        type: 'number',
        label: 'Limit',
        default: 100,
        description: 'Maximum number of polylines to fetch',
        validation: { min: 1, max: 1000 },
      },
      {
        name: 'athleteId',
        type: 'number',
        label: 'Athlete ID (Optional)',
        placeholder: '42',
        description: 'Only backfill for specific athlete (leave empty for all)',
      },
    ],
    confirmMessage: 'This will fetch detailed polylines from Strava API. Continue?',
    successMessage: 'Polyline backfill started successfully',
  },
  {
    id: 'update-race-visibility',
    category: 'races',
    name: 'Update Race Visibility',
    description: 'Show or hide a specific race',
    endpoint: '/api/races/:raceId/visibility',
    method: 'PATCH',
    parameters: [
      {
        name: 'raceId',
        type: 'number',
        label: 'Race ID',
        required: true,
        placeholder: '12345',
        description: 'The race ID to update',
      },
      {
        name: 'is_hidden',
        type: 'checkbox',
        label: 'Hide Race',
        default: false,
        description: 'Check to hide race from public results',
      },
    ],
    successMessage: 'Race visibility updated successfully',
  },
  {
    id: 'bulk-hide-parkruns',
    category: 'races',
    name: 'Bulk Hide Parkruns',
    description: 'Hide all races with event name "parkrun"',
    endpoint: '/api/races/bulk-edit',
    method: 'POST',
    parameters: [
      {
        name: 'filters',
        type: 'json',
        label: 'Filters',
        default: '{"event_name": "parkrun"}',
        required: true,
        description: 'JSON filter to match races',
      },
      {
        name: 'updates',
        type: 'json',
        label: 'Updates',
        default: '{"is_hidden": true}',
        required: true,
        description: 'JSON updates to apply',
      },
    ],
    confirmMessage: 'This will hide all matching parkrun races. Continue?',
    successMessage: 'Bulk update completed successfully',
  },

  // ========================================
  // PARKRUN SPECIFIC
  // ========================================
  {
    id: 'parkrun-athletes-to-scrape',
    category: 'parkrun',
    name: 'View Athletes To Scrape',
    description: 'See list of athletes that need parkrun scraping',
    endpoint: '/api/parkrun/athletes-to-scrape',
    method: 'GET',
    parameters: [
      {
        name: 'mode',
        type: 'select',
        label: 'Mode',
        default: 'new',
        options: [
          { value: 'new', label: 'New Only' },
          { value: 'all', label: 'All Athletes' },
        ],
        description: 'Filter athletes',
      },
    ],
    successMessage: 'Athletes list retrieved successfully',
  },

  // ========================================
  // ADMIN OPERATIONS
  // ========================================
  // Note: Removed non-existent endpoints:
  // - GET /api/athletes/:stravaId (doesn't exist - use /api/admin/athletes instead)
  // - GET /api/admin/stats (doesn't exist)
  {
    id: 'update-athlete-status',
    category: 'admin',
    name: 'Update Athlete Status',
    description: 'Change athlete admin, hidden, or blocked status',
    endpoint: '/api/admin/athletes/:athleteId',
    method: 'PATCH',
    parameters: [
      {
        name: 'athleteId',
        type: 'number',
        label: 'Athlete ID',
        required: true,
        placeholder: '42',
        description: 'The athlete database ID (not Strava ID)',
      },
      {
        name: 'is_admin',
        type: 'checkbox',
        label: 'Admin',
        description: 'Grant admin privileges',
      },
      {
        name: 'is_hidden',
        type: 'checkbox',
        label: 'Hidden',
        description: 'Hide from public results',
      },
      {
        name: 'is_blocked',
        type: 'checkbox',
        label: 'Blocked',
        description: 'Block from registration',
      },
    ],
    confirmMessage: 'This will update athlete status. Continue?',
    successMessage: 'Athlete status updated successfully',
  },
];

export const API_CATEGORIES = [
  { id: 'sync', label: 'Sync Operations', description: 'Trigger and manage athlete syncs' },
  { id: 'events', label: 'Event Management', description: 'Analyze and manage event names' },
  { id: 'races', label: 'Race Operations', description: 'Manage race data and visibility' },
  { id: 'parkrun', label: 'Parkrun', description: 'Parkrun-specific operations' },
  { id: 'admin', label: 'Admin', description: 'Administrative operations' },
];
