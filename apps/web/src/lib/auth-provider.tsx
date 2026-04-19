import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import type { MeResponse } from '@homeservicemarketplace/contracts';
import * as authApi from './auth-api';

// ─── Query client (singleton) ────────────────────────────────────────────────
// Exported only so test suites can reset it between cases. Production code
// should keep going through `useQueryClient()` inside the provider tree.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min
      retry: false,
      refetchOnWindowFocus: true,
    },
  },
});

// ─── Auth context ────────────────────────────────────────────────────────────
interface AuthContextValue {
  user: MeResponse | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  // True when /me last resolved with a non-auth error (network, 5xx). The
  // cached user (if any) is still rendered; UI can surface a degraded banner.
  isDegraded: boolean;
  login: (data: authApi.LoginInput) => Promise<void>;
  register: (data: authApi.RegisterInput) => Promise<void>;
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

  const login = useCallback(
    async (data: authApi.LoginInput) => {
      await authApi.login(data);
      // Cookies are now set; re-fetch /me to populate the context
      await qc.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
    [qc],
  );

  const register = useCallback(async (data: authApi.RegisterInput) => {
    await authApi.register(data);
  }, []);

  const doLogout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Server may be down or session already expired — clear anyway
    }
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
        logout: doLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ─── Outer provider wraps with QueryClientProvider ───────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
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
