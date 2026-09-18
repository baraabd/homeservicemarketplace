import { createBrowserRouter, redirect } from 'react-router';
import { DisputesPage } from './pages/DisputesPage';
import { Root } from './Root';
import {
  LoginPage,
  SignUpPage,
  ForgotPasswordPage,
  CheckEmailPage,
  VerifyEmailPage,
  ResetPasswordPage,
} from './pages/AuthPages';
import { HomePage } from './pages/HomePage';
import { AppSelector } from './pages/AppSelector';
import { ProviderPage } from './pages/ProviderPage';
import { AdminPage } from './pages/AdminPage';
import {
  ProviderOnboardingHubPage,
  ProviderOnboardingTaskPage,
  ProviderOnboardingLayout,
  ProviderVerificationPage,
} from './pages/ProviderOnboardingPage';
import { RequireAuth, RequireAdmin, GuestOnly } from '../lib/route-guards';

// ─── Router ───────────────────────────────────────────────────────────────────
//
// Sprint 5.1.1 patch 2: /admin used to mount as a top-level public route,
// which made the admin dashboard accessible to anyone who knew the path.
// It now sits under RequireAdmin (which itself wraps RequireAuth + role
// check) and lives at the top level so it can opt out of the phone-shell
// container the Root layout enforces. Unauthenticated visitors get
// /login themed Admin + returnTo=/admin; authenticated non-admins see
// the AdminAccessRequired surface; admins see the dashboard.
export const router = createBrowserRouter([
  // A participant may need help with a past booking even when work access is restricted.
  // Authentication is required here; current booking ownership is enforced by the API.
  { Component: RequireAuth, children: [{ path: 'disputes/*', Component: DisputesPage }] },
  // ── Admin (full-width, no phone container, role-gated) ───────────────────
  {
    Component: RequireAdmin,
    children: [{ path: 'admin/*', Component: AdminPage }],
  },

  {
    path: '/',
    Component: Root,
    children: [
      { index: true, loader: () => redirect('/select') },

      // ── Public ──────────────────────────────────────────────────────
      { path: 'select', Component: AppSelector },
      // Email-link landing pages — must be reachable whether the user is
      // logged in or not (e.g. opening the link on a different device).
      { path: 'verify-email', Component: VerifyEmailPage },
      { path: 'reset-password', Component: ResetPasswordPage },

      // ── Guest-only (redirect to /home if already authed) ────────────
      {
        Component: GuestOnly,
        children: [
          { path: 'login', Component: LoginPage },
          { path: 'signup', Component: SignUpPage },
          { path: 'forgot-password', Component: ForgotPasswordPage },
          { path: 'check-email', Component: CheckEmailPage },
        ],
      },

      // ── Authenticated ───────────────────────────────────────────────
      {
        Component: RequireAuth,
        children: [
          { path: 'home', Component: HomePage },
          { path: 'home/bookings', Component: HomePage },
          { path: 'home/messages', Component: HomePage },
          { path: 'home/profile', Component: HomePage },
          // Applicants must be able to provide identity evidence before the
          // workspace becomes active. The API owns eligibility and actions.
          { path: 'provider/verification', Component: ProviderVerificationPage },
          // Sprint 9B.16 — the V2 onboarding surface. Full-screen, so it is a
          // ROUTE rather than a tab inside ProviderApp: the task the provider
          // is on has to survive a reload and a login round-trip, and tab
          // state in a component survives neither. Both paths bounce to
          // /provider while the flag is off.
          //
          // Declared BEFORE the workspace splat below. Static segments outrank
          // a splat in React Router's ranking either way, so this is for the
          // reader rather than the matcher — but it also keeps onboarding
          // OUTSIDE the workspace status gate, which matters: that gate sends
          // a non-ACTIVE provider to /provider/status, and onboarding is the
          // one place such a provider must still be able to reach.
          //
          // Sprint 9B.28 — both paths now sit under a LAYOUT route whose only
          // job is to mount the autosave coordinator above them. Moving
          // between the hub and a task, or between two tasks, must not unmount
          // the write queue: the previous design put one autosave instance
          // inside each task component, so leaving a task destroyed the timer
          // holding the edit that leaving was supposed to save.
          {
            path: 'provider/onboarding',
            Component: ProviderOnboardingLayout,
            children: [
              { index: true, Component: ProviderOnboardingHubPage },
              { path: ':taskId', Component: ProviderOnboardingTaskPage },
            ],
          },

          // Mode B — the workspace owns its own routes (jobs / bids /
          // messages / wallet / profile / status) beneath this splat, for the
          // same reason onboarding got routes above: a screen held in
          // component state survives neither a reload nor a login round-trip,
          // and cannot be linked to at all. Kept as a splat rather than
          // spelled out here so the workspace stays one mountable unit.
          { path: 'provider/*', Component: ProviderPage },
        ],
      },

      { path: '*', loader: () => redirect('/select') },
    ],
  },
]);
