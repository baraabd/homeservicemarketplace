// ─────────────────────────────────────────────────────────────────────────────
// Experience-aware auth theming + post-auth routing.
//
// The marketplace exposes three apps under a single web origin (Seeker /
// Provider / Admin) but a single `/login` URL. Before this module, the
// login screen was visually Seeker-only and the post-auth redirect was
// "use the saved intent or fall back to /home", which produced a wrong
// mental model when a user clicked the Provider card on /select and
// then saw orange Seeker branding on the login screen.
//
// This module is the single source of truth for two questions every
// auth surface has to answer:
//
//   1. "Which app's theme should I render?" — `resolveAuthExperience()`
//   2. "Where should I land the user after a successful auth flow?" —
//      `resolvePostAuthDestination()`
//
// Theming applies the SELECTED app's visual identity. It is purely a
// UX hint; it never changes which auth backend is called.
//
// Routing applies a clear precedence:
//
//   A. explicit returnTo (sanitised) — wins over everything; preserves
//      the deep-link the user was bounced off of.
//   B. recorded launcher intent (sessionStorage) — wins over role
//      guessing because the user told us which app they want.
//   C. role inference — only when no signal exists. Multi-role users
//      land on /select rather than letting the platform pick wrong.
//
// Roles are AUTHORIZATION; the destination is UX. Provider routes still
// require the `provider` role at the API layer; Admin routes still
// require `admin`. This module does not weaken any guard.
// ─────────────────────────────────────────────────────────────────────────────

import { type IntendedApp, INTENDED_APP_PATHS, getIntendedApp } from './intended-app';

export type AuthExperienceId = IntendedApp;

// One experience = the per-app theme + post-auth path. Tailwind class
// strings are stored here (not inline styles) so the existing visual
// language — gradients, hover, ring, chip bg — keeps the same tokens
// the app shells use.
export interface AuthExperience {
  id: AuthExperienceId;
  // The path the user lands on after a successful auth flow when no
  // explicit returnTo was provided.
  path: string;
  // Hero gradient for the LoginScreen + SignUpScreen heroes. The
  // existing layout uses `bg-gradient-to-br from-X via-Y to-Z`; we
  // stop at the `from-…/via-…/to-…` triplet so the consumer composes
  // the rest of the class string.
  gradient: string;
  // Inline shadow tint paired with the hero icon container. Mirrors
  // the existing `shadow-xl shadow-orange-900/20` style — kept as a
  // class string so per-experience tints replace it cleanly.
  heroShadow: string;
  // Accent hex used in the SignUpScreen step indicator label colour
  // (rendered as inline `style.color`).
  accentHex: string;
  // Class strings applied to chip / link / focus surfaces that used
  // amber-* directly. Each entry maps to the same visual role across
  // experiences.
  classes: {
    // Solid accent fill — used for primary toggles, step-indicator
    // filled circles, agreement-check fills. Pairs with `text-white`.
    accentBg: string;
    // Border-equivalent of accentBg (e.g. `border-amber-500`) — kept
    // as a separate field so the OTP active state can render the
    // border without string-manipulating the bg utility.
    accentBorder: string;
    // The inverse — soft tint background, used for icon haloes
    // (`bg-amber-100`) and accent banners (`bg-amber-50`).
    softBg: string;
    softBorder: string;
    // Strong text colour for inline links (the "Sign up" / "Forgot" /
    // "Resend" anchors).
    accentText: string;
    // Step-indicator ring colour for the active step.
    activeRing: string;
    // Step-indicator connector for completed steps.
    activeConnector: string;
    // Chip / icon backgrounds inside the SignUp wizard.
    iconChipBg: string;
    iconChipText: string;
  };
  // Brand strings rendered in the auth hero. We do NOT change the
  // backend — this is purely the "which app are you logging into"
  // headline.
  brand: {
    title: string;
    subtitle: string;
  };
}

// Visual mapping. Keep these in lockstep with the AppSelector card
// gradients so a user clicking Provider on /select and bouncing
// through /login sees the same blue-indigo-purple identity end to end.
export const AUTH_EXPERIENCES: Readonly<Record<AuthExperienceId, AuthExperience>> = Object.freeze({
  seeker: {
    id: 'seeker',
    path: INTENDED_APP_PATHS.seeker,
    gradient: 'from-amber-500 via-amber-500 to-orange-600',
    heroShadow: 'shadow-orange-900/20',
    accentHex: '#F59E0B',
    classes: {
      accentBg: 'bg-amber-500',
      accentBorder: 'border-amber-500',
      softBg: 'bg-amber-50',
      softBorder: 'border-amber-100',
      accentText: 'text-amber-600',
      activeRing: 'ring-amber-200',
      activeConnector: 'bg-amber-300',
      iconChipBg: 'bg-amber-100',
      iconChipText: 'text-amber-600',
    },
    brand: { title: 'FixNow', subtitle: 'Home Services Marketplace' },
  },
  provider: {
    id: 'provider',
    path: INTENDED_APP_PATHS.provider,
    gradient: 'from-blue-600 via-indigo-600 to-purple-700',
    heroShadow: 'shadow-indigo-900/30',
    accentHex: '#4F46E5',
    classes: {
      accentBg: 'bg-blue-600',
      accentBorder: 'border-blue-600',
      softBg: 'bg-blue-50',
      softBorder: 'border-blue-100',
      accentText: 'text-blue-600',
      activeRing: 'ring-blue-200',
      activeConnector: 'bg-blue-300',
      iconChipBg: 'bg-blue-100',
      iconChipText: 'text-blue-600',
    },
    brand: { title: 'FixNow Pro', subtitle: 'Professional Earnings Platform' },
  },
  admin: {
    id: 'admin',
    path: INTENDED_APP_PATHS.admin,
    gradient: 'from-slate-700 via-slate-800 to-slate-900',
    heroShadow: 'shadow-slate-900/40',
    accentHex: '#475569',
    classes: {
      accentBg: 'bg-slate-700',
      accentBorder: 'border-slate-700',
      softBg: 'bg-slate-100',
      softBorder: 'border-slate-200',
      accentText: 'text-slate-700',
      activeRing: 'ring-slate-300',
      activeConnector: 'bg-slate-400',
      iconChipBg: 'bg-slate-100',
      iconChipText: 'text-slate-700',
    },
    brand: { title: 'FixNow Admin', subtitle: 'Platform Control' },
  },
});

// The historical Seeker default. Returned when no signal exists.
export const DEFAULT_EXPERIENCE_ID: AuthExperienceId = 'seeker';

// ─── Resolver: which experience should I theme this auth surface as? ─────────

export interface ResolveExperienceInput {
  // Explicit override — usually `location.state.app` when an internal
  // navigation is sure of the experience. Strongest signal.
  explicit?: AuthExperienceId | null | undefined;
  // The returnTo path the user came from (post-login destination).
  // Mapped to an experience by prefix match: /home → seeker, /provider
  // → provider, /admin → admin.
  returnTo?: string | null | undefined;
  // The launcher intent recorded when the user clicked an app card on
  // /select. Falls back to `getIntendedApp()` from sessionStorage when
  // not provided.
  intentApp?: AuthExperienceId | null | undefined;
}

function isAuthExperienceId(value: unknown): value is AuthExperienceId {
  return value === 'seeker' || value === 'provider' || value === 'admin';
}

export function getExperienceForReturnTo(
  returnTo: string | null | undefined,
): AuthExperienceId | null {
  if (!returnTo || typeof returnTo !== 'string') return null;
  // Only honour in-app paths — open-redirect rejection happens in
  // sanitizeReturnTo upstream, but the prefix check here is defensive.
  if (!returnTo.startsWith('/') || returnTo.startsWith('//')) return null;
  if (returnTo === '/' || returnTo === '/home' || returnTo.startsWith('/home/')) return 'seeker';
  if (returnTo === '/provider' || returnTo.startsWith('/provider/')) return 'provider';
  if (returnTo === '/admin' || returnTo.startsWith('/admin/')) return 'admin';
  return null;
}

export function getExperienceForIntendedApp(): AuthExperienceId | null {
  const app = getIntendedApp();
  return isAuthExperienceId(app) ? app : null;
}

// Single entry point auth pages call. Precedence: explicit > returnTo
// > intentApp > sessionStorage intent > seeker default.
export function resolveAuthExperience(input: ResolveExperienceInput = {}): AuthExperience {
  if (isAuthExperienceId(input.explicit)) {
    return AUTH_EXPERIENCES[input.explicit];
  }
  const fromReturnTo = getExperienceForReturnTo(input.returnTo ?? null);
  if (fromReturnTo) return AUTH_EXPERIENCES[fromReturnTo];
  if (isAuthExperienceId(input.intentApp)) return AUTH_EXPERIENCES[input.intentApp];
  const fromStorage = getExperienceForIntendedApp();
  if (fromStorage) return AUTH_EXPERIENCES[fromStorage];
  return AUTH_EXPERIENCES[DEFAULT_EXPERIENCE_ID];
}

// ─── Resolver: where should I send the user after auth? ──────────────────────

export interface ResolveDestinationInput {
  // returnTo (sanitised). The strongest signal — the user was bounced
  // off a specific URL and wants to go back to it.
  returnTo?: string | null | undefined;
  // Recorded launcher intent (sessionStorage). Falls back to
  // `getIntendedApp()` when not provided.
  intentApp?: AuthExperienceId | null | undefined;
  // The experience the auth surface is currently THEMED as. Sprint
  // 5.1.1 patch 2: this is a third-strongest signal sitting between
  // intent and role inference. The Login/Signup pages resolve their
  // experience at render time (from explicit state.app, returnTo,
  // intent, or default); when the user finishes auth, the destination
  // should respect the experience the user just saw — even if the
  // intent has been cleared mid-flight (which used to drop Provider
  // signup users on /home).
  experienceId?: AuthExperienceId | null | undefined;
  // The roles attached to the authenticated session. Used only when
  // returnTo, intent, and experienceId are all missing.
  userRoles?: readonly string[] | null | undefined;
}

const PROVIDER_ROLE = 'provider';
const ADMIN_ROLE = 'admin';

// The SELECT path is reused from the existing AppSelector route and
// kept here so consumers don't have to know it.
export const SELECT_PATH = '/select';

// Multi-role precedence (Sprint 5.1.1 patch 2):
//
//   1. returnTo — wins. The user was deep-linking somewhere specific.
//   2. intentApp — wins. The user clicked an app card on /select.
//   3. experienceId — the theme the auth surface was rendered as.
//      Sits between intent and role inference because the user just
//      VISUALLY confirmed which app they were authing into; landing
//      anywhere else after that would be jarring even if the
//      sessionStorage intent has since been cleared.
//   4. role inference — only when none of the above signals exist:
//      a. exactly one of {provider, admin} → that app
//      b. both provider AND admin → /select (let the user pick)
//      c. neither (e.g. just `customer`) → /home
//
// Roles are advisory at this layer; backend RolesGuards remain the
// authoritative authorization. A user who selects Provider and lacks
// the role still lands on /provider — the Provider app's onboarding
// screen handles the upgrade flow, per Slice 5.1. An admin-themed auth
// flow lands the user on /admin where RequireAdmin (route guard) does
// the actual access check.
export function resolvePostAuthDestination(input: ResolveDestinationInput): string {
  if (typeof input.returnTo === 'string' && input.returnTo.length > 0) {
    return input.returnTo;
  }
  const intent = isAuthExperienceId(input.intentApp)
    ? input.intentApp
    : getExperienceForIntendedApp();
  if (intent) return AUTH_EXPERIENCES[intent].path;

  if (isAuthExperienceId(input.experienceId)) {
    return AUTH_EXPERIENCES[input.experienceId].path;
  }

  const roles = input.userRoles ?? [];
  const hasProvider = roles.includes(PROVIDER_ROLE);
  const hasAdmin = roles.includes(ADMIN_ROLE);
  if (hasProvider && hasAdmin) return SELECT_PATH;
  if (hasProvider) return AUTH_EXPERIENCES.provider.path;
  if (hasAdmin) return AUTH_EXPERIENCES.admin.path;
  return AUTH_EXPERIENCES.seeker.path;
}
