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

// Preserve the full target path (pathname + search + hash) so deep-link
// query params and anchors survive the login round-trip.
function fullTarget(pathname: string, search: string, hash: string): string {
  return `${pathname}${search}${hash}`;
}

// ─── RequireAuth ─────────────────────────────────────────────────────────────
// Wraps routes that need authentication. Behavior:
//   - isLoading (no cached user yet) → spinner.
//   - isAuthenticated → render children. isDegraded may still be true; consumer
//     UI can surface a banner without forcing a logout round-trip.
//   - !isAuthenticated → redirect to /login preserving the intended URL.
export function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <AuthLoadingScreen />;
  if (!isAuthenticated) {
    const returnTo = fullTarget(location.pathname, location.search, location.hash);
    return <Navigate to="/login" state={{ returnTo }} replace />;
  }
  return <Outlet />;
}

// ─── GuestOnly ───────────────────────────────────────────────────────────────
// Wraps auth pages (login, signup). If already authenticated, redirect to home
// (or back to a pending returnTo if the router passed one forward).
export function GuestOnly() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <AuthLoadingScreen />;
  if (isAuthenticated) {
    const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
    return <Navigate to={returnTo && returnTo !== '/login' ? returnTo : '/home'} replace />;
  }
  return <Outlet />;
}
