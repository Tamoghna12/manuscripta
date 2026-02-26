import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ErrorBoundary from '../components/ErrorBoundary';
import { AuthProvider, useAuth } from '../auth/AuthContext';

const LandingPage = lazy(() => import('./LandingPage'));
const ProjectPage = lazy(() => import('./ProjectPage'));
const EditorPage = lazy(() => import('./EditorPage'));
const CollabJoinPage = lazy(() => import('./CollabJoinPage'));
const LoginPage = lazy(() => import('./LoginPage'));

function LoadingFallback() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
        color: '#7a6f67',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 32,
            height: 32,
            border: '3px solid rgba(120, 98, 83, 0.15)',
            borderTopColor: '#b44a2f',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            margin: '0 auto 12px',
          }}
        />
        <div style={{ fontSize: 14 }}>Loading...</div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { loading, authEnabled, user } = useAuth();

  if (loading) return <LoadingFallback />;
  if (authEnabled && !user) {
    return (
      <Suspense fallback={<LoadingFallback />}>
        <LoginPage />
      </Suspense>
    );
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <AuthGate>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/projects" element={<ProjectPage />} />
        <Route
          path="/editor/:projectId"
          element={
            <ErrorBoundary>
              <EditorPage />
            </ErrorBoundary>
          }
        />
        <Route path="/collab" element={<CollabJoinPage />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </AuthGate>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Suspense fallback={<LoadingFallback />}>
          <AppRoutes />
        </Suspense>
      </AuthProvider>
    </ErrorBoundary>
  );
}
