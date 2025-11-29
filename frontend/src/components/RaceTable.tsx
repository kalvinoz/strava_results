import { useState, useEffect, useMemo, useRef } from 'react';
import { FaEye, FaEyeSlash, FaUserPen } from 'react-icons/fa6';
import { FaCommentDots, FaRegCommentDots } from 'react-icons/fa6';
import './RaceTable.css';

interface VisibilityToggleProps {
  race: Race;
  isOwner: boolean;
  onToggle: (raceId: number, isHidden: boolean) => Promise<void>;
}

function VisibilityToggle({ race, isOwner, onToggle }: VisibilityToggleProps) {
  const [isToggling, setIsToggling] = useState(false);
  const isHidden = race.is_hidden === 1;

  if (!isOwner) {
    return null; // Don't show toggle to non-owners
  }

  const handleToggle = async () => {
    setIsToggling(true);
    try {
      await onToggle(race.id, !isHidden);
    } catch (error) {
      alert('Failed to update visibility');
    } finally {
      setIsToggling(false);
    }
  };

  return (
    <button
      onClick={handleToggle}
      disabled={isToggling}
      className="visibility-toggle"
      title={isHidden ? 'Hidden - Click to show' : 'Visible - Click to hide'}
      style={{
        background: isHidden ? '#f3f4f6' : 'transparent',
        border: '1px solid #ddd',
        borderRadius: '4px',
        cursor: isToggling ? 'wait' : 'pointer',
        fontSize: '1rem',
        padding: '0.25rem 0.5rem',
        opacity: isToggling ? 0.5 : 1,
        color: isHidden ? '#999' : '#333',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {isHidden ? <FaEyeSlash /> : <FaEye />}
    </button>
  );
}

interface DescriptionTooltipProps {
  race: Race;
  isOwner: boolean;
  isEditMode?: boolean;
  onFetchDescription: (raceId: number, stravaActivityId: number) => Promise<void>;
}

function DescriptionTooltip({ race, isOwner, isEditMode, onFetchDescription }: DescriptionTooltipProps) {
  const [isFetching, setIsFetching] = useState(false);

  const handleFetch = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsFetching(true);
    try {
      await onFetchDescription(race.id, race.strava_activity_id);
    } catch (error) {
      alert('Failed to fetch description');
    } finally {
      setIsFetching(false);
    }
  };

  // In edit mode: show for owners on all activities
  // In normal mode: only show if description exists
  if (isEditMode) {
    // Edit mode: show speech bubble on all activities for owners
    if (!isOwner) {
      return null;
    }

    return (
      <div className="description-tooltip-wrapper">
        <FaRegCommentDots
          className="description-icon description-icon-edit"
          onClick={handleFetch}
          title={isFetching ? 'Fetching...' : (race.description ? 'Refresh description' : 'Fetch description')}
          style={{ cursor: isFetching ? 'wait' : 'pointer' }}
        />
      </div>
    );
  }

  // Normal mode: only show if description exists
  if (!race.description) {
    return null;
  }

  return (
    <div className="description-tooltip-wrapper description-hover-trigger">
      <FaCommentDots
        className="description-icon"
        title={race.description}
      />
      <div className="description-tooltip description-hover-tooltip">
        <div className="description-text">{race.description}</div>
      </div>
    </div>
  );
}

interface Race {
  id: number;
  strava_activity_id: number;
  name: string;
  description?: string;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  manual_time?: number;
  manual_distance?: number;
  event_name?: string;
  date: string;
  elevation_gain: number;
  average_heartrate?: number;
  max_heartrate?: number;
  athlete_id: number;
  is_hidden?: number;
  firstname: string;
  lastname: string;
  profile_photo?: string;
  strava_id: number;
}

interface RaceTableProps {
  races: Race[];
  currentAthleteId?: number; // Strava ID of the current logged-in user
  isAdmin?: boolean; // Whether the current user is an admin
  onTimeUpdate?: () => void; // Callback to refresh races after update
  availableEvents?: string[]; // List of all existing event names
  onEventUpdate?: () => void; // Callback to refresh races and events after event update
  isEditMode?: boolean; // Whether edit mode is active
  onEditModeChange?: (isEditMode: boolean) => void; // Callback to toggle edit mode
  hasEditableRaces?: boolean; // Whether user has any races they can edit
}

/**
 * Format distance to friendly names (5k, 10k, HM, Marathon) or meters
 */
function formatDistance(meters: number): string {
  const km = meters / 1000;

  // Check for common race distances with some tolerance (±2%)
  const tolerance = 0.02;

  if (Math.abs(km - 5) / 5 < tolerance) return '5k';
  if (Math.abs(km - 10) / 10 < tolerance) return '10k';
  if (Math.abs(km - 21.1) / 21.1 < tolerance) return 'HM';
  if (Math.abs(km - 42.2) / 42.2 < tolerance) return 'Marathon';

  // Otherwise show kilometers with 1 decimal
  return `${km.toFixed(1)}km`;
}

/**
 * Format time in seconds to HH:MM:SS or MM:SS
 */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * Format date to readable string
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

interface EditableTimeProps {
  race: Race;
  isOwner: boolean;
  isEditMode: boolean;
  onSave: (raceId: number, newTime: number | null) => Promise<void>;
}

function EditableTime({ race, isOwner, isEditMode, onSave }: EditableTimeProps) {
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const displayTime = race.manual_time ?? race.elapsed_time;
  const hasManualTime = race.manual_time !== null && race.manual_time !== undefined;

  // Initialize edit value when entering edit mode
  const prevIsEditModeRef = useRef(isEditMode);
  useEffect(() => {
    if (isEditMode && isOwner && !prevIsEditModeRef.current) {
      // Only reset when entering edit mode (transitioning from false to true)
      setEditValue(formatTime(displayTime));
      setHasUnsavedChanges(false);
    }
    prevIsEditModeRef.current = isEditMode;
  }, [isEditMode, isOwner, displayTime]);

  const handleSave = async () => {
    if (!hasUnsavedChanges) {
      console.log(`[EditableTime] No unsaved changes for race ${race.id}`);
      return;
    }

    console.log(`[EditableTime] Saving time for race ${race.id}: ${editValue}`);
    setIsSaving(true);
    try {
      // Parse the time string (HH:MM:SS or MM:SS)
      const parts = editValue.split(':').map(p => parseInt(p, 10));
      let seconds: number;

      if (parts.length === 3) {
        seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
      } else if (parts.length === 2) {
        seconds = parts[0] * 60 + parts[1];
      } else {
        alert('Invalid time format. Use MM:SS or HH:MM:SS');
        setIsSaving(false);
        return;
      }

      console.log(`[EditableTime] Parsed time: ${seconds} seconds`);
      await onSave(race.id, seconds);
      setHasUnsavedChanges(false);
      console.log(`[EditableTime] Save successful for race ${race.id}`);
    } catch (error) {
      console.error(`[EditableTime] Save failed for race ${race.id}:`, error);
      alert('Failed to update time');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    if (confirm('Remove manual time and use Strava time?')) {
      setIsSaving(true);
      try {
        await onSave(race.id, null);
        setHasUnsavedChanges(false);
      } catch (error) {
        alert('Failed to clear manual time');
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log(`[EditableTime] Value changed for race ${race.id}: ${e.target.value}`);
    setEditValue(e.target.value);
    setHasUnsavedChanges(true);
  };

  // Auto-save when exiting edit mode
  useEffect(() => {
    console.log(`[EditableTime] Edit mode changed for race ${race.id}: isEditMode=${isEditMode}, hasUnsavedChanges=${hasUnsavedChanges}, isOwner=${isOwner}`);
    if (!isEditMode && hasUnsavedChanges && isOwner) {
      console.log(`[EditableTime] Triggering auto-save for race ${race.id}`);
      handleSave();
    }
  }, [isEditMode, hasUnsavedChanges, isOwner]);

  if (isEditMode && isOwner) {
    return (
      <div className="time-edit">
        <input
          type="text"
          value={editValue}
          onChange={handleChange}
          placeholder="HH:MM:SS"
          className="time-input"
        />
        {hasManualTime && (
          <button onClick={handleClear} disabled={isSaving} className="btn-clear" title="Clear manual time">
            ↺
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="time-display">
      <span>{formatTime(displayTime)}</span>
      {hasManualTime && (
        <span className="manual-indicator" title="Edited for accuracy">
          <FaUserPen style={{ fontSize: '10px', marginLeft: '4px', color: '#667eea' }} />
        </span>
      )}
    </div>
  );
}

interface EditableDistanceProps {
  race: Race;
  isOwner: boolean;
  isEditMode: boolean;
  onSave: (raceId: number, newDistance: number | null) => Promise<void>;
}

function EditableDistance({ race, isOwner, isEditMode, onSave }: EditableDistanceProps) {
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const displayDistance = race.manual_distance ?? race.distance;
  const hasManualDistance = race.manual_distance !== null && race.manual_distance !== undefined;

  // Initialize edit value when entering edit mode
  const prevIsEditModeRefDist = useRef(isEditMode);
  useEffect(() => {
    if (isEditMode && isOwner && !prevIsEditModeRefDist.current) {
      // Only reset when entering edit mode (transitioning from false to true)
      setEditValue((displayDistance / 1000).toFixed(2));
      setHasUnsavedChanges(false);
    }
    prevIsEditModeRefDist.current = isEditMode;
  }, [isEditMode, isOwner, displayDistance]);

  const handleSave = async () => {
    if (!hasUnsavedChanges) return;

    setIsSaving(true);
    try {
      const km = parseFloat(editValue);
      if (isNaN(km) || km <= 0) {
        alert('Invalid distance. Please enter a positive number in kilometers.');
        return;
      }

      const meters = Math.round(km * 1000);
      await onSave(race.id, meters);
      setHasUnsavedChanges(false);
    } catch (error) {
      alert('Failed to update distance');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    if (confirm('Remove manual distance and use Strava distance?')) {
      setIsSaving(true);
      try {
        await onSave(race.id, null);
        setHasUnsavedChanges(false);
      } catch (error) {
        alert('Failed to clear manual distance');
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value);
    setHasUnsavedChanges(true);
  };

  // Auto-save when exiting edit mode
  useEffect(() => {
    if (!isEditMode && hasUnsavedChanges && isOwner) {
      handleSave();
    }
  }, [isEditMode]);

  if (isEditMode && isOwner) {
    return (
      <div className="time-edit">
        <input
          type="text"
          value={editValue}
          onChange={handleChange}
          placeholder="5.00"
          className="time-input"
        />
        <span style={{ fontSize: '12px', color: '#666' }}>km</span>
        {hasManualDistance && (
          <button onClick={handleClear} disabled={isSaving} className="btn-clear" title="Clear manual distance">
            ↺
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="time-display">
      <span>{formatDistance(displayDistance)}</span>
      {hasManualDistance && (
        <span className="manual-indicator" title="Edited for accuracy">
          <FaUserPen style={{ fontSize: '10px', marginLeft: '4px', color: '#667eea' }} />
        </span>
      )}
    </div>
  );
}

interface EditableEventProps {
  race: Race;
  isAdmin: boolean;
  availableEvents: string[];
  onSave: (raceId: number, newEventName: string | null) => Promise<void>;
  currentAthleteId?: number;
  allRaces: Race[];
  isOwner: boolean;
}

function EditableEvent({ race, isAdmin, availableEvents, onSave, currentAthleteId, allRaces, isOwner }: EditableEventProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // Only admins can edit all events, others can only edit their own
  const canEdit = isAdmin || isOwner;

  // Helper to generate Strava calendar link for the race's year/month
  // Uses Text Fragments to highlight the event name on the page
  const getCalendarLink = (): string => {
    const date = new Date(race.date);
    const year = date.getFullYear();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];

    // Add Text Fragment to highlight the event name
    // Format: #MonthAbbr:~:text=EventName
    const eventNameEncoded = encodeURIComponent(race.event_name || '');
    return `https://www.strava.com/athlete/calendar/${year}#${month}:~:text=${eventNameEncoded}`;
  };

  // Check if current user already has a race with same event name on same date
  const userAlreadyHasThisEvent = (): boolean => {
    if (!currentAthleteId || !race.event_name) return false;

    // Extract just the date portion (YYYY-MM-DD) from the datetime string
    const raceDateOnly = race.date.split('T')[0];

    return allRaces.some(r => {
      const rDateOnly = r.date.split('T')[0];
      return (
        r.strava_id === currentAthleteId &&
        r.event_name === race.event_name &&
        rDateOnly === raceDateOnly
      );
    });
  };

  // Show "Find mine" link only if:
  // 1. Race has an event name
  // 2. Race is NOT from the current user viewing it
  // 3. Current user doesn't already have a race with same event name on same date
  const showFindMineLink = race.event_name &&
                           currentAthleteId &&
                           race.strava_id !== currentAthleteId &&
                           !userAlreadyHasThisEvent();

  // Filter available events based on input value
  const filteredEvents = availableEvents.filter(event =>
    event.toLowerCase().includes(editValue.toLowerCase())
  );

  const handleEdit = () => {
    setEditValue(race.event_name || '');
    setIsEditing(true);
    setIsDropdownOpen(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue('');
    setIsDropdownOpen(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const trimmedValue = editValue.trim();
      await onSave(race.id, trimmedValue || null);
      setIsEditing(false);
      setEditValue('');
      setIsDropdownOpen(false);
    } catch (error) {
      alert('Failed to update event');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectEvent = (eventName: string) => {
    setEditValue(eventName);
    setIsDropdownOpen(false);
  };

  const handleClear = async () => {
    if (confirm('Remove event name?')) {
      setIsSaving(true);
      try {
        await onSave(race.id, null);
        setIsEditing(false);
      } catch (error) {
        alert('Failed to clear event');
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!isDropdownOpen) setIsDropdownOpen(true);
        setHighlightedIndex(prev =>
          prev < filteredEvents.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!isDropdownOpen) setIsDropdownOpen(true);
        setHighlightedIndex(prev => (prev > 0 ? prev - 1 : 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (isDropdownOpen && filteredEvents[highlightedIndex]) {
          handleSelectEvent(filteredEvents[highlightedIndex]);
        } else {
          handleSave();
        }
        break;
      case 'Escape':
        e.preventDefault();
        if (isDropdownOpen) {
          setIsDropdownOpen(false);
        } else {
          handleCancel();
        }
        break;
    }
  };

  if (isEditing) {
    return (
      <div className="event-edit" style={{ position: 'relative' }}>
        <input
          type="text"
          value={editValue}
          onChange={(e) => {
            setEditValue(e.target.value);
            setIsDropdownOpen(true);
            setHighlightedIndex(0);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsDropdownOpen(true)}
          placeholder="Event name..."
          className="time-input"
          style={{ minWidth: '200px' }}
          autoFocus
        />
        <button onClick={handleSave} disabled={isSaving} className="btn-save">
          {isSaving ? '...' : '✓'}
        </button>
        <button onClick={handleCancel} disabled={isSaving} className="btn-cancel">
          ✕
        </button>
        {race.event_name && (
          <button onClick={handleClear} disabled={isSaving} className="btn-clear" title="Clear event name">
            ↺
          </button>
        )}

        {isDropdownOpen && filteredEvents.length > 0 && (
          <ul
            className="event-dropdown"
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              zIndex: 1000,
              background: 'white',
              border: '1px solid #ccc',
              borderRadius: '4px',
              maxHeight: '200px',
              overflowY: 'auto',
              listStyle: 'none',
              margin: '4px 0',
              padding: 0,
              minWidth: '200px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}
          >
            {filteredEvents.slice(0, 50).map((event, index) => (
              <li
                key={event}
                onClick={() => handleSelectEvent(event)}
                onMouseEnter={() => setHighlightedIndex(index)}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  backgroundColor: index === highlightedIndex ? '#f0f0f0' : 'white',
                }}
              >
                {event}
              </li>
            ))}
            {filteredEvents.length > 50 && (
              <li style={{ padding: '8px 12px', color: '#666', fontSize: '12px' }}>
                + {filteredEvents.length - 50} more (keep typing to narrow down)
              </li>
            )}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="event-display">
      {race.event_name ? (
        <>
          <span
            className={canEdit ? "event-badge event-badge-clickable" : "event-badge"}
            onClick={canEdit ? handleEdit : undefined}
            style={canEdit ? { cursor: 'pointer' } : undefined}
            title={canEdit ? "Click to edit event" : undefined}
          >
            {race.event_name}
          </span>
          {showFindMineLink && (
            <a
              href={getCalendarLink()}
              target="_blank"
              rel="noopener noreferrer"
              className="find-mine-link"
              title="Find mine"
              style={{
                marginLeft: '6px',
                fontSize: '14px',
                textDecoration: 'none',
                cursor: 'pointer',
              }}
            >
              <i className="fa-solid fa-magnifying-glass"></i>
            </a>
          )}
        </>
      ) : canEdit ? (
        <span
          className="no-event no-event-clickable"
          onClick={handleEdit}
          style={{ cursor: 'pointer' }}
          title="Click to add event"
        >
          —
        </span>
      ) : (
        <span className="no-event">—</span>
      )}
    </div>
  );
}

export default function RaceTable({ races, currentAthleteId, isAdmin = false, onTimeUpdate, availableEvents = [], onEventUpdate, isEditMode = false }: RaceTableProps) {
  const [sortField, setSortField] = useState<keyof Race | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [descriptionOverrides, setDescriptionOverrides] = useState<Record<number, string>>({});

  const handleSort = (field: keyof Race) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Merge races with description overrides
  const racesWithOverrides = useMemo(() => {
    return races.map(race => ({
      ...race,
      description: descriptionOverrides[race.id] ?? race.description
    }));
  }, [races, descriptionOverrides]);

  const sortedRaces = [...racesWithOverrides].sort((a, b) => {
    if (!sortField) return 0;

    let aValue: any = a[sortField];
    let bValue: any = b[sortField];

    // Use manual values if they exist
    if (sortField === 'elapsed_time') {
      aValue = a.manual_time ?? a.elapsed_time;
      bValue = b.manual_time ?? b.elapsed_time;
    }
    if (sortField === 'distance') {
      aValue = a.manual_distance ?? a.distance;
      bValue = b.manual_distance ?? b.distance;
    }

    // Handle null/undefined
    if (aValue === null || aValue === undefined) return 1;
    if (bValue === null || bValue === undefined) return -1;

    // Compare
    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const getSortIndicator = (field: keyof Race): React.ReactNode => {
    if (sortField !== field) return <> <i className="fa-solid fa-sort"></i></>;
    return sortDirection === 'asc' ? <> <i className="fa-solid fa-sort-up"></i></> : <> <i className="fa-solid fa-sort-down"></i></>;
  };

  const handleTimeUpdate = async (raceId: number, newTime: number | null) => {
    console.log(`[handleTimeUpdate] Called with raceId=${raceId}, newTime=${newTime}, currentAthleteId=${currentAthleteId}`);
    try {
      const requestBody = {
        manual_time: newTime,
        athlete_strava_id: currentAthleteId,
      };
      console.log(`[handleTimeUpdate] Sending PATCH request to /api/races/${raceId}/time`, requestBody);

      const response = await fetch(`/api/races/${raceId}/time`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      console.log(`[handleTimeUpdate] Response status: ${response.status}`);

      if (!response.ok) {
        const error = await response.json();
        console.error(`[handleTimeUpdate] API error:`, error);
        throw new Error(error.error || 'Failed to update time');
      }

      const result = await response.json();
      console.log(`[handleTimeUpdate] API response:`, result);

      // Refresh the races list
      if (onTimeUpdate) {
        onTimeUpdate();
      }
    } catch (error) {
      console.error('Error updating time:', error);
      throw error;
    }
  };

  const handleDistanceUpdate = async (raceId: number, newDistance: number | null) => {
    try {
      const response = await fetch(`/api/races/${raceId}/distance`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          manual_distance: newDistance,
          athlete_strava_id: currentAthleteId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update distance');
      }

      // Refresh the races list
      if (onTimeUpdate) {
        onTimeUpdate();
      }
    } catch (error) {
      console.error('Error updating distance:', error);
      throw error;
    }
  };

  const handleEventUpdate = async (raceId: number, newEventName: string | null) => {
    try {
      const response = await fetch(`/api/races/${raceId}/event`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          event_name: newEventName,
          admin_strava_id: currentAthleteId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update event');
      }

      // Refresh the races list and available events
      if (onEventUpdate) {
        onEventUpdate();
      }
    } catch (error) {
      console.error('Error updating event:', error);
      throw error;
    }
  };

  const handleVisibilityToggle = async (raceId: number, isHidden: boolean) => {
    try {
      const response = await fetch(`/api/races/${raceId}/visibility`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          is_hidden: isHidden,
          athlete_strava_id: currentAthleteId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update visibility');
      }

      // Refresh the races list
      if (onTimeUpdate) {
        onTimeUpdate();
      }
    } catch (error) {
      console.error('Error updating visibility:', error);
      throw error;
    }
  };

  const handleDescriptionFetch = async (raceId: number, stravaActivityId: number) => {
    try {
      const response = await fetch(`/api/races/${raceId}/fetch-description`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          strava_activity_id: stravaActivityId,
          athlete_strava_id: currentAthleteId,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch description');
      }

      const data = await response.json();

      // Update description override for this specific race
      setDescriptionOverrides(prev => ({
        ...prev,
        [raceId]: data.description
      }));

      // Don't call onDescriptionUpdate to avoid full page refresh
    } catch (error) {
      console.error('Error fetching description:', error);
      throw error;
    }
  };

  return (
    <div className="race-table-container">
      <table className="race-table">
        <thead>
          <tr>
            <th onClick={() => handleSort('firstname')} style={{ cursor: 'pointer' }}>
              Name{getSortIndicator('firstname')}
            </th>
            <th onClick={() => handleSort('date')} style={{ cursor: 'pointer' }}>
              Date{getSortIndicator('date')}
            </th>
            <th onClick={() => handleSort('event_name')} style={{ cursor: 'pointer' }}>
              Event{getSortIndicator('event_name')}
            </th>
            <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
              Activity Name{getSortIndicator('name')}
            </th>
            <th onClick={() => handleSort('distance')} style={{ cursor: 'pointer' }}>
              Distance{getSortIndicator('distance')}
            </th>
            <th onClick={() => handleSort('elapsed_time')} style={{ cursor: 'pointer' }}>
              Time{getSortIndicator('elapsed_time')}
            </th>
            <th style={{ width: '50px' }}></th>
          </tr>
        </thead>
        <tbody>
          {sortedRaces.map((race) => (
            <tr key={race.id}>
              <td className="athlete-name">
                {race.profile_photo && (
                  <img src={race.profile_photo} alt="" className="athlete-photo" />
                )}
                <span>{race.firstname} {race.lastname}</span>
              </td>
              <td>{formatDate(race.date)}</td>
              <td className="event-name">
                <EditableEvent
                  race={race}
                  isAdmin={isAdmin}
                  availableEvents={availableEvents}
                  onSave={handleEventUpdate}
                  currentAthleteId={currentAthleteId}
                  allRaces={racesWithOverrides}
                  isOwner={isAdmin || race.strava_id === currentAthleteId}
                />
              </td>
              <td>
                <div className="activity-name-cell">
                  <a
                    href={`https://www.strava.com/activities/${race.strava_activity_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="activity-link"
                  >
                    {race.name}
                  </a>
                  <DescriptionTooltip
                    race={race}
                    isOwner={isAdmin || race.strava_id === currentAthleteId}
                    isEditMode={isEditMode}
                    onFetchDescription={handleDescriptionFetch}
                  />
                </div>
              </td>
              <td>
                <EditableDistance
                  race={race}
                  isOwner={isAdmin || race.strava_id === currentAthleteId}
                  isEditMode={isEditMode}
                  onSave={handleDistanceUpdate}
                />
              </td>
              <td>
                <EditableTime
                  race={race}
                  isOwner={isAdmin || race.strava_id === currentAthleteId}
                  isEditMode={isEditMode}
                  onSave={handleTimeUpdate}
                />
              </td>
              <td>
                <VisibilityToggle
                  race={race}
                  isOwner={isAdmin || race.strava_id === currentAthleteId}
                  onToggle={handleVisibilityToggle}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
