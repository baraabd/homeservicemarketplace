import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@homeservicemarketplace/contracts';
import * as authApi from './auth-api';

// ─── Query client (singleton) ────────────────────────────────────────────────
const queryClient = new QueryClient({
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
  login: (data: authApi.LoginInput) => Promise<void>;
  register: (data: authApi.RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Inner provider (needs QueryClient in scope) ─────────────────────────────
function AuthProviderInner({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const { data: user, isLoading } = useQuery<MeResponse | null>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      try {
        return await authApi.getMe();
      } catch {
        return null;
      }
    },
  });

  // Listen for the session-expired event from the 401 interceptor.
  // Clear the ENTIRE query cache — not just auth/me — so no stale
  // user-scoped data survives into the next session.
  useEffect(() => {
    const handler = () => {
      qc.clear();
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
    // Wipe all cached queries, not just auth/me, so no stale
    // user-scoped data renders after switching sessions.
    qc.clear();
  }, [qc]);

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        isAuthenticated: !!user,
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
