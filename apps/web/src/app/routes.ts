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
import { RequireAuth, GuestOnly } from '../lib/route-guards';

// ─── Router ───────────────────────────────────────────────────────────────────
export const router = createBrowserRouter([
  // ── Admin (full-width, no phone container) ───────────────────────────────
  { path: 'admin', Component: AdminPage },

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
