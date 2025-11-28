import { useState } from 'react';
import MultiSelectAutocomplete from './MultiSelectAutocomplete';
import './RaceFilters.css';

interface Filters {
  athletes: string[];
  events: string[];
  distances: string[];
  activityName: string;
  dateFrom: string;
  dateTo: string;
}

interface RaceFiltersProps {
  filters: Filters;
  onFilterChange: (filters: Partial<Filters>) => void;
  onClearFilters: () => void;
  earliestDate?: string;
  availableAthletes?: string[];
  availableEvents?: string[];
}

// Distance categories
const DISTANCE_OPTIONS = [
  '5K',
  '10K',
  '14K',
  'Half Marathon',
  '30K',
  'Marathon',
  'Ultra',
  'Other',
];

export default function RaceFilters({
  filters,
  onFilterChange,
  onClearFilters,
  earliestDate,
  availableAthletes = [],
  availableEvents = [],
}: RaceFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getDefaultDateTo = () => new Date().toISOString().split('T')[0];

  // Get active filters for display
  const getActiveFilters = () => {
    const active: { label: string; count?: number }[] = [];

    if (filters.athletes.length > 0) {
      active.push({ label: 'Athletes', count: filters.athletes.length });
    }

    if (filters.events.length > 0) {
      active.push({ label: 'Events', count: filters.events.length });
    }

    if (filters.distances.length > 0) {
      active.push({ label: 'Distances', count: filters.distances.length });
    }

    if (filters.activityName) {
      active.push({ label: 'Name' });
    }

    // Check if date range is filtered (not showing all available dates)
    const defaultFrom = earliestDate || '';
    const defaultTo = getDefaultDateTo();
    const isDateFiltered =
      (filters.dateFrom && filters.dateFrom !== defaultFrom) ||
      (filters.dateTo && filters.dateTo !== defaultTo);

    if (isDateFiltered) {
      active.push({ label: 'Date Range' });
    }

    return active;
  };

  const activeFilters = getActiveFilters();

  const handleDateFromChange = (value: string) => {
    let dateFrom = value;
    // Enforce minimum date to earliest available data
    if (earliestDate && dateFrom && dateFrom < earliestDate) {
      dateFrom = earliestDate;
    }
    // Enforce that dateFrom is not after dateTo
    if (filters.dateTo && dateFrom > filters.dateTo) {
      dateFrom = filters.dateTo;
    }
    onFilterChange({ dateFrom });
  };

  const handleDateToChange = (value: string) => {
    let dateTo = value;
    // Enforce maximum date to today
    const today = getDefaultDateTo();
    if (dateTo && dateTo > today) {
      dateTo = today;
    }
    // Enforce that dateTo is not before dateFrom
    if (filters.dateFrom && dateTo < filters.dateFrom) {
      dateTo = filters.dateFrom;
    }
    onFilterChange({ dateTo });
  };

  const handleClear = () => {
    onClearFilters();
  };

  return (
    <div className="race-filters">
      <div className="filters-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="filters-header-content" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
          <span className="filters-toggle" style={{ display: 'flex', alignItems: 'center' }}>
            {isExpanded ? <i className="fa-solid fa-chevron-down"></i> : <i className="fa-solid fa-chevron-right"></i>}
          </span>
          <h3 className="filters-title">Filters</h3>
          {!isExpanded && activeFilters.length > 0 && (
            <div className="active-filters-pills">
              {activeFilters.map((filter) => (
                <span key={filter.label} className="filter-pill">
                  {filter.label}
                  {filter.count && <span className="filter-count">{filter.count}</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="filters-grid">
          {/* First row: Athletes */}
          <div className="filter-group filter-group-wide">
            <MultiSelectAutocomplete
              options={availableAthletes}
              selected={filters.athletes}
              onChange={athletes => onFilterChange({ athletes })}
              placeholder="Select athletes..."
              label="Filter by Athletes"
            />
          </div>

          {/* Second row: Events and Activity Name */}
          <div className="filter-group">
            <MultiSelectAutocomplete
              options={availableEvents}
              selected={filters.events}
              onChange={events => onFilterChange({ events })}
              placeholder="Select events..."
              label="Filter by Event"
            />
          </div>

          <div className="filter-group">
            <label htmlFor="activityName">Activity Name</label>
            <input
              id="activityName"
              type="text"
              placeholder="Search by activity..."
              value={filters.activityName}
              onChange={(e) => onFilterChange({ activityName: e.target.value })}
            />
          </div>

          {/* Third row: Date Range and Distance */}
          {earliestDate && (
            <div className="filter-group">
              <label>Date Range</label>
              <div className="date-range-inputs">
                <div className="date-input-wrapper">
                  <input
                    type="date"
                    min={earliestDate}
                    max={filters.dateTo || getDefaultDateTo()}
                    value={filters.dateFrom || earliestDate}
                    onChange={(e) => handleDateFromChange(e.target.value)}
                    className="date-input"
                  />
                  <button
                    type="button"
                    onClick={() => handleDateFromChange(earliestDate)}
                    className="date-shortcut-link"
                    title="Set to earliest date"
                  >
                    min
                  </button>
                </div>
                <span className="date-separator">to</span>
                <div className="date-input-wrapper">
                  <input
                    type="date"
                    min={filters.dateFrom || earliestDate}
                    max={getDefaultDateTo()}
                    value={filters.dateTo || getDefaultDateTo()}
                    onChange={(e) => handleDateToChange(e.target.value)}
                    className="date-input"
                  />
                  <button
                    type="button"
                    onClick={() => handleDateToChange(getDefaultDateTo())}
                    className="date-shortcut-link"
                    title="Set to today"
                  >
                    today
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="filter-group">
            <MultiSelectAutocomplete
              options={DISTANCE_OPTIONS}
              selected={filters.distances}
              onChange={distances => onFilterChange({ distances })}
              placeholder="Select distances..."
              label="Filter by Distance"
            />
          </div>

          {/* Clear Filters Button */}
          <div className="filter-group filter-actions">
            <button
              className="clear-filters-btn"
              onClick={handleClear}
            >
              Clear Filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
