import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import './App.css';

// Lazy load page components for code splitting
const Home = lazy(() => import('./pages/Home'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Parkrun = lazy(() => import('./pages/Parkrun'));
const Admin = lazy(() => import('./pages/Admin'));
const SyncMonitor = lazy(() => import('./pages/SyncMonitor'));
const Heatmap = lazy(() => import('./pages/Heatmap'));
const SubmitActivities = lazy(() => import('./pages/SubmitActivities'));
const SubmitActivitiesReview = lazy(() => import('./pages/SubmitActivitiesReview'));

// Protected route component that redirects to home if not signed in
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isSignedIn = !!localStorage.getItem('strava_athlete_id');

  if (!isSignedIn) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route
          index
          element={
            <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
              <Home />
            </Suspense>
          }
        />
        <Route
          path="races"
          element={
            <ProtectedRoute>
              <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
                <Dashboard />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="parkrun"
          element={
            <ProtectedRoute>
              <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
                <Parkrun />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="admin"
          element={
            <ProtectedRoute>
              <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
                <Admin />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="admin/:tab"
          element={
            <ProtectedRoute>
              <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
                <Admin />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="sync-monitor"
          element={
            <ProtectedRoute>
              <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
                <SyncMonitor />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="heatmap"
          element={
            <ProtectedRoute>
              <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
                <Heatmap />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="submit-activities"
          element={
            <ProtectedRoute>
              <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
                <SubmitActivities />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="submit-activities/review"
          element={
            <ProtectedRoute>
              <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
                <SubmitActivitiesReview />
              </Suspense>
            </ProtectedRoute>
          }
        />
        {/* Legacy route for backwards compatibility */}
        <Route
          path="dashboard"
          element={
            <ProtectedRoute>
              <Suspense fallback={<div className="loading"><div className="spinner"></div><p>Loading...</p></div>}>
                <Dashboard />
              </Suspense>
            </ProtectedRoute>
          }
        />
      </Route>
    </Routes>
  );
}

export default App;
