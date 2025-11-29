import { useState, useEffect } from 'react';
import './ParkrunWeeklySummary.css';

interface WeeklySummary {
  date: string;
  availableDates: string[];
  summary: {
    athleteCount: number;
    eventCount: number;
  };
  popularEvents: Array<{ name: string; count: number }>;
  firstTimeEvents: string[];
  rarePokemons: Array<{ name: string; visitCount: number }>;
}

interface MilestoneData {
  date: string;
  achieved: Array<{
    milestone: number;
    athletes: Array<{ name: string; event: string; parkrun_id: string | null }>;
  }>;
  upcoming: Array<{
    milestone: number;
    athletes: Array<{ name: string; count: number; parkrun_id: string | null }>;
  }>;
}

export default function ParkrunWeeklySummary() {
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [showCalendar, setShowCalendar] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isAdmin, setIsAdmin] = useState(false);
  const [milestones, setMilestones] = useState<MilestoneData | null>(null);

  // Check admin status on mount
  useEffect(() => {
    const checkAdminStatus = async () => {
      const stravaId = localStorage.getItem('strava_athlete_id');
      if (stravaId) {
        try {
          const response = await fetch(`/api/admin/athletes?admin_strava_id=${stravaId}`);
          setIsAdmin(response.ok);
        } catch {
          setIsAdmin(false);
        }
      }
    };
    checkAdminStatus();
  }, []);

  useEffect(() => {
    fetchSummary(selectedDate);
    if (selectedDate) {
      fetchMilestones(selectedDate);
    }
  }, [selectedDate]);

  async function fetchMilestones(date: string) {
    try {
      const response = await fetch(`/api/parkrun/milestones?date=${date}`);
      if (response.ok) {
        const data = await response.json();
        setMilestones(data);
      }
    } catch (error) {
      console.error('Error fetching milestones:', error);
    }
  }

  useEffect(() => {
    if (selectedDate) {
      setCurrentMonth(new Date(selectedDate));
    }
  }, [selectedDate]);

  // Close calendar when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (showCalendar && !target.closest('.date-picker')) {
        setShowCalendar(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCalendar]);

  async function fetchSummary(date?: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (date) {
        params.append('date', date);
      }

      const response = await fetch(`/api/parkrun/weekly-summary?${params}`);
      if (!response.ok) {
        throw new Error('Failed to fetch weekly summary');
      }

      const data = await response.json();
      setSummary(data);
      if (!selectedDate && data.date) {
        setSelectedDate(data.date);
      }
    } catch (error) {
      console.error('Error fetching weekly summary:', error);
    } finally {
      setLoading(false);
    }
  }

  function handleDateSelect(date: string) {
    setSelectedDate(date);
    setShowCalendar(false);
  }

  function jumpToMostRecent() {
    if (summary && summary.availableDates.length > 0) {
      const mostRecent = summary.availableDates[0]; // Array is sorted DESC
      setSelectedDate(mostRecent);
      setCurrentMonth(new Date(mostRecent));
    }
  }

  function handleMonthChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const newMonth = parseInt(event.target.value);
    setCurrentMonth(new Date(currentMonth.getFullYear(), newMonth, 1));
  }

  function handleYearChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const newYear = parseInt(event.target.value);
    setCurrentMonth(new Date(newYear, currentMonth.getMonth(), 1));
  }

  function previousMonth() {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  }

  function nextMonth() {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  }

  if (loading || !summary) {
    return <div className="weekly-summary loading">Loading weekly summary...</div>;
  }

  const availableDatesSet = new Set(summary.availableDates);

  // Get available years from available dates
  const availableYears = Array.from(
    new Set(summary.availableDates.map(date => new Date(date).getFullYear()))
  ).sort((a, b) => b - a); // Descending order

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Generate calendar days for current month
  function generateCalendar() {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days: Array<{ date: string; day: number; isAvailable: boolean; isSelected: boolean }> = [];

    // Add empty cells for days before the start of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push({ date: '', day: 0, isAvailable: false, isSelected: false });
    }

    // Add all days in the month
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isAvailable = availableDatesSet.has(dateStr);
      const isSelected = dateStr === selectedDate;
      days.push({ date: dateStr, day, isAvailable, isSelected });
    }

    return days;
  }

  const calendarDays = generateCalendar();
  const formattedDate = new Date(selectedDate).toLocaleDateString('en-AU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div className="weekly-summary">
      <div className="summary-header">
        <h2>Woodstock weekly summary - {formattedDate}</h2>
        <div className="date-picker">
          <button
            onClick={() => setShowCalendar(!showCalendar)}
            className="date-picker-button"
          >
            {showCalendar ? 'Close Calendar' : 'Change Date'}
          </button>

          {showCalendar && (
            <div className="calendar-dropdown">
              <div className="calendar-controls">
                <button onClick={jumpToMostRecent} className="jump-to-recent">
                  Jump to most recent
                </button>
              </div>

              <div className="calendar-header">
                <button onClick={previousMonth} className="nav-button">‹</button>
                <div className="date-selectors">
                  <select
                    value={currentMonth.getMonth()}
                    onChange={handleMonthChange}
                    className="month-select"
                  >
                    {months.map((month, index) => (
                      <option key={index} value={index}>
                        {month}
                      </option>
                    ))}
                  </select>
                  <select
                    value={currentMonth.getFullYear()}
                    onChange={handleYearChange}
                    className="year-select"
                  >
                    {availableYears.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </div>
                <button onClick={nextMonth} className="nav-button">›</button>
              </div>

              <div className="calendar-grid">
                <div className="calendar-day-header">Sun</div>
                <div className="calendar-day-header">Mon</div>
                <div className="calendar-day-header">Tue</div>
                <div className="calendar-day-header">Wed</div>
                <div className="calendar-day-header">Thu</div>
                <div className="calendar-day-header">Fri</div>
                <div className="calendar-day-header">Sat</div>

                {calendarDays.map((day, index) => (
                  <div
                    key={index}
                    className={`calendar-day ${day.isAvailable ? 'available' : ''} ${day.isSelected ? 'selected' : ''}`}
                    onClick={() => day.isAvailable && handleDateSelect(day.date)}
                  >
                    {day.day || ''}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="summary-stats">
        <p>
          <i className="fa-solid fa-shoe-prints"></i> <strong>{summary.summary.athleteCount}</strong> Woodie{summary.summary.athleteCount !== 1 ? 's' : ''} across{' '}
          <strong>{summary.summary.eventCount}</strong> different event{summary.summary.eventCount !== 1 ? 's' : ''}
        </p>

        {summary.popularEvents.length > 0 && (
          <p>
            <i className="fa-solid fa-trophy"></i> <strong>Most popular events:</strong>{' '}
            {summary.popularEvents.map((event, index) => (
              <span key={event.name}>
                {index > 0 && ', '}
                {event.name} ({event.count})
              </span>
            ))}
          </p>
        )}

        {summary.firstTimeEvents.length > 0 && (
          <p>
            <i className="fa-solid fa-champagne-glasses"></i> <strong>First Woodies visit:</strong>{' '}
            {summary.firstTimeEvents.join(', ')}
          </p>
        )}

        {summary.rarePokemons.length > 0 && (
          <p>
            <i className="fa-solid fa-wand-sparkles"></i> <strong>Rare Pokémons:</strong>{' '}
            {summary.rarePokemons.map((pokemon, index) => (
              <span key={pokemon.name}>
                {index > 0 && ', '}
                {pokemon.name} ({getOrdinal(pokemon.visitCount)} Woodies visit)
              </span>
            ))}
          </p>
        )}
      </div>

      {/* Milestones section - admin only */}
      {isAdmin && milestones && (
        <div className="milestones-section">
          <h3><i className="fa-solid fa-medal"></i> Milestones</h3>

          {/* Achieved milestones */}
          <div className="milestone-group">
            <strong>Achieved this week:</strong>
            {milestones.achieved.length > 0 ? (
              <ul className="milestone-list">
                {milestones.achieved.map(group => (
                  <li key={group.milestone}>
                    <span className="milestone-number">{group.milestone}:</span>{' '}
                    {group.athletes.map((athlete, index) => (
                      <span key={athlete.name}>
                        {index > 0 && ', '}
                        {athlete.parkrun_id ? (
                          <a
                            href={`https://www.parkrun.com.au/parkrunner/${athlete.parkrun_id}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {athlete.name}
                          </a>
                        ) : (
                          athlete.name
                        )}
                        {' '}({athlete.event})
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="no-milestones">No milestones this week</p>
            )}
          </div>

          {/* Upcoming milestones */}
          <div className="milestone-group">
            <strong>Upcoming:</strong>
            {milestones.upcoming.length > 0 ? (
              <ul className="milestone-list">
                {milestones.upcoming.map(group => (
                  <li key={group.milestone}>
                    <span className="milestone-number">{group.milestone}:</span>{' '}
                    {group.athletes.map((athlete, index) => (
                      <span key={athlete.name}>
                        {index > 0 && ', '}
                        {athlete.parkrun_id ? (
                          <a
                            href={`https://www.parkrun.com.au/parkrunner/${athlete.parkrun_id}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {athlete.name}
                          </a>
                        ) : (
                          athlete.name
                        )}
                        {' '}({athlete.count})
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="no-milestones">No upcoming milestones</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function getOrdinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const value = n % 100;
  return n + (suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]);
}
