import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import './Admin.css';
import { ApiCommandCard } from '../components/ApiCommandCard';
import { API_COMMANDS, API_CATEGORIES } from '../config/apiCommands';
import { ReviewDashboard } from '../components/ReviewDashboard';

interface AdminAthlete {
  id: number;
  strava_id: number;
  firstname: string;
  lastname: string;
  profile_photo?: string;
  is_admin: number;
  is_hidden: number;
  is_blocked: number;
  sync_status: string;
  sync_error?: string;
  sync_session_id?: string;
  total_activities_count: number;
  last_synced_at?: number;
  created_at: number;
  race_count: number;
  current_sync_step?: string;
  last_sync_type?: 'auto' | 'manual';
  next_sync_at?: number;
  has_queued_sync?: boolean;
  syncProgress?: {
    total_activities_fetched: number;
    runs_filtered: number;
    races_filtered: number;
    new_races_added: number;
  };
}

interface ParkrunAthlete {
  athlete_name: string;
  id?: number;
  is_hidden: number;
  run_count: number;
  top_events?: Array<{ event_name: string; count: number }>;
  has_left_club?: number;
  last_club_run_date?: string | null;
  last_individual_run_date?: string | null;
  parkrun_athlete_id?: string | null;
}

interface EventSuggestion {
  id: number;
  race_ids: string;
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

interface EventStats {
  event_name: string;
  dates: string[];
  distances: string[];
  activity_count: number;
}

interface ManualSubmission {
  id: number;
  submission_session_id: string;
  strava_activity_id: number;
  strava_url: string;
  athlete_name: string;
  activity_name: string;
  activity_type: string;
  date: string;
  original_distance: number | null;
  original_time_seconds: number | null;
  original_elevation_gain: number | null;
  edited_distance: number | null;
  edited_time_seconds: number | null;
  edited_elevation_gain: number | null;
  event_name: string | null;
  status: string;
  submitted_at: number;
  processed_at: number | null;
  notes: string | null;
}

interface EditableSubmission extends ManualSubmission {
  edit_distance?: number | null;
  edit_time_string?: string;
  edit_event_name?: string | null;
}

interface SyncQueueJob {
  id: number | string;
  athlete_id: number;
  job_type: string;
  status: string;
  created_at?: number;
  started_at: number | null;
  completed_at: number | null;
  error_message: string | null;
  // New sync system fields
  total_activities_fetched: number;
  runs_filtered: number;
  races_filtered: number;
  new_races_added: number;
  // Legacy fields (kept for backwards compatibility)
  activities_synced?: number;
  total_activities_expected?: number | null;
  strava_id: number;
  first_name: string;
  last_name: string;
}

interface SyncQueueStatus {
  active: SyncQueueJob[];
  recent: SyncQueueJob[];
}

type SortField = 'name' | 'activities' | 'races' | 'runs';
type SortDirection = 'asc' | 'desc';

type ParkrunSortField = 'name' | 'runs' | 'events';
type ParkrunSortDirection = 'asc' | 'desc';

type AdminTab = 'athletes' | 'parkrun' | 'review' | 'events' | 'submissions' | 'api-control' | 'sync-dashboard';

type EventSortField = 'event_name' | 'activity_count' | 'dates' | 'distances';
type EventSortDirection = 'asc' | 'desc';

/**
 * Format time in seconds to HH:MM:SS
 */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Parse time string (HH:MM:SS or MM:SS) to seconds
 */
function parseTime(timeStr: string): number | null {
  const parts = timeStr.split(':').map(p => parseInt(p, 10));

  if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  }

  return null;
}

/**
 * Format date string to readable format
 */
function formatDateString(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function Admin() {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  // Get active tab from URL param or default to 'athletes'
  const activeTab: AdminTab = (tab as AdminTab) || 'athletes';

  // Function to change tabs by navigating to new URL
  const setActiveTab = (newTab: AdminTab) => {
    navigate(`/admin/${newTab}`);
  };

  const [athletes, setAthletes] = useState<AdminAthlete[]>([]);
  const [parkrunAthletes, setParkrunAthletes] = useState<ParkrunAthlete[]>([]);
  const [parkrunDuplicates, setParkrunDuplicates] = useState<Array<{
    athlete_name: string;
    date: string;
    activity_count: number;
    events: string;
  }>>([]);
  const [eventSuggestions, setEventSuggestions] = useState<EventSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<Set<number>>(new Set());
  const [analyzingEvents, setAnalyzingEvents] = useState(false);
  const [editingEventName, setEditingEventName] = useState<{ [key: number]: string }>({});
  const [showParkrunInstructions, setShowParkrunInstructions] = useState(false);
  const [showIndividualScraper, setShowIndividualScraper] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showCopiedMessage, setShowCopiedMessage] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState('');

  const handleRevealApiKey = () => {
    if (!showApiKey && apiKeyValue) {
      navigator.clipboard.writeText(apiKeyValue);
      setShowCopiedMessage(true);
      setTimeout(() => setShowCopiedMessage(false), 2000);
    }
    setShowApiKey(!showApiKey);
  };
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [parkrunSortField, setParkrunSortField] = useState<ParkrunSortField>('runs');
  const [parkrunSortDirection, setParkrunSortDirection] = useState<ParkrunSortDirection>('desc');
  const [parkrunPage, setParkrunPage] = useState(0);
  const [parkrunSearch, setParkrunSearch] = useState('');
  const [queueingAll, setQueueingAll] = useState(false);
  const [manualSubmissions, setManualSubmissions] = useState<EditableSubmission[]>([]);
  const [approvedSubmissions, setApprovedSubmissions] = useState<ManualSubmission[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [loadingApproved, setLoadingApproved] = useState(false);
  const [submissionEventNames, setSubmissionEventNames] = useState<string[]>([]);
  const [events, setEvents] = useState<EventStats[]>([]);
  const [editingEvent, setEditingEvent] = useState<string | null>(null);
  const [newEventName, setNewEventName] = useState('');
  const [eventSortField, setEventSortField] = useState<EventSortField>('activity_count');
  const [eventSortDirection, setEventSortDirection] = useState<EventSortDirection>('desc');
  const [eventSearch, setEventSearch] = useState('');
  const PARKRUN_PAGE_SIZE = 50;

  // API Control tab state
  const [apiSearch, setApiSearch] = useState('');
  const [apiCategory, setApiCategory] = useState<string>('all');

  // Sync Dashboard tab state
  const [syncQueueStatus, setSyncQueueStatus] = useState<SyncQueueStatus | null>(null);
  const [loadingSyncStatus, setLoadingSyncStatus] = useState(false);

  // Get admin strava ID from localStorage
  const currentAthleteId = parseInt(
    localStorage.getItem('strava_athlete_id') || '0'
  );

  // Redirect from /admin to /admin/athletes if no tab specified
  useEffect(() => {
    if (!tab) {
      navigate('/admin/athletes', { replace: true });
    }
  }, [tab, navigate]);

  useEffect(() => {
    fetchAthletes();
    fetchParkrunAthletes();
    fetchParkrunDuplicates();
    fetchEventSuggestions();
    fetchEvents();
    fetchManualSubmissions();
    fetchApprovedSubmissions();
    fetchSyncStatus();
    fetchApiKey();
  }, []);

  const fetchApiKey = async () => {
    try {
      const response = await fetch(
        `/api/admin/api-key?admin_strava_id=${currentAthleteId}`
      );
      if (response.ok) {
        const data = await response.json();
        setApiKeyValue(data.api_key || '');
      }
    } catch (err) {
      console.error('Failed to fetch API key:', err);
    }
  };

  // Auto-refresh sync status when on sync-dashboard tab
  useEffect(() => {
    if (activeTab === 'sync-dashboard') {
      fetchSyncStatus();
      const interval = setInterval(fetchSyncStatus, 10000); // Refresh every 10 seconds
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  const fetchAthletes = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/admin/athletes?admin_strava_id=${currentAthleteId}`
      );

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('You do not have admin access');
        }
        throw new Error('Failed to fetch athletes');
      }

      const data = await response.json();
      setAthletes(data.athletes);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch athletes');
    } finally {
      setLoading(false);
    }
  };

  const fetchParkrunAthletes = async () => {
    try {
      console.log('🔍 Fetching parkrun athletes from /api/parkrun/athletes');
      const response = await fetch('/api/parkrun/athletes');

      if (!response.ok) {
        console.error('❌ Parkrun athletes fetch failed:', response.status, response.statusText);
        throw new Error('Failed to fetch parkrun athletes');
      }

      const data = await response.json();
      console.log('✅ Parkrun athletes loaded:', data.athletes?.length || 0, 'athletes');
      if (data.athletes && data.athletes.length > 0) {
        console.log('Sample athlete:', data.athletes[0]);
      }
      setParkrunAthletes(data.athletes || []);
    } catch (err) {
      console.error('Error fetching parkrun athletes:', err);
    }
  };

  const fetchParkrunDuplicates = async () => {
    try {
      const response = await fetch('/api/parkrun/duplicates');

      if (!response.ok) {
        console.error('❌ Parkrun duplicates fetch failed:', response.status, response.statusText);
        return;
      }

      const data = await response.json();
      console.log('✅ Parkrun duplicates loaded:', data.count || 0, 'duplicates');
      setParkrunDuplicates(data.duplicates || []);
    } catch (err) {
      console.error('Error fetching parkrun duplicates:', err);
    }
  };

  const fetchEventSuggestions = async () => {
    try {
      // Fetch both pending and approved suggestions
      const [pendingResponse, approvedResponse] = await Promise.all([
        fetch(`/api/event-suggestions?admin_strava_id=${currentAthleteId}&status=pending`),
        fetch(`/api/event-suggestions?admin_strava_id=${currentAthleteId}&status=approved`)
      ]);

      if (!pendingResponse.ok || !approvedResponse.ok) {
        throw new Error('Failed to fetch event suggestions');
      }

      const [pendingData, approvedData] = await Promise.all([
        pendingResponse.json(),
        approvedResponse.json()
      ]);

      const allSuggestions = [
        ...(pendingData.suggestions || []),
        ...(approvedData.suggestions || [])
      ];

      // Deduplicate: keep only the highest confidence suggestion for each event name
      const uniqueSuggestions = Array.from(
        allSuggestions.reduce((map, suggestion) => {
          const existing = map.get(suggestion.suggested_event_name);
          if (!existing || suggestion.confidence > existing.confidence) {
            map.set(suggestion.suggested_event_name, suggestion);
          }
          return map;
        }, new Map<string, EventSuggestion>()).values()
      ) as EventSuggestion[];

      setEventSuggestions(uniqueSuggestions);
    } catch (err) {
      console.error('Error fetching event suggestions:', err);
    }
  };

  const fetchEvents = async () => {
    try {
      const response = await fetch('/api/events/stats');
      const data = await response.json();
      setEvents(data.events || []);
    } catch (error) {
      console.error('Failed to fetch events:', error);
    }
  };

  const fetchSyncStatus = async () => {
    try {
      setLoadingSyncStatus(true);
      const response = await fetch(`/api/admin/sync-status?admin_strava_id=${currentAthleteId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch sync status');
      }
      const data = await response.json();
      setSyncQueueStatus(data);
    } catch (err) {
      console.error('Error fetching sync status:', err);
    } finally {
      setLoadingSyncStatus(false);
    }
  };

  const stopSyncJob = async (syncId: number | string) => {
    try {
      const response = await fetch(`/api/admin/sync/stop?admin_strava_id=${currentAthleteId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sync_id: syncId }),
      });

      if (!response.ok) {
        throw new Error('Failed to stop sync');
      }

      // Refresh sync status
      await fetchSyncStatus();
      alert('Sync stopped successfully');
    } catch (err) {
      console.error('Error stopping sync:', err);
      alert('Failed to stop sync');
    }
  };

  const fetchManualSubmissions = async () => {
    setLoadingSubmissions(true);
    try {
      const [submissionsRes, eventsRes] = await Promise.all([
        fetch(`/api/admin/manual-submissions?admin_strava_id=${currentAthleteId}&status=pending`),
        fetch('/api/events/names')
      ]);

      if (!submissionsRes.ok) {
        throw new Error('Failed to fetch manual submissions');
      }

      const data = await submissionsRes.json();
      const submissions: EditableSubmission[] = (data.submissions || []).map((s: ManualSubmission) => ({
        ...s,
        edit_distance: s.edited_distance,
        edit_time_string: s.edited_time_seconds ? formatTime(s.edited_time_seconds) : '',
        edit_event_name: s.event_name
      }));
      setManualSubmissions(submissions);

      if (eventsRes.ok) {
        const eventsData = await eventsRes.json();
        setSubmissionEventNames(eventsData.eventNames || []);
      }
    } catch (err) {
      console.error('Error fetching manual submissions:', err);
    } finally {
      setLoadingSubmissions(false);
    }
  };

  const fetchApprovedSubmissions = async () => {
    setLoadingApproved(true);
    try {
      const response = await fetch(`/api/admin/manual-submissions?admin_strava_id=${currentAthleteId}&status=approved`);
      if (!response.ok) {
        throw new Error('Failed to fetch approved submissions');
      }
      const data = await response.json();
      setApprovedSubmissions(data.submissions || []);
    } catch (err) {
      console.error('Error fetching approved submissions:', err);
    } finally {
      setLoadingApproved(false);
    }
  };

  const updateSubmissionField = (index: number, updates: Partial<EditableSubmission>) => {
    const newSubmissions = [...manualSubmissions];
    newSubmissions[index] = { ...newSubmissions[index], ...updates };
    setManualSubmissions(newSubmissions);
  };

  const handleApproveSubmission = async (submissionId: number, submission: EditableSubmission) => {
    try {
      // First update the submission with edited values
      const editedTimeSeconds = submission.edit_time_string
        ? parseTime(submission.edit_time_string)
        : submission.edited_time_seconds;

      if (editedTimeSeconds === null && submission.edit_time_string) {
        alert('Invalid time format. Use HH:MM:SS');
        return;
      }

      await fetch(`/api/admin/manual-submissions/${submissionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_strava_id: currentAthleteId,
          edited_distance: submission.edit_distance,
          edited_time_seconds: editedTimeSeconds,
          event_name: submission.edit_event_name
        }),
      });

      // Then approve
      const response = await fetch(`/api/admin/manual-submissions/${submissionId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_strava_id: currentAthleteId }),
      });

      if (!response.ok) {
        throw new Error('Failed to approve submission');
      }

      fetchManualSubmissions();
      fetchApprovedSubmissions();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to approve submission');
    }
  };

  const handleRejectSubmission = async (submissionId: number) => {
    try {
      const response = await fetch(`/api/admin/manual-submissions/${submissionId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_strava_id: currentAthleteId }),
      });

      if (!response.ok) {
        throw new Error('Failed to reject submission');
      }

      fetchManualSubmissions();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reject submission');
    }
  };

  const handleDeleteSubmission = async (submissionId: number, activityName: string) => {
    const confirmed = confirm(
      `⚠️ WARNING: Delete approved submission?\n\n` +
      `Activity: ${activityName}\n\n` +
      `This will permanently delete the race from the dashboard.\n` +
      `This action CANNOT be undone.\n\n` +
      `Are you sure you want to proceed?`
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/manual-submissions/${submissionId}/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_strava_id: currentAthleteId }),
      });

      if (!response.ok) {
        throw new Error('Failed to delete submission');
      }

      alert('Submission deleted successfully.');
      fetchApprovedSubmissions();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete submission');
    }
  };

  const queueAllAthletes = async () => {
    setQueueingAll(true);
    try {
      const response = await fetch('/api/admin/sync-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_strava_id: currentAthleteId
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to trigger sync for all athletes');
      }

      const data = await response.json();
      alert(`✅ ${data.message}`);

      // Refresh athletes list
      await fetchAthletes();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to trigger sync for all athletes');
    } finally {
      setQueueingAll(false);
    }
  };

  const handleEventSuggestion = async (
    suggestionId: number,
    status: 'approved' | 'rejected',
    eventName?: string
  ) => {
    try {
      const response = await fetch(`/api/event-suggestions/${suggestionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          admin_strava_id: currentAthleteId,
          status,
          event_name: eventName,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${status} suggestion`);
      }

      // Remove from local state
      setEventSuggestions((prev) => prev.filter((s) => s.id !== suggestionId));

      // Clear any editing state
      setEditingEventName((prev) => {
        const newState = { ...prev };
        delete newState[suggestionId];
        return newState;
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : `Failed to ${status} suggestion`);
    }
  };

  const triggerEventAnalysis = async () => {
    setAnalyzingEvents(true);

    try {
      const response = await fetch('/api/event-suggestions/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_strava_id: currentAthleteId }),
      });

      if (!response.ok) {
        throw new Error('Failed to trigger event analysis');
      }

      alert(
        'Event analysis triggered successfully! New suggestions will appear shortly.'
      );

      // Refresh suggestions after a delay
      setTimeout(() => {
        fetchEventSuggestions();
        setAnalyzingEvents(false);
      }, 5000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to trigger event analysis');
      setAnalyzingEvents(false);
    }
  };

  const handleBulkHideEvent = async (eventName: string, activityCount: number) => {
    const confirmed = window.confirm(
      `Are you sure you want to hide all ${activityCount} activities for "${eventName}"?\n\nThis action will hide all activities with this event name. You can unhide them individually later if needed.`
    );

    if (!confirmed) return;

    try {
      const response = await fetch('/api/races/bulk-edit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          admin_strava_id: currentAthleteId,
          filters: {
            eventNames: [eventName],
          },
          updates: {
            is_hidden: true,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to hide activities');
      }

      const result = await response.json();
      alert(result.message);
      fetchEvents(); // Refresh the list
    } catch (error) {
      console.error('Error hiding activities:', error);
      alert(error instanceof Error ? error.message : 'Failed to hide activities');
    }
  };

  const handleEditEventName = (eventName: string) => {
    setEditingEvent(eventName);
    setNewEventName(eventName);
  };

  const handleSaveEventName = async (oldEventName: string) => {
    if (newEventName.trim() === oldEventName) {
      setEditingEvent(null);
      return;
    }

    if (!newEventName.trim()) {
      alert('Event name cannot be empty');
      return;
    }

    try {
      const response = await fetch('/api/events/rename', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          admin_strava_id: currentAthleteId,
          old_name: oldEventName,
          new_name: newEventName.trim(),
        }),
      });

      if (!response.ok) {
        // Try to parse error JSON, but handle empty response
        let errorMessage = 'Failed to rename event';
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
        } catch (parseError) {
          // If JSON parsing fails, use status text
          errorMessage = `Failed to rename event: ${response.status} ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      alert(result.message);
      setEditingEvent(null);
      fetchEvents(); // Refresh the list
    } catch (error) {
      console.error('Error renaming event:', error);
      alert(error instanceof Error ? error.message : 'Failed to rename event');
    }
  };

  const handleCancelEventEdit = () => {
    setEditingEvent(null);
    setNewEventName('');
  };

  const updateAthleteField = async (
    athleteId: number,
    field: 'is_admin' | 'is_hidden' | 'is_blocked',
    value: number
  ) => {
    // Check if user is trying to remove their own admin access
    const athlete = athletes.find((a) => a.id === athleteId);
    if (
      field === 'is_admin' &&
      value === 0 &&
      athlete?.strava_id === currentAthleteId
    ) {
      const confirmed = confirm(
        'If you remove your admin access, you will require another administrator to reinstate it. Are you sure you want to be removed as an admin?'
      );
      if (!confirmed) {
        return; // Cancel the operation
      }
    }

    try {
      const response = await fetch(
        `/api/admin/athletes/${athleteId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            admin_strava_id: currentAthleteId,
            [field]: value,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to update athlete`);
      }

      // Update local state
      setAthletes((prev) =>
        prev.map((a) => (a.id === athleteId ? { ...a, [field]: value } : a))
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update athlete');
    }
  };

  const deleteAthlete = async (stravaId: number, athleteName: string) => {
    if (
      !confirm(
        `Are you sure you want to delete ${athleteName}? This will remove all their data and races.`
      )
    ) {
      return;
    }

    try {
      const response = await fetch(
        `/api/admin/athletes/${stravaId}`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            admin_strava_id: currentAthleteId,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to delete athlete');
      }

      // Remove from local state
      setAthletes((prev) => prev.filter((a) => a.strava_id !== stravaId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete athlete');
    }
  };

  const triggerSync = async (stravaId: number) => {
    setSyncing((prev) => new Set(prev).add(stravaId));

    try {
      // Trigger manual sync for this athlete (using Strava ID)
      const response = await fetch(
        `/api/admin/athletes/${stravaId}/sync`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            admin_strava_id: currentAthleteId
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to trigger sync');
      }

      const data = await response.json();

      // Show success message
      const athlete = athletes.find(a => a.strava_id === stravaId);
      const athleteName = athlete ? `${athlete.firstname} ${athlete.lastname}` : `Athlete ${stravaId}`;
      alert(`✅ ${athleteName} sync triggered\n\n${data.message}`);

      // Refresh data to show updated state
      await fetchAthletes();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to trigger sync');
    } finally {
      setSyncing((prev) => {
        const newSet = new Set(prev);
        newSet.delete(stravaId);
        return newSet;
      });
    }
  };

  const formatCompactDate = (timestamp?: number) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp * 1000);
    const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    return (
      <div style={{ fontSize: '0.8rem', lineHeight: '1.2' }}>
        <div>{dateStr}</div>
        <div style={{ color: '#666' }}>{timeStr}</div>
      </div>
    );
  };

  const updateParkrunAthleteVisibility = async (
    athleteName: string,
    isHidden: boolean
  ) => {
    try {
      const response = await fetch(
        `/api/parkrun/athletes/${encodeURIComponent(athleteName)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_hidden: isHidden }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update parkrun athlete');
      }

      // Update local state
      setParkrunAthletes((prev) =>
        prev.map((a) =>
          a.athlete_name === athleteName ? { ...a, is_hidden: isHidden ? 1 : 0 } : a
        )
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update parkrun athlete');
    }
  };

  const getSyncStatusBadge = (athlete: AdminAthlete) => {
    const status = athlete.current_sync_step || 'idle';
    const lastSyncType = athlete.last_sync_type;

    // Determine status class based on current_sync_step
    let statusClass = '';
    let statusText = '';

    if (status === 'error') {
      statusClass = 'status-error';
      statusText = 'FAILED';
    } else if (status === 'completed') {
      statusClass = 'status-completed';
      statusText = '✓';
    } else if (status === 'idle') {
      statusClass = '';
      statusText = '';
    } else {
      statusClass = 'status-in-progress';
      statusText = status.replace(/_/g, ' ');
    }

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {statusText && (
          <span className={`status-badge ${statusClass}`}>
            {statusText}
          </span>
        )}
        {lastSyncType && athlete.last_synced_at && (
          <span
            className="sync-type-badge"
            title={lastSyncType === 'auto' ? 'Automatic sync' : 'Manual sync'}
            style={{
              fontSize: '0.75rem',
              padding: '0.125rem 0.25rem',
              borderRadius: '0.25rem',
              backgroundColor: '#e2e8f0',
              color: '#475569',
              cursor: 'help'
            }}
          >
            {lastSyncType === 'auto' ? 'A' : 'M'}
          </span>
        )}
      </div>
    );
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleParkrunSort = (field: ParkrunSortField) => {
    if (parkrunSortField === field) {
      setParkrunSortDirection(parkrunSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setParkrunSortField(field);
      setParkrunSortDirection('asc');
    }
  };

  const getSortIcon = (field: SortField | ParkrunSortField, currentField: SortField | ParkrunSortField, currentDirection: SortDirection | ParkrunSortDirection): React.ReactNode => {
    if (currentField !== field) return <i className="fa-solid fa-sort"></i>;
    return currentDirection === 'asc' ? <i className="fa-solid fa-sort-up"></i> : <i className="fa-solid fa-sort-down"></i>;
  };

  const sortedAthletes = [...athletes].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case 'name':
        comparison = `${a.firstname} ${a.lastname}`.localeCompare(`${b.firstname} ${b.lastname}`);
        break;
      case 'activities':
        comparison = a.total_activities_count - b.total_activities_count;
        break;
      case 'races':
        comparison = a.race_count - b.race_count;
        break;
      default:
        comparison = 0;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const sortedParkrunAthletes = [...parkrunAthletes].sort((a, b) => {
    let comparison = 0;
    switch (parkrunSortField) {
      case 'name':
        comparison = a.athlete_name.localeCompare(b.athlete_name);
        break;
      case 'runs':
        comparison = a.run_count - b.run_count;
        break;
      case 'events':
        const aEventCount = a.top_events?.length || 0;
        const bEventCount = b.top_events?.length || 0;
        comparison = aEventCount - bEventCount;
        break;
      default:
        comparison = 0;
    }
    return parkrunSortDirection === 'asc' ? comparison : -comparison;
  });

  // Filter parkrun athletes by search term
  const filteredParkrunAthletes = sortedParkrunAthletes.filter(athlete =>
    athlete.athlete_name.toLowerCase().includes(parkrunSearch.toLowerCase())
  );

  // Paginate parkrun athletes
  const paginatedParkrunAthletes = filteredParkrunAthletes.slice(
    parkrunPage * PARKRUN_PAGE_SIZE,
    (parkrunPage + 1) * PARKRUN_PAGE_SIZE
  );

  // Filter and sort events
  const filteredEvents = events.filter(event =>
    event.event_name.toLowerCase().includes(eventSearch.toLowerCase())
  );

  const sortedEvents = [...filteredEvents].sort((a, b) => {
    let comparison = 0;
    switch (eventSortField) {
      case 'event_name':
        comparison = a.event_name.localeCompare(b.event_name);
        break;
      case 'activity_count':
        comparison = a.activity_count - b.activity_count;
        break;
      case 'dates':
        // Sort by most recent date (first date in array)
        const aDate = a.dates.length > 0 ? new Date(a.dates[a.dates.length - 1]).getTime() : 0;
        const bDate = b.dates.length > 0 ? new Date(b.dates[b.dates.length - 1]).getTime() : 0;
        comparison = bDate - aDate;
        break;
      case 'distances':
        // Sort by number of unique distances
        comparison = a.distances.length - b.distances.length;
        break;
      default:
        comparison = 0;
    }
    return eventSortDirection === 'asc' ? comparison : -comparison;
  });

  const parkrunTotalPages = Math.ceil(filteredParkrunAthletes.length / PARKRUN_PAGE_SIZE);

  if (loading) {
    return (
      <div className="admin container">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading admin panel...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin container">
        <div className="error-message">
          <h2>Error</h2>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin container">
      <div className="admin-header">
        <h1>Admin Dashboard</h1>
        <p className="subtitle">Manage athletes and sync status</p>
      </div>

      {/* Tab Navigation */}
      <div className="admin-tabs">
        <button
          className={`admin-tab ${activeTab === 'athletes' ? 'active' : ''}`}
          onClick={() => setActiveTab('athletes')}
        >
          <i className="fa-solid fa-users"></i> Athletes & Sync
        </button>
        <button
          className={`admin-tab ${activeTab === 'parkrun' ? 'active' : ''}`}
          onClick={() => setActiveTab('parkrun')}
        >
          <i className="fa-solid fa-person-running"></i> Parkrun
        </button>
        <button
          className={`admin-tab ${activeTab === 'events' ? 'active' : ''}`}
          onClick={() => setActiveTab('events')}
        >
          <i className="fa-solid fa-calendar"></i> Events
        </button>
        <button
          className={`admin-tab ${activeTab === 'review' ? 'active' : ''}`}
          onClick={() => setActiveTab('review')}
        >
          <i className="fa-solid fa-circle-check"></i> Review
        </button>
        <button
          className={`admin-tab ${activeTab === 'submissions' ? 'active' : ''}`}
          onClick={() => setActiveTab('submissions')}
        >
          <i className="fa-solid fa-file-pen"></i> Manual Submissions {manualSubmissions.length > 0 && `(${manualSubmissions.length})`}
        </button>
        <button
          className={`admin-tab ${activeTab === 'api-control' ? 'active' : ''}`}
          onClick={() => setActiveTab('api-control')}
        >
          <i className="fa-solid fa-gear"></i> API Control
        </button>
        <button
          className={`admin-tab ${activeTab === 'sync-dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('sync-dashboard')}
        >
          <i className="fa-solid fa-rotate"></i> Sync Dashboard
        </button>
      </div>

      {/* Athletes & Sync Tab */}
      {activeTab === 'athletes' && (
        <div className="tab-content">
          <div className="admin-stats">
        <div className="stat-card">
          <div className="stat-value">{athletes.length}</div>
          <div className="stat-label">Total Athletes</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {athletes.filter((a) => a.is_admin === 1).length}
          </div>
          <div className="stat-label">Admins</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {athletes.filter((a) => a.is_hidden === 1).length}
          </div>
          <div className="stat-label">Hidden</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {athletes.filter((a) => a.is_blocked === 1).length}
          </div>
          <div className="stat-label">Blocked</div>
        </div>
      </div>

      <div className="admin-header" style={{ marginTop: '3rem' }}>
        <h2><i className="fa-solid fa-rotate"></i> Sync Queue</h2>
        <p className="subtitle">Reliable batched activity downloads using database queue</p>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <p style={{ marginBottom: '1rem', fontSize: '0.9rem', color: '#666' }}>
          The rotation queue syncs each athlete once per week, automatically adjusting to athlete count.
          Athletes are processed one at a time every 2 minutes.
        </p>

        <div style={{ marginTop: '1.5rem' }}>
          <button
            onClick={queueAllAthletes}
            disabled={queueingAll}
            className="button"
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#22c55e',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: queueingAll ? 'not-allowed' : 'pointer',
              fontWeight: 500,
              opacity: queueingAll ? 0.6 : 1,
            }}
          >
            {queueingAll ? <><i className="fa-solid fa-hourglass-half"></i> Syncing...</> : <><i className="fa-solid fa-rotate"></i> Sync All Athletes</>}
          </button>
          <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#666' }}>
            Trigger immediate sync for all athletes. Each will be processed according to the rotation queue.
          </p>
        </div>
      </div>

      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
                Athlete {getSortIcon('name', sortField, sortDirection)}
              </th>
              <th>Strava ID</th>
              <th>Sync Status</th>
              <th>Last Sync</th>
              <th>Next Sync</th>
              <th onClick={() => handleSort('activities')} style={{ cursor: 'pointer' }}>
                Activities {getSortIcon('activities', sortField, sortDirection)}
              </th>
              <th onClick={() => handleSort('races')} style={{ cursor: 'pointer' }}>
                Races {getSortIcon('races', sortField, sortDirection)}
              </th>
              <th>Admin</th>
              <th>Hidden</th>
              <th>Blocked</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedAthletes.map((athlete) => (
              <tr key={athlete.id}>
                <td>
                  <div className="athlete-cell">
                    {athlete.profile_photo && (
                      <img
                        src={athlete.profile_photo}
                        alt={`${athlete.firstname} ${athlete.lastname}`}
                        className="athlete-photo"
                      />
                    )}
                    <span>
                      {athlete.firstname} {athlete.lastname}
                    </span>
                  </div>
                </td>
                <td>
                  <a
                    href={`https://www.strava.com/athletes/${athlete.strava_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="strava-link"
                  >
                    {athlete.strava_id}
                  </a>
                </td>
                <td>
                  <div className="sync-status-cell">
                    {getSyncStatusBadge(athlete)}
                    {athlete.sync_error && (
                      <div className="sync-error" title={athlete.sync_error}>
                        <i className="fa-solid fa-triangle-exclamation"></i>
                      </div>
                    )}
                    {athlete.syncProgress && athlete.current_sync_step && athlete.current_sync_step !== 'idle' && athlete.current_sync_step !== 'completed' && athlete.current_sync_step !== 'error' && (
                      <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: '#64748b' }}>
                        {athlete.syncProgress.total_activities_fetched > 0 && `${athlete.syncProgress.total_activities_fetched} activities`}
                        {athlete.syncProgress.races_filtered > 0 && ` · ${athlete.syncProgress.races_filtered} races`}
                        {athlete.syncProgress.new_races_added > 0 && ` · ${athlete.syncProgress.new_races_added} new`}
                      </div>
                    )}
                  </div>
                </td>
                <td className="date-cell" style={{ fontSize: '0.8rem' }}>
                  {formatCompactDate(athlete.last_synced_at)}
                </td>
                <td className="date-cell" style={{ fontSize: '0.8rem' }}>
                  {athlete.next_sync_at ? formatCompactDate(athlete.next_sync_at) : '-'}
                </td>
                <td className="number-cell" style={{ fontSize: '0.85rem' }}>
                  {athlete.total_activities_count}
                  {athlete.syncProgress && athlete.current_sync_step && athlete.current_sync_step !== 'idle' && athlete.current_sync_step !== 'completed' && athlete.current_sync_step !== 'error' && (
                    <div style={{ fontSize: '0.7rem', color: '#0ea5e9' }}>
                      +{athlete.syncProgress.total_activities_fetched}
                    </div>
                  )}
                </td>
                <td className="number-cell" style={{ fontSize: '0.85rem' }}>
                  {athlete.race_count}
                  {athlete.syncProgress && athlete.current_sync_step && athlete.current_sync_step !== 'idle' && athlete.current_sync_step !== 'completed' && athlete.current_sync_step !== 'error' && athlete.syncProgress.new_races_added > 0 && (
                    <div style={{ fontSize: '0.7rem', color: '#22c55e' }}>
                      +{athlete.syncProgress.new_races_added}
                    </div>
                  )}
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={athlete.is_admin === 1}
                    onChange={(e) =>
                      updateAthleteField(
                        athlete.id,
                        'is_admin',
                        e.target.checked ? 1 : 0
                      )
                    }
                    className="checkbox"
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={athlete.is_hidden === 1}
                    onChange={(e) =>
                      updateAthleteField(
                        athlete.id,
                        'is_hidden',
                        e.target.checked ? 1 : 0
                      )
                    }
                    className="checkbox"
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={athlete.is_blocked === 1}
                    onChange={(e) =>
                      updateAthleteField(
                        athlete.id,
                        'is_blocked',
                        e.target.checked ? 1 : 0
                      )
                    }
                    className="checkbox"
                  />
                </td>
                <td>
                  <div className="action-buttons" style={{ gap: '0.25rem', justifyContent: 'center' }}>
                    <button
                      onClick={() => triggerSync(athlete.strava_id)}
                      disabled={syncing.has(athlete.strava_id) || athlete.has_queued_sync}
                      className="button button-sync"
                      title={athlete.has_queued_sync ? 'Sync queued/in progress' : 'Sync now'}
                      style={{ padding: '0.4rem 0.6rem', fontSize: '0.9rem' }}
                    >
                      <i className="fa-solid fa-rotate"></i>
                    </button>
                    <button
                      onClick={() =>
                        deleteAthlete(
                          athlete.strava_id,
                          `${athlete.firstname} ${athlete.lastname}`
                        )
                      }
                      className="button button-delete"
                      title="Delete athlete and all data"
                      style={{ padding: '0.4rem 0.6rem', fontSize: '0.9rem' }}
                    >
                      <i className="fa-solid fa-trash"></i>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
        </div>
      )}

      {/* Events Management Tab */}
      {activeTab === 'events' && (
        <div className="tab-content">
          <div className="admin-header">
            <h2>Events Management</h2>
            <p className="subtitle">Manage event names, dates, distances, and bulk operations</p>
          </div>

          {loading ? (
            <div className="loading">
              <div className="spinner"></div>
              <p>Loading events...</p>
            </div>
          ) : (
            <>
              {/* Search bar */}
              <div style={{ marginBottom: '1.5rem' }}>
                <input
                  type="text"
                  placeholder="Search events by name..."
                  value={eventSearch}
                  onChange={(e) => setEventSearch(e.target.value)}
                  style={{
                    width: '100%',
                    maxWidth: '400px',
                    padding: '0.75rem',
                    fontSize: '1rem',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                  }}
                />
                {eventSearch && (
                  <span style={{ marginLeft: '1rem', color: '#666' }}>
                    {filteredEvents.length} of {events.length} events
                  </span>
                )}
              </div>

              {sortedEvents.length === 0 ? (
                <div className="empty-state">
                  <p>{eventSearch ? 'No events match your search' : 'No events found'}</p>
                </div>
              ) : (
                <div className="admin-table-container">
                  <table className="admin-table">
                <thead>
                  <tr>
                    <th
                      onClick={() => {
                        if (eventSortField === 'event_name') {
                          setEventSortDirection(eventSortDirection === 'asc' ? 'desc' : 'asc');
                        } else {
                          setEventSortField('event_name');
                          setEventSortDirection('asc');
                        }
                      }}
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                    >
                      Event Name {eventSortField === 'event_name' && (eventSortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th
                      onClick={() => {
                        if (eventSortField === 'activity_count') {
                          setEventSortDirection(eventSortDirection === 'asc' ? 'desc' : 'asc');
                        } else {
                          setEventSortField('activity_count');
                          setEventSortDirection('desc');
                        }
                      }}
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                    >
                      Activities {eventSortField === 'activity_count' && (eventSortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th
                      onClick={() => {
                        if (eventSortField === 'dates') {
                          setEventSortDirection(eventSortDirection === 'asc' ? 'desc' : 'asc');
                        } else {
                          setEventSortField('dates');
                          setEventSortDirection('desc');
                        }
                      }}
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                    >
                      Dates {eventSortField === 'dates' && (eventSortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th
                      onClick={() => {
                        if (eventSortField === 'distances') {
                          setEventSortDirection(eventSortDirection === 'asc' ? 'desc' : 'asc');
                        } else {
                          setEventSortField('distances');
                          setEventSortDirection('asc');
                        }
                      }}
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                    >
                      Distances {eventSortField === 'distances' && (eventSortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedEvents.map((event) => (
                    <tr key={event.event_name}>
                      <td>
                        {editingEvent === event.event_name ? (
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <input
                              type="text"
                              value={newEventName}
                              onChange={(e) => setNewEventName(e.target.value)}
                              style={{
                                padding: '0.5rem',
                                border: '1px solid #ccc',
                                borderRadius: '4px',
                                fontSize: '14px',
                                flex: 1,
                              }}
                              autoFocus
                            />
                            <button
                              onClick={() => handleSaveEventName(event.event_name)}
                              style={{
                                padding: '0.5rem 1rem',
                                backgroundColor: '#fc4c02',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '14px',
                              }}
                            >
                              Save
                            </button>
                            <button
                              onClick={handleCancelEventEdit}
                              style={{
                                padding: '0.5rem 1rem',
                                backgroundColor: '#6c757d',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '14px',
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <Link
                            to={(() => {
                              // Build URL with event name and date range
                              const params = new URLSearchParams();
                              params.set('events', event.event_name);

                              // Add date range from event dates
                              if (event.dates.length > 0) {
                                const sortedDates = [...event.dates].sort();
                                params.set('dateFrom', sortedDates[0]);
                                params.set('dateTo', sortedDates[sortedDates.length - 1]);
                              }

                              return `/dashboard?${params.toString()}`;
                            })()}
                            style={{
                              color: '#fc4c02',
                              fontWeight: 'bold',
                              textDecoration: 'none',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.textDecoration = 'underline'}
                            onMouseLeave={(e) => e.currentTarget.style.textDecoration = 'none'}
                          >
                            {event.event_name}
                          </Link>
                        )}
                      </td>
                      <td className="number-cell">{event.activity_count}</td>
                      <td>
                        <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                          {[...event.dates].sort().reverse().map((date, idx) => (
                            <div key={idx}>
                              <Link
                                to={`/dashboard?eventNames=${encodeURIComponent(event.event_name)}&dateFrom=${date}&dateTo=${date}`}
                                style={{
                                  color: '#fc4c02',
                                  textDecoration: 'none',
                                }}
                              >
                                {formatDateString(date)}
                              </Link>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
                          {event.distances.map((distance, idx) => (
                            <div key={idx}>
                              <Link
                                to={`/dashboard?eventNames=${encodeURIComponent(event.event_name)}&distanceCategories=${encodeURIComponent(distance)}`}
                                style={{
                                  color: '#fc4c02',
                                  textDecoration: 'none',
                                }}
                              >
                                {distance}
                              </Link>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {editingEvent !== event.event_name && (
                            <>
                              <button
                                onClick={() => handleEditEventName(event.event_name)}
                                style={{
                                  padding: '0.5rem 1rem',
                                  backgroundColor: '#007bff',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  fontSize: '14px',
                                }}
                              >
                                Rename
                              </button>
                              <button
                                onClick={() => handleBulkHideEvent(event.event_name, event.activity_count)}
                                style={{
                                  padding: '0.5rem 1rem',
                                  backgroundColor: '#dc3545',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  fontSize: '14px',
                                }}
                              >
                                Hide All
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Review Dashboard Tab */}
      {activeTab === 'review' && (
        <div className="tab-content">
          <ReviewDashboard adminStravaId={currentAthleteId} />
        </div>
      )}

      {/* OLD: AI Event Suggestions Tab - DEPRECATED, to be removed */}
      {false && (
        <div className="tab-content">
          <div className="admin-header">
            <h2>AI Event Classification</h2>
            <p className="subtitle">Review and approve AI-generated event name suggestions</p>
          </div>

      <div style={{ marginBottom: '2rem' }}>
        <button
          onClick={triggerEventAnalysis}
          disabled={analyzingEvents}
          className="button"
          style={{
            padding: '0.75rem 1.5rem',
            backgroundColor: '#0ea5e9',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: analyzingEvents ? 'not-allowed' : 'pointer',
            fontWeight: 500,
            opacity: analyzingEvents ? 0.6 : 1,
          }}
        >
          {analyzingEvents ? <><i className="fa-solid fa-spinner fa-spin"></i> Analyzing...</> : <><i className="fa-solid fa-robot"></i> Run AI Analysis</>}
        </button>
        <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
          Trigger AI to analyze ungrouped races and generate event name suggestions. This may take a few minutes.
        </p>
      </div>

      {eventSuggestions.length > 0 ? (
        <>
          {eventSuggestions.filter(s => s.status === 'pending').length > 0 && (
            <>
              <h3 style={{ marginTop: '2rem', marginBottom: '1rem', fontSize: '1.1rem' }}>
                Pending Suggestions
              </h3>
              <div className="admin-table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Suggested Event Name</th>
                      <th>Date</th>
                      <th>Distance</th>
                      <th>Races</th>
                      <th>Confidence</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventSuggestions.filter(s => s.status === 'pending').map((suggestion) => {
                const isEditing = suggestion.id in editingEventName;
                const editedName = isEditing
                  ? editingEventName[suggestion.id]
                  : suggestion.suggested_event_name;

                return (
                  <tr key={suggestion.id}>
                    <td>
                      {isEditing ? (
                        <input
                          type="text"
                          value={editedName}
                          onChange={(e) =>
                            setEditingEventName((prev) => ({
                              ...prev,
                              [suggestion.id]: e.target.value,
                            }))
                          }
                          style={{
                            width: '100%',
                            padding: '0.5rem',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            fontSize: '0.9rem',
                          }}
                        />
                      ) : (
                        <strong>{suggestion.suggested_event_name}</strong>
                      )}
                    </td>
                    <td>{new Date(suggestion.avg_date).toLocaleDateString()}</td>
                    <td>{(suggestion.avg_distance / 1000).toFixed(1)} km</td>
                    <td className="number-cell">{suggestion.race_count}</td>
                    <td>
                      <span
                        className="status-badge"
                        style={{
                          backgroundColor:
                            suggestion.confidence >= 0.8
                              ? '#22c55e'
                              : suggestion.confidence >= 0.5
                              ? '#f59e0b'
                              : '#ef4444',
                          color: 'white',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                        }}
                      >
                        {(suggestion.confidence * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td>
                      <div className="action-buttons" style={{ gap: '0.5rem' }}>
                        {isEditing ? (
                          <>
                            <button
                              onClick={() =>
                                handleEventSuggestion(
                                  suggestion.id,
                                  'approved',
                                  editedName
                                )
                              }
                              className="button"
                              style={{
                                padding: '0.5rem 1rem',
                                backgroundColor: '#22c55e',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                              }}
                              title="Save and approve"
                            >
                              <i className="fa-solid fa-floppy-disk"></i> Save
                            </button>
                            <button
                              onClick={() =>
                                setEditingEventName((prev) => {
                                  const newState = { ...prev };
                                  delete newState[suggestion.id];
                                  return newState;
                                })
                              }
                              className="button"
                              style={{
                                padding: '0.5rem 1rem',
                                backgroundColor: '#6b7280',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                              }}
                              title="Cancel editing"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() =>
                                handleEventSuggestion(suggestion.id, 'approved')
                              }
                              className="button"
                              style={{
                                padding: '0.5rem 1rem',
                                backgroundColor: '#22c55e',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                              }}
                              title="Approve suggestion"
                            >
                              <i className="fa-solid fa-check"></i> Approve
                            </button>
                            <button
                              onClick={() =>
                                setEditingEventName((prev) => ({
                                  ...prev,
                                  [suggestion.id]: suggestion.suggested_event_name,
                                }))
                              }
                              className="button"
                              style={{
                                padding: '0.5rem 1rem',
                                backgroundColor: '#0ea5e9',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '0.85rem',
                              }}
                              title="Edit event name"
                            >
                              <i className="fa-solid fa-pen"></i> Edit
                            </button>
                            <button
                              onClick={() =>
                                handleEventSuggestion(suggestion.id, 'rejected')
                              }
                              className="button button-delete"
                              style={{
                                padding: '0.5rem 1rem',
                                fontSize: '0.85rem',
                              }}
                              title="Reject suggestion"
                            >
                              <i className="fa-solid fa-xmark"></i> Reject
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {eventSuggestions.filter(s => s.status === 'approved').length > 0 && (
            <>
              <h3 style={{ marginTop: '2rem', marginBottom: '1rem', fontSize: '1.1rem' }}>
                Approved Suggestions
              </h3>
              <div className="admin-table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Event Name</th>
                      <th>Date</th>
                      <th>Distance</th>
                      <th>Races</th>
                      <th>Confidence</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eventSuggestions.filter(s => s.status === 'approved').map((suggestion) => (
                      <tr key={suggestion.id}>
                        <td>
                          <strong>{suggestion.suggested_event_name}</strong>
                        </td>
                        <td>{new Date(suggestion.avg_date).toLocaleDateString()}</td>
                        <td>{(suggestion.avg_distance / 1000).toFixed(1)} km</td>
                        <td className="number-cell">{suggestion.race_count}</td>
                        <td>
                          <span
                            className="status-badge"
                            style={{
                              backgroundColor: '#22c55e',
                              color: 'white',
                              padding: '0.25rem 0.5rem',
                              borderRadius: '4px',
                              fontSize: '0.85rem',
                            }}
                          >
                            {(suggestion.confidence * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td>
                          <button
                            onClick={() => handleEventSuggestion(suggestion.id, 'rejected')}
                            className="button"
                            style={{
                              padding: '0.5rem 1rem',
                              backgroundColor: '#ef4444',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.85rem',
                            }}
                            title="Revoke approval and remove event name from races"
                          >
                            <i className="fa-solid fa-rotate"></i> Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      ) : (
        <div
          style={{
            padding: '2rem',
            textAlign: 'center',
            backgroundColor: '#f9fafb',
            borderRadius: '8px',
            color: '#6b7280',
          }}
        >
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            No pending event suggestions. Click "Run AI Analysis" to generate new suggestions.
          </p>
        </div>
      )}
        </div>
      )}

      {/* Parkrun Tab */}
      {activeTab === 'parkrun' && (
        <div className="tab-content">
          {/* Alert for duplicate same-day activities */}
          {parkrunDuplicates.length > 0 && (
            <div style={{
              marginBottom: '2rem',
              backgroundColor: '#fef3c7',
              borderRadius: '8px',
              border: '2px solid #f59e0b',
              padding: '1rem 1.5rem',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '0.75rem',
              }}>
                <span style={{ fontSize: '1.2rem' }}><i className="fa-solid fa-triangle-exclamation"></i></span>
                <strong style={{ color: '#92400e' }}>
                  {parkrunDuplicates.length} runner{parkrunDuplicates.length !== 1 ? 's' : ''} with multiple activities on the same day
                </strong>
              </div>
              <p style={{
                fontSize: '0.85rem',
                color: '#92400e',
                margin: '0 0 0.75rem 0',
              }}>
                These may indicate duplicate entries due to event name mismatches. Click to view filtered results.
              </p>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                maxHeight: '200px',
                overflowY: 'auto',
              }}>
                {parkrunDuplicates.map((dup, index) => (
                  <a
                    key={index}
                    href={`/parkrun?athletes=${encodeURIComponent(dup.athlete_name)}&dateFrom=${dup.date}&dateTo=${dup.date}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.5rem 0.75rem',
                      backgroundColor: 'white',
                      borderRadius: '4px',
                      textDecoration: 'none',
                      color: '#92400e',
                      fontSize: '0.85rem',
                      border: '1px solid #fcd34d',
                    }}
                  >
                    <span>
                      <strong>{dup.athlete_name}</strong> on {dup.date}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#b45309' }}>
                      {dup.activity_count} activities: {dup.events}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="admin-header">
            <h2>Parkrun Data Scrapers</h2>
            <p className="subtitle">Use Tampermonkey userscripts to scrape parkrun data</p>
          </div>

      {/* Club Results Tampermonkey Scraper */}
      <div style={{
        marginBottom: '2rem',
        backgroundColor: '#f0fdf4',
        borderRadius: '8px',
        border: '2px solid #10b981',
        overflow: 'hidden',
      }}>
        <button
          onClick={() => setShowParkrunInstructions(!showParkrunInstructions)}
          style={{
            width: '100%',
            padding: '1rem 1.5rem',
            backgroundColor: 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '1rem',
            fontWeight: 700,
            color: '#065f46',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <i className="fa-solid fa-person-running"></i> Club Results Scraper
          </span>
          <span style={{ fontSize: '1.2rem' }}>
            {showParkrunInstructions ? <i className="fa-solid fa-chevron-down"></i> : <i className="fa-solid fa-chevron-right"></i>}
          </span>
        </button>

        {showParkrunInstructions && (
          <div style={{ padding: '0 1.5rem 1.5rem 1.5rem' }}>
            <p style={{
              fontSize: '0.9rem',
              color: '#047857',
              lineHeight: '1.6',
              marginBottom: '1rem',
            }}>
              Scrape Woodstock Runners club results for any date range with a floating green button.
            </p>

            <div style={{
              backgroundColor: 'white',
              padding: '1rem',
              borderRadius: '6px',
              marginBottom: '1rem',
              border: '1px solid #10b981',
            }}>
              <p style={{
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#065f46',
                marginBottom: '0.5rem',
              }}>
                <i className="fa-solid fa-clipboard"></i> Installation:
              </p>
              <ol style={{
                fontSize: '0.85rem',
                color: '#047857',
                margin: '0',
                paddingLeft: '1.5rem',
                lineHeight: '1.8',
              }}>
                <li>Install <a
                  href="https://www.tampermonkey.net/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#2563eb', textDecoration: 'underline' }}
                >Tampermonkey browser extension</a></li>
                <li>Click the button below to download the userscript</li>
                <li>Tampermonkey will prompt you to install it</li>
                <li>Visit the <a
                  href="https://www.parkrun.com/results/consolidatedclub/?clubNum=19959"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#2563eb', textDecoration: 'underline' }}
                >Woodstock Runners parkrun page</a></li>
                <li>Click the green "🏃 Scrape Club Results" button that appears</li>
                <li>Enter your start/end dates and the script will automatically scrape!</li>
              </ol>
            </div>

            <div style={{
              backgroundColor: 'white',
              padding: '1rem',
              borderRadius: '6px',
              marginBottom: '1rem',
              border: '1px solid #10b981',
            }}>
              <p style={{
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#065f46',
                marginBottom: '0.5rem',
              }}>
                <i className="fa-solid fa-key"></i> API Key:
              </p>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.85rem',
                color: '#047857',
              }}>
                {apiKeyValue ? (
                  <>
                    <span style={{ fontFamily: 'monospace', position: 'relative' }}>
                      {showApiKey ? apiKeyValue : '••••••••••••••••'}
                      {showCopiedMessage && (
                        <span style={{
                          position: 'absolute',
                          top: '-1.5rem',
                          left: '0',
                          backgroundColor: '#065f46',
                          color: 'white',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          whiteSpace: 'nowrap',
                        }}>
                          Copied to clipboard
                        </span>
                      )}
                    </span>
                    <button
                      onClick={handleRevealApiKey}
                      style={{
                        padding: '0.25rem 0.5rem',
                        fontSize: '0.75rem',
                        color: '#2563eb',
                        backgroundColor: 'transparent',
                        border: '1px solid #2563eb',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      {showApiKey ? 'Hide' : 'Reveal & Copy'}
                    </button>
                  </>
                ) : (
                  <span style={{ fontStyle: 'italic', color: '#6b7280' }}>
                    Not set - will be prompted on first use
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={() => {
                const userscriptUrl = `${window.location.origin}/parkrun-club-tampermonkey.user.js`;
                window.open(userscriptUrl, '_blank');
              }}
              style={{
                padding: '0.75rem 1.5rem',
                fontSize: '0.95rem',
                fontWeight: 600,
                color: 'white',
                backgroundColor: '#10b981',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#059669')}
              onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#10b981')}
            >
              <i className="fa-solid fa-download"></i> Download Club Scraper Userscript
            </button>
          </div>
        )}
      </div>

      {/* Individual Athlete Batch Scraper - Tampermonkey */}
      <div style={{
        marginBottom: '2rem',
        backgroundColor: '#f0fdf4',
        borderRadius: '8px',
        border: '2px solid #10b981',
        overflow: 'hidden',
      }}>
        <button
          onClick={() => setShowIndividualScraper(!showIndividualScraper)}
          style={{
            width: '100%',
            padding: '1rem 1.5rem',
            backgroundColor: 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '1rem',
            fontWeight: 700,
            color: '#065f46',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <i className="fa-solid fa-person-running"></i> Individual Athlete Batch Scraper
          </span>
          <span style={{ fontSize: '1.2rem' }}>
            {showIndividualScraper ? <i className="fa-solid fa-chevron-down"></i> : <i className="fa-solid fa-chevron-right"></i>}
          </span>
        </button>

        {showIndividualScraper && (
          <div style={{ padding: '0 1.5rem 1.5rem 1.5rem' }}>
            <p style={{
              fontSize: '0.9rem',
              color: '#047857',
              lineHeight: '1.6',
              marginBottom: '1rem',
            }}>
              Automatically scrape all athletes' complete parkrun histories with a single click.
              The script adds a purple floating button to parkrun pages.
            </p>

            <div style={{
              backgroundColor: 'white',
              padding: '1rem',
              borderRadius: '6px',
              marginBottom: '1rem',
              border: '1px solid #10b981',
            }}>
              <p style={{
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#065f46',
                marginBottom: '0.5rem',
              }}>
                <i className="fa-solid fa-clipboard"></i> Installation:
              </p>
              <ol style={{
                fontSize: '0.85rem',
                color: '#047857',
                margin: '0',
                paddingLeft: '1.5rem',
                lineHeight: '1.8',
              }}>
                <li>Install <a
                  href="https://www.tampermonkey.net/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#2563eb', textDecoration: 'underline' }}
                >Tampermonkey browser extension</a></li>
                <li>Click the button below to download the userscript</li>
                <li>Tampermonkey will prompt you to install it</li>
                <li>Navigate to any parkrun athlete page (e.g., <a
                  href="https://www.parkrun.com.au/parkrunner/7796495/all/"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#2563eb', textDecoration: 'underline' }}
                >parkrun.com.au/parkrunner/7796495/all/</a>)</li>
                <li>Click the purple "🏃 Start Batch Scraper" button that appears</li>
                <li>Choose scraping mode and the script will automatically cycle through all athletes!</li>
              </ol>
            </div>

            <div style={{
              backgroundColor: 'white',
              padding: '1rem',
              borderRadius: '6px',
              marginBottom: '1rem',
              border: '1px solid #10b981',
            }}>
              <p style={{
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#065f46',
                marginBottom: '0.5rem',
              }}>
                <i className="fa-solid fa-key"></i> API Key:
              </p>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.85rem',
                color: '#047857',
              }}>
                {apiKeyValue ? (
                  <>
                    <span style={{ fontFamily: 'monospace', position: 'relative' }}>
                      {showApiKey ? apiKeyValue : '••••••••••••••••'}
                      {showCopiedMessage && (
                        <span style={{
                          position: 'absolute',
                          top: '-1.5rem',
                          left: '0',
                          backgroundColor: '#065f46',
                          color: 'white',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          whiteSpace: 'nowrap',
                        }}>
                          Copied to clipboard
                        </span>
                      )}
                    </span>
                    <button
                      onClick={handleRevealApiKey}
                      style={{
                        padding: '0.25rem 0.5rem',
                        fontSize: '0.75rem',
                        color: '#2563eb',
                        backgroundColor: 'transparent',
                        border: '1px solid #2563eb',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      {showApiKey ? 'Hide' : 'Reveal & Copy'}
                    </button>
                  </>
                ) : (
                  <span style={{ fontStyle: 'italic', color: '#6b7280' }}>
                    Not set - will be prompted on first use
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={() => {
                const userscriptUrl = `${window.location.origin}/parkrun-batch-tampermonkey.user.js`;
                window.open(userscriptUrl, '_blank');
              }}
              style={{
                padding: '0.75rem 1.5rem',
                fontSize: '0.95rem',
                fontWeight: 600,
                color: 'white',
                backgroundColor: '#10b981',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#059669')}
              onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#10b981')}
            >
              <i className="fa-solid fa-download"></i> Download Individual Athlete Scraper
            </button>
          </div>
        )}
      </div>

      <div className="admin-header" style={{ marginTop: '3rem' }}>
        <h2>Parkrun Athletes</h2>
        <p className="subtitle">Manage visibility of parkrun athletes</p>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
          Search by Name
        </label>
        <input
          type="text"
          placeholder="Search athlete name..."
          value={parkrunSearch}
          onChange={(e) => {
            setParkrunSearch(e.target.value);
            setParkrunPage(0); // Reset to first page on search
          }}
          style={{
            width: '100%',
            maxWidth: '400px',
            padding: '0.5rem',
            border: '1px solid #ddd',
            borderRadius: '4px',
            fontSize: '0.9rem',
          }}
        />
      </div>

      <div className="admin-stats">
        <div className="stat-card">
          <div className="stat-value">{parkrunAthletes.length}</div>
          <div className="stat-label">Total Parkrun Athletes</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{filteredParkrunAthletes.length}</div>
          <div className="stat-label">Matching Search</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {parkrunAthletes.filter((a) => a.is_hidden === 1).length}
          </div>
          <div className="stat-label">Hidden</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {parkrunAthletes.filter((a) => !a.is_hidden || a.is_hidden === 0).length}
          </div>
          <div className="stat-label">Visible</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: '#ef4444' }}>
            {parkrunAthletes.filter((a) => a.has_left_club === 1).length}
          </div>
          <div className="stat-label">Left Club <i className="fa-solid fa-door-open"></i></div>
        </div>
      </div>

      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th onClick={() => handleParkrunSort('name')} style={{ cursor: 'pointer' }}>
                Athlete Name {getSortIcon('name', parkrunSortField, parkrunSortDirection)}
              </th>
              <th onClick={() => handleParkrunSort('runs')} style={{ cursor: 'pointer' }}>
                Total Runs {getSortIcon('runs', parkrunSortField, parkrunSortDirection)}
              </th>
              <th onClick={() => handleParkrunSort('events')} style={{ cursor: 'pointer' }}>
                Top Events {getSortIcon('events', parkrunSortField, parkrunSortDirection)}
              </th>
              <th>Hidden</th>
            </tr>
          </thead>
          <tbody>
            {paginatedParkrunAthletes.map((athlete) => (
              <tr key={athlete.athlete_name}>
                <td>
                  <div className="athlete-cell">
                    {athlete.parkrun_athlete_id ? (
                      <a
                        href={`https://www.parkrun.com.au/parkrunner/${athlete.parkrun_athlete_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {athlete.athlete_name}
                      </a>
                    ) : (
                      <span>{athlete.athlete_name}</span>
                    )}
                    {athlete.has_left_club === 1 && (
                      <span
                        title="Left Woodstock parkrun group"
                        style={{
                          marginLeft: '0.5rem',
                          fontSize: '1.1rem',
                          color: '#ef4444',
                        }}
                      >
                        <i className="fa-solid fa-door-open"></i>
                      </span>
                    )}
                  </div>
                </td>
                <td className="number-cell">{athlete.run_count}</td>
                <td className="top-events-cell">
                  {athlete.top_events && athlete.top_events.length > 0 ? (
                    <div className="top-events">
                      {athlete.top_events.slice(0, 3).map((event, idx) => (
                        <span key={idx} className="event-badge">
                          {event.event_name} ({event.count})
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="no-events">-</span>
                  )}
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={athlete.is_hidden === 1}
                    onChange={(e) =>
                      updateParkrunAthleteVisibility(
                        athlete.athlete_name,
                        e.target.checked
                      )
                    }
                    className="checkbox"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {parkrunTotalPages > 1 && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '1rem',
          marginTop: '1.5rem',
          padding: '1rem',
        }}>
          <button
            onClick={() => setParkrunPage(Math.max(0, parkrunPage - 1))}
            disabled={parkrunPage === 0}
            className="button"
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: parkrunPage === 0 ? '#e5e7eb' : '#0ea5e9',
              color: parkrunPage === 0 ? '#9ca3af' : 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: parkrunPage === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            Previous
          </button>
          <span style={{ fontSize: '0.9rem', color: '#666' }}>
            Page {parkrunPage + 1} of {parkrunTotalPages}
            <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>
              ({filteredParkrunAthletes.length} total)
            </span>
          </span>
          <button
            onClick={() => setParkrunPage(Math.min(parkrunTotalPages - 1, parkrunPage + 1))}
            disabled={parkrunPage >= parkrunTotalPages - 1}
            className="button"
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: parkrunPage >= parkrunTotalPages - 1 ? '#e5e7eb' : '#0ea5e9',
              color: parkrunPage >= parkrunTotalPages - 1 ? '#9ca3af' : 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: parkrunPage >= parkrunTotalPages - 1 ? 'not-allowed' : 'pointer',
            }}
          >
            Next
          </button>
        </div>
      )}
        </div>
      )}

      {/* Manual Submissions Tab */}
      {activeTab === 'submissions' && (
        <div className="tab-content">
          <div className="admin-header">
            <h2><i className="fa-solid fa-file-pen"></i> Manual Activity Submissions</h2>
            <p className="subtitle">Review and approve manually submitted Strava activities</p>
          </div>

      {loadingSubmissions ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
          Loading submissions...
        </div>
      ) : manualSubmissions.length === 0 ? (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          backgroundColor: '#f9fafb',
          borderRadius: '8px',
          color: '#6b7280',
        }}>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            No pending manual submissions.
          </p>
        </div>
      ) : (
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Athlete</th>
                <th>Activity</th>
                <th>Date</th>
                <th>Distance</th>
                <th>Time</th>
                <th>Event</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {manualSubmissions.map((submission, index) => (
                  <tr key={submission.id}>
                    <td>
                      <span style={{ fontWeight: 600 }}>{submission.athlete_name}</span>
                    </td>
                    <td>
                      <a
                        href={submission.strava_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontWeight: 500, color: '#0ea5e9', textDecoration: 'none' }}
                      >
                        {submission.activity_name}
                      </a>
                    </td>
                    <td>{new Date(submission.date).toLocaleDateString()}</td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        value={submission.edit_distance || ''}
                        onChange={(e) => updateSubmissionField(index, { edit_distance: parseFloat(e.target.value) || null })}
                        style={{
                          width: '80px',
                          padding: '0.25rem 0.5rem',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          fontSize: '0.9rem',
                        }}
                        placeholder={submission.original_distance?.toFixed(2) || 'N/A'}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={submission.edit_time_string || ''}
                        onChange={(e) => updateSubmissionField(index, { edit_time_string: e.target.value })}
                        style={{
                          width: '90px',
                          padding: '0.25rem 0.5rem',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          fontSize: '0.9rem',
                          fontFamily: 'monospace',
                        }}
                        placeholder="HH:MM:SS"
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="text"
                          value={submission.edit_event_name || ''}
                          onChange={(e) => updateSubmissionField(index, { edit_event_name: e.target.value || null })}
                          list={`admin-event-list-${index}`}
                          style={{
                            padding: '0.25rem 0.5rem',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            fontSize: '0.9rem',
                            minWidth: '150px',
                            flex: 1,
                          }}
                          placeholder="Type or select event..."
                        />
                        <datalist id={`admin-event-list-${index}`}>
                          {submissionEventNames.map((name) => (
                            <option key={name} value={name} />
                          ))}
                        </datalist>
                        {submission.edit_event_name &&
                         !submissionEventNames.includes(submission.edit_event_name) && (
                          <span
                            style={{
                              color: '#f59e0b',
                              fontSize: '1.2rem',
                              cursor: 'help',
                            }}
                            title="New event name"
                          >
                            <i className="fa-solid fa-triangle-exclamation"></i>
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="action-buttons" style={{ gap: '0.5rem' }}>
                        <button
                          onClick={() => handleApproveSubmission(submission.id, submission)}
                          className="button"
                          style={{
                            padding: '0.5rem 1rem',
                            backgroundColor: '#22c55e',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                          }}
                          title="Approve and add to races"
                        >
                          <i className="fa-solid fa-check"></i> Approve
                        </button>
                        <button
                          onClick={() => handleRejectSubmission(submission.id)}
                          className="button button-delete"
                          style={{
                            padding: '0.5rem 1rem',
                            fontSize: '0.85rem',
                          }}
                          title="Reject submission"
                        >
                          <i className="fa-solid fa-xmark"></i> Reject
                        </button>
                      </div>
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

          {/* Approved Submissions Section */}
          <div className="admin-header" style={{ marginTop: '3rem' }}>
            <h2><i className="fa-solid fa-circle-check"></i> Approved Submissions</h2>
            <p className="subtitle">Previously approved manual submissions</p>
          </div>

          {loadingApproved ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
              Loading approved submissions...
            </div>
          ) : approvedSubmissions.length === 0 ? (
            <div style={{
              padding: '2rem',
              textAlign: 'center',
              backgroundColor: '#f9fafb',
              borderRadius: '8px',
              color: '#6b7280',
            }}>
              <p style={{ margin: 0, fontSize: '0.9rem' }}>
                No approved submissions yet.
              </p>
            </div>
          ) : (
            <div className="admin-table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Athlete</th>
                    <th>Activity</th>
                    <th>Date</th>
                    <th>Distance</th>
                    <th>Time</th>
                    <th>Event</th>
                    <th>Approved</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {approvedSubmissions.map((submission) => (
                    <tr key={submission.id}>
                      <td>
                        <span style={{ fontWeight: 600 }}>{submission.athlete_name}</span>
                      </td>
                      <td>
                        <a
                          href={submission.strava_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontWeight: 500, color: '#0ea5e9', textDecoration: 'none' }}
                        >
                          {submission.activity_name}
                        </a>
                      </td>
                      <td>{new Date(submission.date).toLocaleDateString()}</td>
                      <td>{submission.edited_distance?.toFixed(2)} km</td>
                      <td>
                        {submission.edited_time_seconds ? formatTime(submission.edited_time_seconds) : 'N/A'}
                      </td>
                      <td>
                        {submission.event_name ? (
                          <span style={{ fontWeight: 500 }}>{submission.event_name}</span>
                        ) : (
                          <span style={{ color: '#999', fontSize: '0.85rem' }}>No event</span>
                        )}
                      </td>
                      <td style={{ fontSize: '0.85rem', color: '#666' }}>
                        {submission.processed_at ? new Date(submission.processed_at * 1000).toLocaleDateString() : 'N/A'}
                      </td>
                      <td>
                        <button
                          onClick={() => handleDeleteSubmission(submission.id, submission.activity_name)}
                          className="button button-delete"
                          style={{
                            padding: '0.5rem 1rem',
                            fontSize: '0.85rem',
                          }}
                          title="Delete this approved submission"
                        >
                          <i className="fa-solid fa-trash"></i> Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* API Control Tab */}
      {activeTab === 'api-control' && (
        <div className="tab-content">
          <div className="admin-header">
            <h2><i className="fa-solid fa-gear"></i> API Control Panel</h2>
            <p className="subtitle">Execute API commands directly from the admin panel</p>
          </div>

          {/* Filters */}
          <div style={{
            marginBottom: '2.5rem',
            padding: '1.5rem',
            backgroundColor: '#f9fafb',
            borderRadius: '8px',
            border: '1px solid #e5e7eb',
          }}>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ flex: '1', minWidth: '300px' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.9rem', color: '#374151' }}>
                  <i className="fa-solid fa-magnifying-glass"></i> Search Commands
                </label>
                <input
                  type="text"
                  placeholder="Search by name or description..."
                  value={apiSearch}
                  onChange={(e) => setApiSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    fontSize: '0.95rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    backgroundColor: 'white',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#2563eb'}
                  onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
                />
              </div>
              <div style={{ minWidth: '220px' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.9rem', color: '#374151' }}>
                  <i className="fa-solid fa-folder"></i> Category
                </label>
                <select
                  value={apiCategory}
                  onChange={(e) => setApiCategory(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    fontSize: '0.95rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    backgroundColor: 'white',
                    cursor: 'pointer',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#2563eb'}
                  onBlur={(e) => e.target.style.borderColor = '#d1d5db'}
                >
                  <option value="all">All Categories</option>
                  {API_CATEGORIES.map(cat => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Commands Grid */}
          {(() => {
            // Filter commands by search and category
            const filteredCommands = API_COMMANDS.filter(cmd => {
              const matchesSearch = apiSearch === '' ||
                cmd.name.toLowerCase().includes(apiSearch.toLowerCase()) ||
                cmd.description.toLowerCase().includes(apiSearch.toLowerCase());
              const matchesCategory = apiCategory === 'all' || cmd.category === apiCategory;
              return matchesSearch && matchesCategory;
            });

            // Group by category
            const commandsByCategory = filteredCommands.reduce((acc, cmd) => {
              if (!acc[cmd.category]) {
                acc[cmd.category] = [];
              }
              acc[cmd.category].push(cmd);
              return acc;
            }, {} as Record<string, typeof API_COMMANDS>);

            const apiUrl = window.location.origin;

            if (filteredCommands.length === 0) {
              return (
                <div style={{
                  padding: '2rem',
                  textAlign: 'center',
                  backgroundColor: '#f9fafb',
                  borderRadius: '8px',
                  color: '#6b7280',
                }}>
                  <p style={{ margin: 0, fontSize: '0.9rem' }}>
                    No commands match your search criteria
                  </p>
                </div>
              );
            }

            return Object.entries(commandsByCategory).map(([categoryId, commands]) => {
              const category = API_CATEGORIES.find(c => c.id === categoryId);
              return (
                <div key={categoryId} style={{ marginBottom: '3rem' }}>
                  <div style={{
                    borderLeft: '4px solid #2563eb',
                    paddingLeft: '1rem',
                    marginBottom: '1.25rem',
                  }}>
                    <h3 style={{
                      fontSize: '1.3rem',
                      fontWeight: 700,
                      marginBottom: '0.25rem',
                      color: '#111827',
                    }}>
                      {category?.label || categoryId}
                    </h3>
                    <p style={{
                      fontSize: '0.95rem',
                      color: '#6b7280',
                      margin: 0,
                    }}>
                      {category?.description}
                    </p>
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))',
                    gap: '1.25rem',
                  }}>
                    {commands.map(cmd => (
                      <ApiCommandCard
                        key={cmd.id}
                        command={cmd}
                        apiUrl={apiUrl}
                        adminStravaId={currentAthleteId}
                      />
                    ))}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* Sync Dashboard Tab */}
      {activeTab === 'sync-dashboard' && (
        <div className="tab-content">
          <div className="admin-header">
            <h2><i className="fa-solid fa-rotate"></i> Sync Queue Dashboard</h2>
            <p className="subtitle">Monitor and manage athlete sync jobs</p>
          </div>

          {loadingSyncStatus ? (
            <div className="loading-container">
              <div className="spinner"></div>
              <p>Loading sync status...</p>
            </div>
          ) : !syncQueueStatus ? (
            <p>No sync data available</p>
          ) : (
            <div>
              {/* Active/Processing Syncs */}
              <div style={{ marginBottom: '3rem' }}>
                <h3 style={{ marginBottom: '1rem', fontSize: '1.3rem', fontWeight: 600 }}>
                  <i className="fa-solid fa-rotate"></i> Active Syncs ({syncQueueStatus.active.length})
                </h3>
                {syncQueueStatus.active.length === 0 ? (
                  <p style={{ color: '#6b7280', fontStyle: 'italic' }}>No active syncs</p>
                ) : (
                  <div className="admin-table-container">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Sync ID</th>
                          <th>Athlete</th>
                          <th>Strava ID</th>
                          <th>Type</th>
                          <th>Status</th>
                          <th>Started</th>
                          <th>Duration</th>
                          <th>Progress</th>
                          <th>Error</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {syncQueueStatus.active.map((job) => {
                          const startTime = job.started_at ? new Date(job.started_at) : null;
                          const duration = startTime
                            ? Math.floor((Date.now() - startTime.getTime()) / 1000)
                            : null;
                          const durationText = duration
                            ? `${Math.floor(duration / 60)}m ${duration % 60}s`
                            : '-';

                          return (
                            <tr key={job.id}>
                              <td className="number-cell">{job.id}</td>
                              <td>
                                {job.first_name} {job.last_name}
                              </td>
                              <td className="strava-link">{job.strava_id}</td>
                              <td>{job.job_type}</td>
                              <td>
                                <span
                                  className={`status-badge ${job.status === 'processing' ? 'syncing' : 'pending'}`}
                                >
                                  {job.status}
                                </span>
                              </td>
                              <td className="date-cell">
                                {startTime
                                  ? startTime.toLocaleString()
                                  : '-'}
                              </td>
                              <td className="number-cell">{durationText}</td>
                              <td className="number-cell">
                                {job.total_activities_fetched > 0 && `${job.total_activities_fetched} activities`}
                                {job.runs_filtered > 0 && ` · ${job.runs_filtered} runs`}
                                {job.races_filtered > 0 && ` · ${job.races_filtered} races`}
                                {job.new_races_added > 0 && ` · ${job.new_races_added} new`}
                                {job.total_activities_fetched === 0 && '-'}
                              </td>
                              <td>
                                {job.error_message && (
                                  <span style={{ color: '#dc2626', fontSize: '0.85rem' }}>
                                    {job.error_message}
                                  </span>
                                )}
                              </td>
                              <td>
                                <button
                                  className="action-button delete"
                                  onClick={() => {
                                    if (confirm(`Stop sync #${job.id} for ${job.first_name} ${job.last_name}?`)) {
                                      stopSyncJob(job.id);
                                    }
                                  }}
                                  title="Stop this sync"
                                >
                                  <i className="fa-solid fa-stop"></i> Stop
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Recent Completed/Failed Syncs */}
              <div>
                <h3 style={{ marginBottom: '1rem', fontSize: '1.3rem', fontWeight: 600 }}>
                  <i className="fa-solid fa-chart-column"></i> Recent Syncs (Last 10)
                </h3>
                {syncQueueStatus.recent.length === 0 ? (
                  <p style={{ color: '#6b7280', fontStyle: 'italic' }}>No recent syncs</p>
                ) : (
                  <div className="admin-table-container">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Sync ID</th>
                          <th>Athlete</th>
                          <th>Strava ID</th>
                          <th>Type</th>
                          <th>Status</th>
                          <th>Started</th>
                          <th>Completed</th>
                          <th>Duration</th>
                          <th>Activities</th>
                          <th>Races</th>
                          <th>Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {syncQueueStatus.recent.map((job) => {
                          const startTime = job.started_at ? new Date(job.started_at) : null;
                          const endTime = job.completed_at ? new Date(job.completed_at) : null;
                          const duration = startTime && endTime
                            ? Math.floor((endTime.getTime() - startTime.getTime()) / 1000)
                            : null;
                          const durationText = duration
                            ? `${Math.floor(duration / 60)}m ${duration % 60}s`
                            : '-';

                          return (
                            <tr key={job.id}>
                              <td className="number-cell">{job.id}</td>
                              <td>
                                {job.first_name} {job.last_name}
                              </td>
                              <td className="strava-link">{job.strava_id}</td>
                              <td>{job.job_type}</td>
                              <td>
                                <span
                                  className={`status-badge ${job.status === 'completed' ? 'synced' : 'error'}`}
                                >
                                  {job.status}
                                </span>
                              </td>
                              <td className="date-cell">
                                {startTime
                                  ? startTime.toLocaleString()
                                  : '-'}
                              </td>
                              <td className="date-cell">
                                {endTime
                                  ? endTime.toLocaleString()
                                  : '-'}
                              </td>
                              <td className="number-cell">{durationText}</td>
                              <td className="number-cell">{job.total_activities_fetched || 0}</td>
                              <td className="number-cell" title={`${job.new_races_added || 0} new`}>
                                {job.races_filtered || job.new_races_added || 0}
                              </td>
                              <td>
                                {job.error_message && (
                                  <span style={{ color: '#dc2626', fontSize: '0.85rem' }}>
                                    {job.error_message}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
