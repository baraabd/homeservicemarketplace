import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';

// Resolve the API base URL at bundle-init time. Production bundles MUST have
// VITE_API_URL baked in (vite.config.ts enforces this at build time). Dev
// bundles fall back to localhost:4000 for developer ergonomics. Prod ships
// with the fallback unreachable — a missing production env surfaces as a
// build failure, never a silent "talks to localhost" runtime bug.
function resolveApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL?.trim();
  if (fromEnv) return fromEnv;
  if (import.meta.env.DEV) return 'http://localhost:4000';
  // Belt-and-braces: vite.config throws before we get here in production
  // builds. This runtime throw is defense-in-depth for any non-standard
  // environment where the build validator is bypassed.
  throw new Error('VITE_API_URL is required in production builds but was not set at build time.');
}

// ─── Axios instance ──────────────────────────────────────────────────────────
export const api = axios.create({
  baseURL: resolveApiBaseUrl(),
  withCredentials: true,
  headers: {
    'X-Client-Kind': 'web',
  },
});

// ─── CSRF: read hsm_csrf cookie → echo as X-CSRF-Token on mutations ─────────
// Exported so the realtime socket-client can mirror it into the
// handshake `auth.token` field. Cookie auth carries the session over
// `withCredentials: true`; the CSRF token is the only piece the
// gateway needs in the handshake to bind the connection to the
// authenticated session in the same way mutations bind it.
export function getCsrfToken(): string | undefined {
  const match = document.cookie.match(/(?:^|;\s*)hsm_csrf=([^;]*)/);
  return match?.[1];
}

api.interceptors.request.use((config) => {
  const method = (config.method ?? 'get').toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const csrf = getCsrfToken();
    if (csrf) {
      config.headers.set('X-CSRF-Token', csrf);
    }
  }
  return config;
});

// ─── 401 refresh interceptor ─────────────────────────────────────────────────
// Auth endpoints where a 401 is a legitimate final answer — retrying after
// refresh is logically wrong (login with wrong password should not trigger a
// refresh attempt).
const NO_RETRY_PATHS = new Set([
  '/v1/auth/login',
  '/v1/auth/register',
  '/v1/auth/refresh',
  '/v1/auth/logout',
  '/v1/auth/logout-all',
  '/v1/auth/forgot-password',
  '/v1/auth/reset-password',
  '/v1/auth/verify-email',
  '/v1/auth/resend-verification',
]);

let refreshPromise: Promise<void> | null = null;

interface RetryableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;
    const url = config?.url ?? '';

    if (error.response?.status !== 401 || !config || config._retry || NO_RETRY_PATHS.has(url)) {
      return Promise.reject(error);
    }

    // Skip refresh when the user has no CSRF cookie. Two stale-state cases
    // benefit from this:
    //   1. First page visit with no prior session — there's no point
    //      hitting /refresh; it would just respond 401 and add noise.
    //   2. A leftover hsm_rt cookie from a long-dead session paired with
    //      an expired hsm_csrf — /refresh would respond 400
    //      AUTH_CSRF_FAILED. We cannot satisfy that in the next call, so
    //      attempting it is wasted work.
    // In both cases the right outcome is the same: drop auth state and
    // route the user to /login. The session-expired event triggers that
    // chain in the auth provider.
    if (!getCsrfToken()) {
      window.dispatchEvent(new Event('auth:session-expired'));
      return Promise.reject(error);
    }

    // Coalesce concurrent 401s behind one refresh attempt
    if (!refreshPromise) {
      refreshPromise = api
        .post('/v1/auth/refresh')
        .then(() => undefined)
        .catch(() => {
          window.dispatchEvent(new Event('auth:session-expired'));
          return Promise.reject(error);
        })
        .finally(() => {
          refreshPromise = null;
        });
    }

    try {
      await refreshPromise;
    } catch {
      return Promise.reject(error);
    }

    config._retry = true;
    return api(config);
  },
);

// Exported for tests
export { getCsrfToken as _getCsrfToken, NO_RETRY_PATHS as _NO_RETRY_PATHS };
