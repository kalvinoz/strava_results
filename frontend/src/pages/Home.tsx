import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import './Home.css';
import { fetchApi, ApiMaintenanceError } from '../utils/api';

interface Stats {
  athletes: number;
  total_races: number;
  total_distance_km: number;
  parkrun_athletes: number;
  parkrun_results: number;
  parkrun_events: number;
}

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [athleteFirstname, setAthleteFirstname] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStats();
    checkAdminStatus();
    checkLoggedInStatus();
  }, []);

  const checkLoggedInStatus = async () => {
    const athleteId = localStorage.getItem('strava_athlete_id');
    if (!athleteId) {
      setIsLoggedIn(false);
      return;
    }

    setIsLoggedIn(true);

    // Fetch athlete's first name
    try {
      const response = await fetch('/api/athletes');
      if (response.ok) {
        const data = await response.json();
        const athlete = data.athletes?.find((a: any) => a.strava_id === parseInt(athleteId));
        if (athlete) {
          setAthleteFirstname(athlete.firstname);
        }
      }
    } catch (error) {
      console.error('[HOME] Failed to fetch athlete info:', error);
    }
  };

  const checkAdminStatus = async () => {
    try {
      const athleteId = localStorage.getItem('strava_athlete_id');
      if (!athleteId) return;

      const response = await fetch(`/api/admin/check?strava_id=${athleteId}`);
      if (response.ok) {
        const data = await response.json();
        setIsAdmin(data.is_admin === true);
      }
    } catch (error) {
      console.error('[HOME] Failed to check admin status:', error);
    }
  };

  const fetchStats = async () => {
    console.log('[HOME] Fetching stats from /api/stats...');
    try {
      const data = await fetchApi<Stats>('/api/stats');
      console.log('[HOME] Stats data received:', data);
      setStats(data);
      setError(null);
      console.log('[HOME] Stats state updated');
    } catch (err) {
      console.error('[HOME] Failed to fetch stats:', err);
      if (err instanceof ApiMaintenanceError) {
        setError(err.message);
      }
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchStats();
    setTimeout(() => setRefreshing(false), 500);
  };

  const handleConnectStrava = () => {
    window.location.href = 'https://strava-club-workers.pedroqueiroz.workers.dev/auth/authorize';
  };

  return (
    <div className="home">
      <div className="container">
        <div className="hero">
          <h1 className="hero-title">
            Track Woodstock Runners'
            <br />
            <span className="gradient-text">Race Results</span>
          </h1>
          <p className="hero-subtitle">
            Upload Strava activities for your races and view club-wide results in one place
          </p>

          <div className="hero-buttons">
            {isLoggedIn && athleteFirstname ? (
              <div className="greeting-text">
                G'day, {athleteFirstname}!
              </div>
            ) : (
              <button
                onClick={handleConnectStrava}
                className="button button-primary button-large"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginRight: '0.5rem' }}>
                  <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/>
                </svg>
                Connect with Strava
              </button>
            )}
          </div>

          {isLoggedIn && (
            <>
              <div className="hero-buttons hero-buttons-secondary">
                <Link to="/dashboard" className="button button-secondary">
                  View Races
                </Link>
                <Link to="/parkrun" className="button button-secondary">
                  View Parkrun
                </Link>
              </div>

              <div className="hero-buttons" style={{ marginTop: '1rem' }}>
                <Link to="/submit-activities" className="button button-tertiary">
                  Manually upload Strava activities
                </Link>
              </div>
            </>
          )}
        </div>

        <div style={{
          textAlign: 'center',
          padding: '1.5rem',
          marginBottom: '1.5rem',
          backgroundColor: '#f8fafc',
          borderRadius: '8px',
          fontSize: '0.95rem',
          lineHeight: '1.6',
          color: '#475569',
        }}>
          <p style={{ margin: 0 }}>
            This page is for Woodies to share their results and parkrun participation.
            If you want to learn more about Woodstock Runners,<br />
            visit our{' '}
            <a href="https://www.woodstockrunners.org.au/" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
              website
            </a>, and check out our{' '}
            <a href="https://www.instagram.com/woodstockrunners/" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
              Instagram
            </a>{' '}and{' '}
            <a href="https://www.facebook.com/woodstockrunners/" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
              Facebook
            </a>{' '}pages.
          </p>
        </div>

        {error && (
          <div className="error-banner" style={{
            padding: '1rem',
            marginBottom: '1rem',
            backgroundColor: '#fef3c7',
            borderRadius: '8px',
            textAlign: 'center',
            color: '#92400e',
          }}>
            {error}
          </div>
        )}

        <div className="stats-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 className="stats-section-title" style={{ margin: 0 }}>Strava Results</h2>
            {isAdmin && (
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="button button-secondary"
                style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
              >
                {refreshing ? <><i className="fa-solid fa-rotate fa-spin"></i> Refreshing...</> : <><i className="fa-solid fa-rotate"></i> Refresh</>}
              </button>
            )}
          </div>
          <div className="stats-grid">
            {stats ? (
              <>
                <div className="stat-card">
                  <div className="stat-value">{stats.athletes.toLocaleString()}</div>
                  <div className="stat-label">woodies</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{stats.total_races.toLocaleString()}</div>
                  <div className="stat-label">races</div>
                </div>
                <div className="stat-card stat-card-km">
                  <div className="stat-value-km">
                    <span className="stat-km-number">{(stats.total_distance_km ?? 0).toLocaleString()}</span>
                    <span className="stat-km-unit">km</span>
                  </div>
                  <div className="stat-label-km">raced</div>
                </div>
              </>
            ) : (
              <>
                <div className="stat-card stat-card-loading">
                  <div className="stat-value">-</div>
                  <div className="stat-label">woodies</div>
                </div>
                <div className="stat-card stat-card-loading">
                  <div className="stat-value">-</div>
                  <div className="stat-label">races</div>
                </div>
                <div className="stat-card stat-card-loading stat-card-km">
                  <div className="stat-value-km">
                    <span className="stat-km-number">-</span>
                    <span className="stat-km-unit">km</span>
                  </div>
                  <div className="stat-label-km">raced</div>
                </div>
              </>
            )}
          </div>

          <h2 className="stats-section-title">parkrun</h2>
          <div className="stats-grid stats-grid-parkrun">
            {stats ? (
              <>
                <div className="stat-card">
                  <div className="stat-value">{stats.parkrun_athletes.toLocaleString()}</div>
                  <div className="stat-label">parkrunners</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{stats.parkrun_results.toLocaleString()}</div>
                  <div className="stat-label">parkruns</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{stats.parkrun_events.toLocaleString()}</div>
                  <div className="stat-label">distinct events</div>
                </div>
              </>
            ) : (
              <>
                <div className="stat-card stat-card-loading">
                  <div className="stat-value">-</div>
                  <div className="stat-label">parkrunners</div>
                </div>
                <div className="stat-card stat-card-loading">
                  <div className="stat-value">-</div>
                  <div className="stat-label">parkruns</div>
                </div>
                <div className="stat-card stat-card-loading">
                  <div className="stat-value">-</div>
                  <div className="stat-label">distinct events</div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="features">
          <h2 className="features-title">How It Works</h2>
          <div className="features-grid">
            <div className="feature">
              <div className="feature-icon"><i className="fa-solid fa-link"></i></div>
              <h3 className="feature-title">Connect Your Strava</h3>
              <p className="feature-text">
                Securely link your Strava account with one click. We only access activities you've marked as races.
              </p>
            </div>
            <div className="feature">
              <div className="feature-icon"><i className="fa-solid fa-rotate"></i></div>
              <h3 className="feature-title">Automatic Sync</h3>
              <p className="feature-text">
                Race results sync automatically every day. Just mark your activity as a "Race" in Strava.
              </p>
            </div>
            <div className="feature">
              <div className="feature-icon"><i className="fa-solid fa-chart-column"></i></div>
              <h3 className="feature-title">View Club Results</h3>
              <p className="feature-text">
                See all club members' race results in one dashboard. Filter by date, distance, or athlete.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
