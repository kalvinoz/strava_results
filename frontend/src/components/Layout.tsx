import { Outlet, Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import './Layout.css';

export default function Layout() {
  const location = useLocation();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);

  useEffect(() => {
    // Check if current user is signed in and if they're an admin
    const checkAuth = async () => {
      const athleteId = localStorage.getItem('strava_athlete_id');
      setIsSignedIn(!!athleteId);

      if (!athleteId) return;

      try {
        const response = await fetch(
          `/api/admin/athletes?admin_strava_id=${athleteId}`
        );
        setIsAdmin(response.ok);
      } catch {
        setIsAdmin(false);
      }
    };

    checkAuth();
  }, []);

  return (
    <div className="layout">
      <header className="header">
        <div className="container">
          <div className="header-content">
            <Link to="/" className="logo">
              <span className="logo-icon"><i className="fa-solid fa-person-running"></i></span>
              <span className="logo-text">Woodstock Runners results</span>
            </Link>
            <nav className="nav">
              <Link
                to="/"
                className={`nav-link ${location.pathname === '/' ? 'active' : ''}`}
              >
                Home
              </Link>
              {isSignedIn && (
                <>
                  <Link
                    to="/dashboard"
                    className={`nav-link ${location.pathname === '/dashboard' || location.pathname === '/races' ? 'active' : ''}`}
                  >
                    Races
                  </Link>
                  <Link
                    to="/parkrun"
                    className={`nav-link ${location.pathname === '/parkrun' ? 'active' : ''}`}
                  >
                    Parkrun
                  </Link>
                  <Link
                    to="/heatmap"
                    className={`nav-link ${location.pathname === '/heatmap' ? 'active' : ''}`}
                  >
                    Heatmap
                  </Link>
                </>
              )}
              {isAdmin && (
                <Link
                  to="/admin"
                  className={`nav-link ${location.pathname === '/admin' ? 'active' : ''}`}
                >
                  Admin
                </Link>
              )}
            </nav>
          </div>
        </div>
      </header>

      <main className="main">
        <Outlet />
      </main>

      <footer className="footer">
        <div className="container">
          <p>
            Powered by{' '}
            <a href="https://www.strava.com" target="_blank" rel="noopener noreferrer">Strava</a>
            {' • '}
            <a href="https://www.parkrun.com.au" target="_blank" rel="noopener noreferrer">Parkrun</a>
            {' • '}
            <a href="https://github.com" target="_blank" rel="noopener noreferrer">Github</a>
            {' • '}
            <a href="https://www.cloudflare.com" target="_blank" rel="noopener noreferrer">Cloudflare</a>
          </p>
          <p style={{ fontSize: '0.75rem', marginTop: '0.5rem', opacity: 0.6 }}>
            <a href="https://strava-club-workers.pedroqueiroz.workers.dev/auth/google/login" style={{ color: 'inherit', textDecoration: 'none' }}>
              Admin Login
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
