import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import RaceTable from '../components/RaceTable';
import RaceFilters from '../components/RaceFilters';
import AthleteSummary from '../components/AthleteSummary';
import './Dashboard.css';

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

interface Filters {
  athletes: string[];
  events: string[];
  distances: string[];
  activityName: string;
  dateFrom: string;
  dateTo: string;
}

// Helper function to get default start date (January 1st of previous year)
const getDefaultStartDate = () => {
  const now = new Date();
  const previousYear = now.getFullYear() - 1;
  return `${previousYear}-01-01`;
};

export default function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [races, setRaces] = useState<Race[]>([]);
  const [allFilteredRaces, setAllFilteredRaces] = useState<Race[]>([]);
  const [loading, setLoading] = useState(true);

  // Initialize filters from URL params
  const [filters, setFilters] = useState<Filters>(() => {
    const athletesParam = searchParams.get('athletes');
    const eventsParam = searchParams.get('events');
    const distancesParam = searchParams.get('distances');
    return {
      athletes: athletesParam ? athletesParam.split('|').filter(Boolean) : [],
      events: eventsParam ? eventsParam.split('|').filter(Boolean) : [],
      distances: distancesParam ? distancesParam.split('|').filter(Boolean) : [],
      activityName: searchParams.get('activityName') || '',
      dateFrom: searchParams.get('dateFrom') || getDefaultStartDate(),
      dateTo: searchParams.get('dateTo') || '',
    };
  });

  const [currentAthleteId, setCurrentAthleteId] = useState<number | undefined>();
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [pagination, setPagination] = useState({ total: 0, limit: 50, offset: 0 });
  const [earliestDate, setEarliestDate] = useState<string>();
  const [availableAthletes, setAvailableAthletes] = useState<string[]>([]);
  const [availableEvents, setAvailableEvents] = useState<string[]>([]);
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const athleteIdFromUrl = urlParams.get('athlete_id');

    if (athleteIdFromUrl) {
      localStorage.setItem('strava_athlete_id', athleteIdFromUrl);
      setCurrentAthleteId(parseInt(athleteIdFromUrl, 10));
      window.history.replaceState({}, '', '/dashboard');
    } else {
      const stravaId = localStorage.getItem('strava_athlete_id');
      if (stravaId) {
        setCurrentAthleteId(parseInt(stravaId, 10));
      }
    }
  }, []);

  useEffect(() => {
    fetchEarliestDate();
    fetchAvailableAthletes();
    fetchAvailableEvents();
  }, []);

  useEffect(() => {
    if (currentAthleteId) {
      fetchAdminStatus();
    }
  }, [currentAthleteId]);

  useEffect(() => {
    fetchRaces();
  }, [filters, pagination.offset, currentAthleteId, showHidden]);

  useEffect(() => {
    fetchAllFilteredRaces();
  }, [filters, currentAthleteId, showHidden]);

  const fetchEarliestDate = async () => {
    try {
      const response = await fetch('/api/races?limit=1000');
      const data = await response.json();
      if (data.races && data.races.length > 0) {
        const dates = data.races.map((r: Race) => r.date.split('T')[0]); // Extract just YYYY-MM-DD
        setEarliestDate(dates.sort()[0]);
      }
    } catch (error) {
      console.error('Failed to fetch earliest date:', error);
    }
  };

  const fetchAvailableAthletes = async () => {
    try {
      const response = await fetch('/api/races?limit=10000');
      const data = await response.json();
      if (data.races && data.races.length > 0) {
        const athletes = Array.from(
          new Set(data.races.map((r: Race) => `${r.firstname} ${r.lastname}`))
        ).sort() as string[];
        setAvailableAthletes(athletes);
      }
    } catch (error) {
      console.error('Failed to fetch available athletes:', error);
    }
  };

  const fetchAvailableEvents = async () => {
    try {
      const response = await fetch('/api/races?limit=10000');
      const data = await response.json();
      if (data.races && data.races.length > 0) {
        const events = Array.from(
          new Set(data.races.map((r: Race) => r.event_name).filter((name: string | undefined): name is string => !!name))
        ).sort() as string[];
        setAvailableEvents(events);
      }
    } catch (error) {
      console.error('Failed to fetch available events:', error);
    }
  };

  const fetchAdminStatus = async () => {
    try {
      const response = await fetch(`/api/admin/athletes?admin_strava_id=${currentAthleteId}`);
      if (response.ok) {
        // If this endpoint succeeds, the user is an admin
        setIsAdmin(true);
      } else {
        setIsAdmin(false);
      }
    } catch (error) {
      console.error('Failed to fetch admin status:', error);
      setIsAdmin(false);
    }
  };

  const fetchRaces = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', pagination.limit.toString());
      params.set('offset', pagination.offset.toString());

      // Pass current viewer's athlete_id to show their hidden races
      if (currentAthleteId) {
        params.set('viewer_athlete_id', currentAthleteId.toString());
      }

      // Pass show_hidden parameter
      if (showHidden) {
        params.set('show_hidden', 'true');
      }

      // Handle multi-select athletes filter
      filters.athletes.forEach(athlete => params.append('athlete', athlete));

      // Handle multi-select events filter
      filters.events.forEach(event => params.append('event', event));

      // Handle multi-select distance filter
      filters.distances.forEach(distance => params.append('distance', distance));

      if (filters.activityName) params.set('activity_name', filters.activityName);
      if (filters.dateFrom) params.set('date_from', filters.dateFrom);
      if (filters.dateTo) params.set('date_to', filters.dateTo);

      const response = await fetch(`/api/races?${params.toString()}`);
      const data = await response.json();
      setRaces(data.races || []);
      setPagination({
        ...pagination,
        total: data.pagination?.total || 0,
      });
    } catch (error) {
      console.error('Failed to fetch races:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllFilteredRaces = async () => {
    try {
      const params = new URLSearchParams();
      params.set('limit', '10000'); // Fetch all results for summary

      // Pass current viewer's athlete_id to show their hidden races
      if (currentAthleteId) {
        params.set('viewer_athlete_id', currentAthleteId.toString());
      }

      // Pass show_hidden parameter
      if (showHidden) {
        params.set('show_hidden', 'true');
      }

      // Handle multi-select athletes filter
      filters.athletes.forEach(athlete => params.append('athlete', athlete));

      // Handle multi-select events filter
      filters.events.forEach(event => params.append('event', event));

      // Handle multi-select distance filter
      filters.distances.forEach(distance => params.append('distance', distance));

      if (filters.activityName) params.set('activity_name', filters.activityName);
      if (filters.dateFrom) params.set('date_from', filters.dateFrom);
      if (filters.dateTo) params.set('date_to', filters.dateTo);

      const response = await fetch(`/api/races?${params.toString()}`);
      const data = await response.json();
      setAllFilteredRaces(data.races || []);
    } catch (error) {
      console.error('Failed to fetch all filtered races:', error);
    }
  };

  const handleFilterChange = (newFilters: Partial<Filters>) => {
    const updatedFilters = { ...filters, ...newFilters };
    setFilters(updatedFilters);
    setPagination({ ...pagination, offset: 0 });

    // Update URL params (use pipe separator to avoid conflicts)
    const params = new URLSearchParams();
    if (updatedFilters.athletes.length > 0) {
      params.set('athletes', updatedFilters.athletes.join('|'));
    }
    if (updatedFilters.events.length > 0) {
      params.set('events', updatedFilters.events.join('|'));
    }
    if (updatedFilters.distances.length > 0) {
      params.set('distances', updatedFilters.distances.join('|'));
    }
    if (updatedFilters.activityName) {
      params.set('activityName', updatedFilters.activityName);
    }
    if (updatedFilters.dateFrom) {
      params.set('dateFrom', updatedFilters.dateFrom);
    }
    if (updatedFilters.dateTo) {
      params.set('dateTo', updatedFilters.dateTo);
    }
    setSearchParams(params, { replace: true });
  };

  const handleClearFilters = () => {
    setFilters({
      athletes: [],
      events: [],
      distances: [],
      activityName: '',
      dateFrom: getDefaultStartDate(),
      dateTo: '',
    });
    setPagination({ ...pagination, offset: 0 });
    setSearchParams({}, { replace: true });
  };

  const handleAthleteToggle = (athleteName: string) => {
    const updatedAthletes = filters.athletes.includes(athleteName)
      ? filters.athletes.filter(name => name !== athleteName)
      : [...filters.athletes, athleteName];
    handleFilterChange({ athletes: updatedAthletes });
  };

  const handlePageChange = (newOffset: number) => {
    setPagination({ ...pagination, offset: newOffset });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLimitChange = (newLimit: number) => {
    setPagination({ total: pagination.total, limit: newLimit, offset: 0 });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const totalPages = Math.ceil(pagination.total / pagination.limit);
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;

  const handleBulkEdit = async (updates: {
    event_name?: string | null;
    manual_distance?: number | null;
    is_hidden?: boolean;
  }) => {
    try {
      const response = await fetch('/api/races/bulk-edit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          admin_strava_id: currentAthleteId,
          filters: {
            athleteNames: filters.athletes,
            eventNames: filters.events,
            activityName: filters.activityName,
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
            distanceCategories: filters.distances,
            viewerAthleteId: currentAthleteId,
          },
          updates,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to perform bulk edit');
      }

      const result = await response.json();
      alert(result.message);

      // Refresh the data
      fetchRaces();
      fetchAvailableEvents();
      setShowBulkEditModal(false);
    } catch (error) {
      console.error('Error performing bulk edit:', error);
      alert(error instanceof Error ? error.message : 'Failed to perform bulk edit');
    }
  };

  return (
    <div className="dashboard">
      <div className="container">
        <div className="dashboard-header">
          <h1>Race Results</h1>
          <p className="subtitle">View and filter race activities (public activities tagged as a race on Strava) from all club members</p>
        </div>

        {loading ? (
          <div className="loading">
            <div className="spinner"></div>
            <p>Loading races...</p>
          </div>
        ) : races.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><i className="fa-solid fa-person-running"></i></div>
            <h3>No races found</h3>
            <p>
              {Object.values(filters).some((f) => f)
                ? 'Try adjusting your filters'
                : currentAthleteId
                ? 'Your races are being synced and will appear within a few hours. Initial sync may take 1-2 days during busy periods.'
                : 'Connect your Strava account to start syncing race results'}
            </p>
          </div>
        ) : (
          <>
            <AthleteSummary
              races={allFilteredRaces}
              selectedAthletes={filters.athletes}
              onAthleteToggle={handleAthleteToggle}
            />

            <RaceFilters
              filters={filters}
              onFilterChange={handleFilterChange}
              onClearFilters={handleClearFilters}
              earliestDate={earliestDate}
              availableAthletes={availableAthletes}
              availableEvents={availableEvents}
            />

            <div className="results-header">
              <span className="results-count">
                Showing {pagination.offset + 1}-{Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total} race{pagination.total !== 1 ? 's' : ''}
              </span>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '14px', cursor: 'pointer' }}>
                  <span>See hidden</span>
                  <input
                    type="checkbox"
                    checked={showHidden}
                    onChange={(e) => setShowHidden(e.target.checked)}
                    style={{
                      width: '42px',
                      height: '22px',
                      appearance: 'none',
                      backgroundColor: showHidden ? '#fc4c02' : '#ccc',
                      borderRadius: '11px',
                      position: 'relative',
                      cursor: 'pointer',
                      transition: 'background-color 0.2s',
                      outline: 'none',
                    }}
                    onMouseEnter={(e) => {
                      if (!showHidden) {
                        (e.target as HTMLInputElement).style.backgroundColor = '#bbb';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!showHidden) {
                        (e.target as HTMLInputElement).style.backgroundColor = '#ccc';
                      }
                    }}
                  />
                  <style>{`
                    input[type="checkbox"]:checked::before {
                      transform: translateX(20px);
                    }
                    input[type="checkbox"]::before {
                      content: '';
                      position: absolute;
                      width: 18px;
                      height: 18px;
                      border-radius: 50%;
                      background-color: white;
                      top: 2px;
                      left: 2px;
                      transition: transform 0.2s;
                    }
                  `}</style>
                </label>
                {isAdmin && pagination.total > 0 && (
                  <button
                    onClick={() => setShowBulkEditModal(true)}
                    className="button button-secondary"
                    style={{
                      padding: '0.5rem 1rem',
                      fontSize: '14px',
                      backgroundColor: '#fc4c02',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: '600',
                    }}
                  >
                    Bulk Edit
                  </button>
                )}
                {(isAdmin || (currentAthleteId && races.some(r => r.strava_id === currentAthleteId))) && pagination.total > 0 && !isEditMode && (
                  <button
                    onClick={() => setIsEditMode(true)}
                    className="button button-secondary"
                    style={{
                      padding: '0.5rem 1rem',
                      fontSize: '14px',
                      backgroundColor: '#667eea',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: '600',
                    }}
                  >
                    Edit
                  </button>
                )}
                {isEditMode && (
                  <>
                    <button
                      onClick={() => {
                        setIsEditMode(false);
                        fetchRaces(); // Refresh to save all changes
                      }}
                      className="button button-secondary"
                      style={{
                        padding: '0.5rem 1rem',
                        fontSize: '14px',
                        backgroundColor: '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: '600',
                      }}
                    >
                      Save edits
                    </button>
                    <button
                      onClick={() => {
                        setIsEditMode(false);
                        fetchRaces(); // Refresh to discard changes
                      }}
                      className="button button-secondary"
                      style={{
                        padding: '0.5rem 1rem',
                        fontSize: '14px',
                        backgroundColor: '#dc3545',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: '600',
                      }}
                    >
                      Cancel edits
                    </button>
                  </>
                )}
                <div className="per-page-selector">
                  <label htmlFor="racesPerPage">Per page:</label>
                  <select
                    id="racesPerPage"
                    value={pagination.limit}
                    onChange={(e) => handleLimitChange(Number(e.target.value))}
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
              </div>
            </div>
            <RaceTable
              races={races}
              currentAthleteId={currentAthleteId}
              isAdmin={isAdmin}
              onTimeUpdate={fetchRaces}
              availableEvents={availableEvents}
              onEventUpdate={() => {
                fetchRaces();
                fetchAvailableEvents();
              }}
              isEditMode={isEditMode}
            />

            {totalPages > 1 && (
              <div className="pagination">
                <button
                  className="pagination-button"
                  onClick={() => handlePageChange(pagination.offset - pagination.limit)}
                  disabled={currentPage === 1}
                >
                  Previous
                </button>
                <span className="pagination-info">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  className="pagination-button"
                  onClick={() => handlePageChange(pagination.offset + pagination.limit)}
                  disabled={currentPage === totalPages}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}

        {showBulkEditModal && (
          <BulkEditModal
            onClose={() => setShowBulkEditModal(false)}
            onSave={handleBulkEdit}
            availableEvents={availableEvents}
            affectedCount={pagination.total}
          />
        )}
      </div>
    </div>
  );
}

interface BulkEditModalProps {
  onClose: () => void;
  onSave: (updates: {
    event_name?: string | null;
    manual_distance?: number | null;
    is_hidden?: boolean;
  }) => Promise<void>;
  availableEvents: string[];
  affectedCount: number;
}

function BulkEditModal({ onClose, onSave, availableEvents, affectedCount }: BulkEditModalProps) {
  const [eventName, setEventName] = useState<string>('');
  const [shouldUpdateEvent, setShouldUpdateEvent] = useState(false);
  const [shouldClearEvent, setShouldClearEvent] = useState(false);
  const [distance, setDistance] = useState<string>('');
  const [shouldUpdateDistance, setShouldUpdateDistance] = useState(false);
  const [visibility, setVisibility] = useState<'show' | 'hide' | ''>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const filteredEvents = availableEvents.filter(event =>
    event.toLowerCase().includes(eventName.toLowerCase())
  );

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updates: {
        event_name?: string | null;
        manual_distance?: number | null;
        is_hidden?: boolean;
      } = {};

      if (shouldUpdateEvent) {
        if (shouldClearEvent) {
          updates.event_name = null;
        } else if (eventName.trim()) {
          updates.event_name = eventName.trim();
        }
      }

      if (shouldUpdateDistance && distance.trim()) {
        const km = parseFloat(distance);
        if (!isNaN(km) && km > 0) {
          updates.manual_distance = Math.round(km * 1000);
        }
      }

      if (visibility === 'show') {
        updates.is_hidden = false;
      } else if (visibility === 'hide') {
        updates.is_hidden = true;
      }

      if (Object.keys(updates).length === 0) {
        alert('Please select at least one field to update');
        return;
      }

      await onSave(updates);
    } catch (error) {
      console.error('Error saving bulk edit:', error);
    } finally {
      setIsSaving(false);
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
          setEventName(filteredEvents[highlightedIndex]);
          setIsDropdownOpen(false);
        }
        break;
      case 'Escape':
        e.preventDefault();
        if (isDropdownOpen) {
          setIsDropdownOpen(false);
        }
        break;
    }
  };

  return (
    <div
      className="modal-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="modal-content"
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '2rem',
          maxWidth: '500px',
          width: '90%',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0 }}>Bulk Edit Activities</h2>
        <p style={{ color: '#666', marginBottom: '1.5rem' }}>
          This will update {affectedCount} activit{affectedCount !== 1 ? 'ies' : 'y'} matching the current filters.
        </p>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
            <input
              type="checkbox"
              checked={shouldUpdateEvent}
              onChange={(e) => {
                setShouldUpdateEvent(e.target.checked);
                if (!e.target.checked) {
                  setShouldClearEvent(false);
                }
              }}
              style={{ marginRight: '0.5rem' }}
            />
            <strong>Update Event Name</strong>
          </label>
          {shouldUpdateEvent && (
            <div style={{ marginLeft: '1.5rem', position: 'relative' }}>
              <label style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={shouldClearEvent}
                  onChange={(e) => {
                    setShouldClearEvent(e.target.checked);
                    if (e.target.checked) {
                      setEventName('');
                      setIsDropdownOpen(false);
                    }
                  }}
                  style={{ marginRight: '0.5rem' }}
                />
                Clear event name (set to blank)
              </label>
              {!shouldClearEvent && (
                <>
                  <input
                    type="text"
                    value={eventName}
                    onChange={(e) => {
                      setEventName(e.target.value);
                      setIsDropdownOpen(true);
                      setHighlightedIndex(0);
                    }}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setIsDropdownOpen(true)}
                    placeholder="Enter event name..."
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      border: '1px solid #ccc',
                      borderRadius: '4px',
                      fontSize: '14px',
                    }}
                  />
                  {isDropdownOpen && filteredEvents.length > 0 && (
                    <ul
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        zIndex: 1000,
                        background: 'white',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        maxHeight: '200px',
                        overflowY: 'auto',
                        listStyle: 'none',
                        margin: '4px 0',
                        padding: 0,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                      }}
                    >
                      {filteredEvents.slice(0, 50).map((event, index) => (
                        <li
                          key={event}
                          onClick={() => {
                            setEventName(event);
                            setIsDropdownOpen(false);
                          }}
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
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
            <input
              type="checkbox"
              checked={shouldUpdateDistance}
              onChange={(e) => setShouldUpdateDistance(e.target.checked)}
              style={{ marginRight: '0.5rem' }}
            />
            <strong>Update Distance</strong>
          </label>
          {shouldUpdateDistance && (
            <div style={{ marginLeft: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="text"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
                placeholder="5.00"
                style={{
                  width: '100px',
                  padding: '0.5rem',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  fontSize: '14px',
                }}
              />
              <span>km</span>
            </div>
          )}
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <strong style={{ display: 'block', marginBottom: '0.5rem' }}>Visibility</strong>
          <div style={{ marginLeft: '1.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
              <input
                type="radio"
                name="visibility"
                value=""
                checked={visibility === ''}
                onChange={(e) => setVisibility(e.target.value as '')}
                style={{ marginRight: '0.5rem' }}
              />
              No change
            </label>
            <label style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
              <input
                type="radio"
                name="visibility"
                value="show"
                checked={visibility === 'show'}
                onChange={(e) => setVisibility(e.target.value as 'show')}
                style={{ marginRight: '0.5rem' }}
              />
              Show all
            </label>
            <label style={{ display: 'flex', alignItems: 'center' }}>
              <input
                type="radio"
                name="visibility"
                value="hide"
                checked={visibility === 'hide'}
                onChange={(e) => setVisibility(e.target.value as 'hide')}
                style={{ marginRight: '0.5rem' }}
              />
              Hide all
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={isSaving}
            style={{
              padding: '0.5rem 1rem',
              border: '1px solid #ccc',
              borderRadius: '4px',
              backgroundColor: 'white',
              cursor: isSaving ? 'wait' : 'pointer',
              fontSize: '14px',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#fc4c02',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isSaving ? 'wait' : 'pointer',
              fontSize: '14px',
              fontWeight: '600',
            }}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
