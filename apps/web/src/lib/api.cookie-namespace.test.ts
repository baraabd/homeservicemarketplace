import { afterEach, expect, it, vi } from 'vitest';
import MockAdapter from 'axios-mock-adapter';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  document.cookie = 'hsm_csrf=; Max-Age=0';
  document.cookie = 'hsm_staging_csrf=; Max-Age=0';
});

it('uses the built staging namespace for actual mutation headers', async () => {
  vi.resetModules();
  vi.stubEnv('VITE_AUTH_COOKIE_PREFIX', 'hsm_staging');
  const { api, getCsrfToken } = await import('./api');
  const mock = new MockAdapter(api);
  try {
    document.cookie = 'hsm_csrf=production-token';
    document.cookie = 'hsm_staging_csrf=staging-token';
    expect(getCsrfToken()).toBe('staging-token');
    mock.onPost('/v1/test').reply(200, {});
    await api.post('/v1/test', {});
    expect(mock.history.post[0]?.headers?.['X-CSRF-Token']).toBe('staging-token');
    document.cookie = 'hsm_staging_csrf=; Max-Age=0';
    expect(getCsrfToken()).toBeUndefined();
  } finally {
    mock.restore();
  }
});

it('rejects invalid public prefix before creating an API client', async () => {
  vi.resetModules();
  vi.stubEnv('VITE_AUTH_COOKIE_PREFIX', 'hsm\n');
  await expect(import('./api')).rejects.toThrow(/VITE_AUTH_COOKIE_PREFIX/);
});
