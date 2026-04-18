import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from './auth-provider';

// ─── Loading spinner ─────────────────────────────────────────────────────────
function AuthLoadingScreen() {
  return (
    <div className="flex items-center justify-center" style={{ minHeight: '100svh' }}>
      <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ─── RequireAuth ─────────────────────────────────────────────────────────────
// Wraps routes that need authentication. While /me is loading, shows a spinner.
// When not authenticated, redirects to /login preserving the intended URL.
export function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <AuthLoadingScreen />;
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ returnTo: location.pathname }} replace />;
  }
  return <Outlet />;
}

// ─── GuestOnly ───────────────────────────────────────────────────────────────
// Wraps auth pages (login, signup). If already authenticated, redirect to home.
export function GuestOnly() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <AuthLoadingScreen />;
  if (isAuthenticated) return <Navigate to="/home" replace />;
  return <Outlet />;
}
