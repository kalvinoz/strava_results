import { useState } from 'react';
import './AthleteSummary.css';

interface Race {
  id: number;
  strava_activity_id: number;
  name: string;
  distance: number;
  elapsed_time: number;
  moving_time: number;
  manual_time?: number;
  manual_distance?: number;
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

interface AthleteSummaryProps {
  races: Race[];
  selectedAthletes?: string[];
  onAthleteToggle?: (athleteName: string) => void;
}

interface AthleteStat {
  athleteName: string;
  profilePhoto?: string;
  activityCount: number;
  totalDistance: number;
  totalTime: number;
  averagePace: number;
}

export default function AthleteSummary({ races, selectedAthletes = [], onAthleteToggle }: AthleteSummaryProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [isCollapsed, setIsCollapsed] = useState(true);

  // Filter out hidden races before calculating statistics
  const visibleRaces = races.filter(race => !race.is_hidden);

  // Group races by athlete and calculate statistics
  const athleteStats = visibleRaces.reduce((acc, race) => {
    const athleteKey = `${race.firstname} ${race.lastname}`;

    if (!acc[athleteKey]) {
      acc[athleteKey] = {
        athleteName: athleteKey,
        profilePhoto: race.profile_photo,
        activityCount: 0,
        totalDistance: 0,
        totalTime: 0,
      };
    }

    // Use manual values if available, otherwise use Strava values
    const distance = race.manual_distance || race.distance;
    const time = race.manual_time || race.moving_time;

    acc[athleteKey].activityCount += 1;
    acc[athleteKey].totalDistance += distance;
    acc[athleteKey].totalTime += time;

    return acc;
  }, {} as Record<string, Omit<AthleteStat, 'averagePace'>>);

  // Calculate average pace and convert to final format
  const summaryData: AthleteStat[] = Object.values(athleteStats).map((stat) => ({
    ...stat,
    averagePace: stat.totalDistance > 0 ? (stat.totalTime / 60) / (stat.totalDistance / 1000) : 0,
  }));

  // Sort by activity count descending
  summaryData.sort((a, b) => b.activityCount - a.activityCount);

  // Pagination logic
  const totalAthletes = summaryData.length;
  const showAll = itemsPerPage === -1;
  const paginatedData = showAll
    ? summaryData
    : summaryData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = showAll ? 1 : Math.ceil(totalAthletes / itemsPerPage);

  // Reset to page 1 when items per page changes
  const handleItemsPerPageChange = (value: number) => {
    setItemsPerPage(value);
    setCurrentPage(1);
  };

  const handleAthleteClick = (athleteName: string) => {
    if (onAthleteToggle) {
      onAthleteToggle(athleteName);
    }
  };

  const formatDistance = (meters: number) => {
    return (meters / 1000).toFixed(2);
  };

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m ${secs}s`;
  };

  const formatPace = (paceMinPerKm: number) => {
    if (!isFinite(paceMinPerKm) || paceMinPerKm <= 0) {
      return '-';
    }
    const minutes = Math.floor(paceMinPerKm);
    const seconds = Math.round((paceMinPerKm - minutes) * 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (summaryData.length === 0) {
    return null;
  }

  return (
    <div className="athlete-summary">
      <div className="summary-header">
        <h2 className="summary-title" onClick={() => setIsCollapsed(!isCollapsed)} style={{ cursor: 'pointer', userSelect: 'none', fontSize: '1.125rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {isCollapsed ? <i className="fa-solid fa-chevron-right"></i> : <i className="fa-solid fa-chevron-down"></i>}
          <span>Runners</span>
        </h2>
        {!isCollapsed && (
          <div className="summary-controls">
            <span className="summary-count">
              Showing {showAll ? totalAthletes : `${(currentPage - 1) * itemsPerPage + 1}-${Math.min(currentPage * itemsPerPage, totalAthletes)}`} of {totalAthletes} athlete{totalAthletes !== 1 ? 's' : ''}
            </span>
            <div className="per-page-selector">
              <label htmlFor="itemsPerPage">Per page:</label>
              <select
                id="itemsPerPage"
                value={itemsPerPage}
                onChange={(e) => handleItemsPerPageChange(Number(e.target.value))}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={-1}>All</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {!isCollapsed && (
        <>
          <div className="summary-table-container">
            <table className="summary-table">
              <thead>
                <tr>
                  <th>Athlete</th>
                  <th>Races</th>
                  <th>Total Distance</th>
                  <th>Total Time</th>
                  <th>Avg Pace</th>
                </tr>
              </thead>
              <tbody>
                {paginatedData.map((stat) => {
                  const isSelected = selectedAthletes.includes(stat.athleteName);
                  return (
                    <tr key={stat.athleteName} className={isSelected ? 'selected-athlete' : ''}>
                      <td>
                        <div className="athlete-cell">
                          {stat.profilePhoto && (
                            <img
                              src={stat.profilePhoto}
                              alt={stat.athleteName}
                              className="athlete-avatar-small"
                            />
                          )}
                          <span
                            className="athlete-name-clickable"
                            onClick={() => handleAthleteClick(stat.athleteName)}
                            title={isSelected ? 'Click to remove from filter' : 'Click to add to filter'}
                          >
                            {stat.athleteName}
                          </span>
                        </div>
                      </td>
                      <td>{stat.activityCount}</td>
                      <td>{formatDistance(stat.totalDistance)} km</td>
                      <td>{formatTime(stat.totalTime)}</td>
                      <td>{formatPace(stat.averagePace)} /km</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!showAll && totalPages > 1 && (
            <div className="summary-pagination">
              <button
                className="pagination-button"
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span className="pagination-info">
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="pagination-button"
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
