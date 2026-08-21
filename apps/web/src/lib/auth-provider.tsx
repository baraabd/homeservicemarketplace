import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import type { MeResponse, OtpChallengeResponse } from '@homeservicemarketplace/contracts';
import * as authApi from './auth-api';
import { clearIntendedApp } from './intended-app';
import { useNotificationArrivalWatcher } from './realtime/notification-arrival-watcher';
import { useRealtimeSocket } from './realtime/use-realtime-socket';

// ─── Query client factory ────────────────────────────────────────────────────
//
// Sprint 7.x — auth-aware defaults:
//   - retry: false (queries + mutations). 401/403/404 must NEVER be
//     retried inside React Query — the axios interceptor (api.ts:67)
//     already coalesces concurrent 401s into ONE /v1/auth/refresh
//     attempt and either succeeds (the failed request is retried via
//     `config._retry = true`) or dispatches `auth:session-expired` so
//     the auth-provider purges protected queries. A React Query retry
//     on top of that would only flood the network log without changing
//     the outcome. 5xx / network errors are also not retried so the UI
//     shows the safe error copy promptly instead of spinning twice.
//   - refetchOnWindowFocus: OFF. Every protected hook (notifications,
//     bookings, available-requests, chat, earnings, audit-logs, …)
//     polls at fixed cadences (4 s — 30 s) so a focus-triggered refetch
//     storm adds no information and makes a 401 cascade noisier than it
//     needs to be when the access token has just expired.
//
// Why a factory (not a module-level singleton):
//   The earlier design exported a single QueryClient instance for the
//   whole module. Vitest workers reuse module imports across test
//   files, so a stale /me query left over from one routing test could
//   feed `auth-provider.tsx` a phantom 200 in the next file's
//   `beforeEach` — a classic singleton-trap CI flake. Making the
//   client per-component (via `useState` below) gives every Vitest
//   render its own cache by construction, eliminating the leak class
//   without per-test `queryClient.clear()` plumbing.
export function createAuthQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000, // 5 min
        retry: false,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

// ─── Auth context ────────────────────────────────────────────────────────────
interface AuthContextValue {
  user: MeResponse | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  // True when /me last resolved with a non-auth error (network, 5xx). The
  // cached user (if any) is still rendered; UI can surface a degraded banner.
  isDegraded: boolean;
  // Login and register no longer produce a session directly — they return
  // an OTP challenge envelope and the UI must route to the OTP entry step.
  // The session is only issued by verifyOtp() below.
  login: (data: authApi.LoginInput) => Promise<OtpChallengeResponse>;
  register: (data: authApi.RegisterInput) => Promise<OtpChallengeResponse>;
  verifyOtp: (challengeId: string, code: string) => Promise<void>;
  resendOtp: (challengeId: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// A transient /me failure (network / 5xx) MUST NOT flip the user to logged-out.
// We distinguish 401 (genuine "not authenticated" → null) from everything else
// (rethrow → TanStack Query marks as error, retries with backoff, preserves
// last-known user in `data`).
function isUnauthorized(err: unknown): boolean {
  const status = (err as AxiosError | undefined)?.response?.status;
  return status === 401;
}

// Drop every cached query that is NOT under the `auth` namespace. Used on
// session-expired and logout: the user's other data must not survive, but
// the auth observer has to stay subscribed so the UI can re-render as logged
// out. Safe to call with any QueryClient.
function purgeNonAuthQueries(qc: QueryClient): void {
  qc.getQueryCache()
    .getAll()
    .filter((q) => q.queryKey[0] !== 'auth')
    .forEach((q) => qc.removeQueries({ queryKey: q.queryKey as readonly unknown[] }));
}

// ─── Inner provider (needs QueryClient in scope) ─────────────────────────────
function AuthProviderInner({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const {
    data: user,
    isLoading,
    isError,
  } = useQuery<MeResponse | null>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      try {
        return await authApi.getMe();
      } catch (err) {
        if (isUnauthorized(err)) return null;
        throw err;
      }
    },
    // Retry non-401 failures a couple of times with backoff; 401 is final.
    retry: (failureCount, err) => !isUnauthorized(err) && failureCount < 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });

  // Listen for the session-expired event from the 401 interceptor.
  // Flip the auth observer to null so the UI immediately reflects "logged
  // out", then drop every OTHER user-scoped query so no stale data survives
  // into the next session. (qc.clear() would destroy the auth observer
  // itself — along with its React subscription — so we can't use it here.)
  useEffect(() => {
    const handler = () => {
      qc.setQueryData(['auth', 'me'], null);
      purgeNonAuthQueries(qc);
    };
    window.addEventListener('auth:session-expired', handler);
    return () => window.removeEventListener('auth:session-expired', handler);
  }, [qc]);

  // Sprint 7.0 — connect the realtime Socket.IO bridge whenever a user
  // is authenticated. Mounted at the auth-provider scope so a SINGLE
  // socket serves both Seeker and Provider experiences (the dispatcher
  // invalidates both query roots on every event — see
  // dispatchInvalidations). The CSRF cookie is mirrored into the
  // handshake `auth.token` field so the gateway can bind the connection
  // to the same session that issued the cookie. When the user is not
  // authenticated, the hook closes any open socket and returns early —
  // a logout therefore tears the connection down without any extra
  // wiring here.
  useRealtimeSocket({
    enabled: !!user,
    // Sprint 7.x — the web access JWT lives in the httpOnly `hsm_at`
    // cookie that JS cannot read. The Socket.IO handshake re-uses
    // the underlying HTTP CONNECT with `withCredentials: true`, so
    // the cookie is sent to the gateway automatically and parsed
    // server-side via the ACCESS_COOKIE helper. We DO NOT send the
    // CSRF token here — CSRF is a REST-mutation defence, not a
    // bearer credential, and the gateway would (correctly) reject
    // it as a malformed JWT.
    //
    // `null` here means "no in-memory bearer token" — the client
    // falls back to the cookie. Mobile / native clients that hold a
    // real access JWT in memory can swap this to `() => myJwt` to
    // use the auth.token transport instead.
    getToken: () => null,
    // Sprint 7.6 — anti-echo: surface the authenticated user's id so
    // the side-effects bridge can suppress UX feedback for events
    // the user themselves triggered. Cache invalidation still runs
    // regardless (so cross-tab convergence works), and `null` is the
    // safe default — when no user is loaded the bridge treats every
    // recipient as a non-actor.
    currentUserId: user?.id ?? null,
  });

  // Sprint 7.x — polling-parity notification arrival watcher.
  // Sprint 7.12 — TWO mounts, one per experience. Mounted here
  // (above the Router) so each watcher survives page navigation
  // and user-switch cleanup.
  //
  //   - seeker watcher: observes the seeker notifications list cache.
  //   - provider watcher: observes the provider notifications list cache.
  //
  // Each fires the matching brand variant toast (orange/amber for
  // seeker, light-blue for provider). The active experience is
  // determined by the active route, bridged into realtime-experience
  // by RootInner; the watcher's own batch processor also pushes its
  // own experience before emitting so a toast that fires AT login
  // time (before RootInner's effect has run) still picks the right
  // brand. Shared dedupe collapses socket+polling duplicates into
  // one UX event.
  useNotificationArrivalWatcher({
    enabled: !!user,
    currentUserId: user?.id ?? null,
    experience: 'seeker',
  });
  useNotificationArrivalWatcher({
    enabled: !!user,
    currentUserId: user?.id ?? null,
    experience: 'provider',
  });

  const login = useCallback(async (data: authApi.LoginInput): Promise<OtpChallengeResponse> => {
    // NB: cookies are NOT set yet — the backend responds with an OTP
    // challenge and the caller is expected to navigate to the OTP step.
    return authApi.login(data);
  }, []);

  const register = useCallback(
    async (data: authApi.RegisterInput): Promise<OtpChallengeResponse> => {
      return authApi.register(data);
    },
    [],
  );

  const verifyOtp = useCallback(
    async (challengeId: string, code: string) => {
      await authApi.verifyOtp(challengeId, code);
      // Session cookies are now set; re-fetch /me to populate the context.
      //
      // refetchQueries (vs invalidateQueries) DEFINITIVELY waits for the
      // fetch to land in cache before resolving — invalidateQueries only
      // marks the query stale and starts a refetch in the background.
      // The SignUpPage / LoginPage `onOtpVerify` callbacks read the user
      // immediately after this returns to compute the post-auth
      // destination; without the cache being settled, RequireAuth on
      // the destination route can briefly see `user === null` and
      // bounce to /login before the refetch lands. That bounce loses
      // the intent fallback's strongest signal and lands the user on
      // the wrong app — the residual routing-test flake we saw.
      await qc.refetchQueries({ queryKey: ['auth', 'me'] });
    },
    [qc],
  );

  const resendOtp = useCallback(async (challengeId: string) => {
    await authApi.resendOtp(challengeId);
  }, []);

  const doLogout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Server may be down or session already expired — clear anyway
    }
    // Sprint 7.x — centralise the intended-app cleanup here so EVERY
    // logout site (provider shell, settings page, admin shell) drops
    // the per-tab intent in one place. Previously this lived inside
    // ProviderApp.tsx + LoginPage/SignUpPage's onOtpVerify; the
    // in-onOtpVerify clear caused a render race where GuestOnly
    // re-rendered post-refetch with intent already cleared, fell
    // through to role-inference, and sent customer-only users to
    // /home instead of /provider. Moving the clear to logout is the
    // canonical "consumption" point for the intent.
    clearIntendedApp();
    // Same approach as session-expired: flip auth/me to null for the observer,
    // then drop all other user-scoped queries. Do NOT use qc.clear() — it
    // destroys the auth observer and strands the UI in its last-rendered state.
    qc.setQueryData(['auth', 'me'], null);
    purgeNonAuthQueries(qc);
  }, [qc]);

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        isAuthenticated: !!user,
        isDegraded: isError && !!user,
        login,
        register,
        verifyOtp,
        resendOtp,
        logout: doLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Outer provider wraps with QueryClientProvider ───────────────────────────
//
// `client` is an escape hatch for tests — pass a freshly-constructed
// QueryClient per render and the auth provider is fully isolated. In
// production the optional prop is omitted and `useState` constructs
// exactly one QueryClient for the lifetime of the AuthProvider mount,
// matching the singleton's previous behaviour without exporting one.
export function AuthProvider({ children, client }: { children: ReactNode; client?: QueryClient }) {
  // useState's lazy initialiser runs ONCE per mount even if React
  // re-renders the provider — the function is `() => createAuthQueryClient()`
  // not `createAuthQueryClient()`, so we don't reconstruct a cache on
  // every prop update.
  const [internal] = useState(() => createAuthQueryClient());
  const qc = client ?? internal;
  return (
    <QueryClientProvider client={qc}>
      <AuthProviderInner>{children}</AuthProviderInner>
    </QueryClientProvider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
