import { Navigate, Outlet, useLocation, useOutletContext } from 'react-router';
import { useAuth } from './auth-provider';
import { getIntendedApp } from './intended-app';
import { resolvePostAuthDestination } from './auth-experience';

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

// react-router's outlet context is scoped to the nearest <Outlet>, so a bare
// <Outlet /> inside an intermediate layout route (like these guards) silently
// drops the parent's context. Grandchildren calling useOutletContext() then
// receive undefined — which is how HomePage used to crash with "Cannot
// destructure property 'isOffline' of 'useRootContext(...)' as it is
// undefined". Forward whatever the parent passed us so guards behave as
// transparent wrappers, not context sinks. Typed as unknown because guards
// are generic and must not couple to any particular parent's context shape.
function ForwardingOutlet() {
  const parentCtx = useOutletContext<unknown>();
  return <Outlet context={parentCtx} />;
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
  return <ForwardingOutlet />;
}

// ─── GuestOnly ───────────────────────────────────────────────────────────────
// Wraps auth pages (login, signup). If already authenticated, redirect to the
// strongest available destination signal:
//   returnTo (router state) > intent (sessionStorage) > role inference > /home.
// This is the same precedence the LoginPage/SignUpPage post-OTP flow applies,
// so a refresh on /login while already-authed lands the user in the same
// place clicking Confirm would have.
export function GuestOnly() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const location = useLocation();

  if (isLoading) return <AuthLoadingScreen />;
  if (isAuthenticated) {
    const returnToRaw = (location.state as { returnTo?: string } | null)?.returnTo;
    const returnTo = returnToRaw && returnToRaw !== '/login' ? returnToRaw : null;
    const dest = resolvePostAuthDestination({
      returnTo,
      intentApp: getIntendedApp(),
      userRoles: user?.roles ?? null,
    });
    return <Navigate to={dest} replace />;
  }
  return <ForwardingOutlet />;
}
