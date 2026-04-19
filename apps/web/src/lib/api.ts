import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';

// ─── Axios instance ──────────────────────────────────────────────────────────
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  withCredentials: true,
  headers: {
    'X-Client-Kind': 'web',
  },
});

// ─── CSRF: read hsm_csrf cookie → echo as X-CSRF-Token on mutations ─────────
function getCsrfToken(): string | undefined {
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
