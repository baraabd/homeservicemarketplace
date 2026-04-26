// ─────────────────────────────────────────────────────────────────────────────
// Intended-app intent layer.
//
// The marketplace exposes three apps under a single web origin:
//   admin    → /admin
//   provider → /provider
//   seeker   → /home
//
// When the user clicks an experience card on /select, that selection MUST
// survive every subsequent auth detour (login, signup, OTP, forgot/reset
// password, email verification). Threading react-router `state.returnTo`
// through every <Link>/<navigate> is fragile — any auth page that calls
// `navigate('/login')` without forwarding state silently drops the intent
// and the user lands on the default app (Seeker /home), which is exactly
// the bug this module fixes.
//
// Intent is stored in sessionStorage so it:
//   - survives page reloads inside the same tab
//   - is scoped per tab (won't leak across windows)
//   - is dropped when the tab closes
//   - degrades gracefully (private mode / SSR / disabled storage)
// ─────────────────────────────────────────────────────────────────────────────

export type IntendedApp = 'seeker' | 'provider' | 'admin';

export const INTENDED_APP_PATHS: Readonly<Record<IntendedApp, string>> = Object.freeze({
  seeker: '/home',
  provider: '/provider',
  admin: '/admin',
});

const STORAGE_KEY = 'fixnow_intended_app';

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isIntendedApp(v: unknown): v is IntendedApp {
  return v === 'seeker' || v === 'provider' || v === 'admin';
}

export function setIntendedApp(app: IntendedApp): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, app);
  } catch {
    /* quota / disabled — degrade silently */
  }
}

export function getIntendedApp(): IntendedApp | null {
  const s = safeStorage();
  if (!s) return null;
  try {
    const v = s.getItem(STORAGE_KEY);
    return isIntendedApp(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearIntendedApp(): void {
  const s = safeStorage();
  if (!s) return;
  try {
    s.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// The path the user should land on after a successful auth flow when no
// explicit returnTo was provided. Falls back to /home (Seeker) when no
// intent has been recorded — the historical default.
export function getIntendedAppPath(fallback: string = INTENDED_APP_PATHS.seeker): string {
  const app = getIntendedApp();
  return app ? INTENDED_APP_PATHS[app] : fallback;
}
