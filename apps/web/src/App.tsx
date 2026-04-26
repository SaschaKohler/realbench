import { Routes, Route, Navigate } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import Dashboard from './pages/Dashboard';
import ProjectDetail from './pages/ProjectDetail';
import RunDetail from './pages/RunDetail';
import Settings from './pages/Settings';
import LandingPage from './pages/LandingPage';

function App() {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <Routes>
        {/* Public landing page */}
        <Route path="/" element={<LandingPage />} />

        {/* Protected app routes */}
        <Route
          path="/dashboard"
          element={
            <>
              <SignedIn><Dashboard /></SignedIn>
              <SignedOut><RedirectToSignIn /></SignedOut>
            </>
          }
        />
        <Route
          path="/projects/:id"
          element={
            <>
              <SignedIn><ProjectDetail /></SignedIn>
              <SignedOut><RedirectToSignIn /></SignedOut>
            </>
          }
        />
        <Route
          path="/runs/:id"
          element={
            <>
              <SignedIn><RunDetail /></SignedIn>
              <SignedOut><RedirectToSignIn /></SignedOut>
            </>
          }
        />
        <Route
          path="/settings"
          element={
            <>
              <SignedIn><Settings /></SignedIn>
              <SignedOut><RedirectToSignIn /></SignedOut>
            </>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;
