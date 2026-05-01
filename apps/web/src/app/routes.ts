import { createBrowserRouter, redirect } from 'react-router';
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
  // ── Admin (full-width, no phone container, role-gated) ───────────────────
  {
    Component: RequireAdmin,
    children: [{ path: 'admin', Component: AdminPage }],
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
          { path: 'provider', Component: ProviderPage },
        ],
      },

      { path: '*', loader: () => redirect('/select') },
    ],
  },
]);
