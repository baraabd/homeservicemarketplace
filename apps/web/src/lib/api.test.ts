import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api, _NO_RETRY_PATHS } from './api';

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(api);
});

afterEach(() => {
  mock.restore();
});

describe('CSRF request interceptor', () => {
  it('sends X-CSRF-Token from hsm_csrf cookie on POST requests', async () => {
    document.cookie = 'hsm_csrf=test-csrf-value';
    mock.onPost('/v1/test').reply(200, {});
    await api.post('/v1/test', {});
    const req = mock.history.post[0]!;
    expect(req.headers!['X-CSRF-Token']).toBe('test-csrf-value');
  });

  it('does NOT send X-CSRF-Token on GET requests', async () => {
    document.cookie = 'hsm_csrf=test-csrf-value';
    mock.onGet('/v1/test').reply(200, {});
    await api.get('/v1/test');
    const req = mock.history.get[0]!;
    expect(req.headers!['X-CSRF-Token']).toBeUndefined();
  });
});

describe('401 refresh interceptor', () => {
  it('retries the original request exactly once after a successful refresh', async () => {
    let callCount = 0;
    mock.onGet('/v1/data').reply(() => {
      callCount++;
      if (callCount === 1) return [401, {}];
      return [200, { ok: true }];
    });
    mock.onPost('/v1/auth/refresh').reply(200, {});

    const res = await api.get('/v1/data');
    expect(res.data).toEqual({ ok: true });
    expect(callCount).toBe(2);
    expect(mock.history.post.filter((r) => r.url === '/v1/auth/refresh')).toHaveLength(1);
  });

  it('does NOT attempt refresh for any auth endpoint in the exclusion list', async () => {
    for (const path of _NO_RETRY_PATHS) {
      mock.reset();
      mock.onAny(path).reply(401, { error: { code: 'AUTH_INVALID_CREDENTIALS' } });
      mock.onPost('/v1/auth/refresh').reply(200, {});

      await api.post(path).catch(() => {});
    }
    // The refresh endpoint must NOT have been called for any excluded path
    const refreshCalls = mock.history.post.filter((r) => r.url === '/v1/auth/refresh');
    expect(refreshCalls).toHaveLength(0);
  });

  it('fires auth:session-expired event when refresh itself fails', async () => {
    const handler = vi.fn();
    window.addEventListener('auth:session-expired', handler);

    mock.onGet('/v1/data').reply(401);
    mock.onPost('/v1/auth/refresh').reply(401);

    await api.get('/v1/data').catch(() => {});

    // The event is dispatched asynchronously by the interceptor
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).toHaveBeenCalled();
    window.removeEventListener('auth:session-expired', handler);
  });

  it('coalesces concurrent 401s behind a single refresh call', async () => {
    let refreshCount = 0;
    let aCallCount = 0;
    let bCallCount = 0;

    mock.onGet('/v1/a').reply(() => {
      aCallCount++;
      if (aCallCount === 1) return [401, {}];
      return [200, { a: true }];
    });
    mock.onGet('/v1/b').reply(() => {
      bCallCount++;
      if (bCallCount === 1) return [401, {}];
      return [200, { b: true }];
    });
    mock.onPost('/v1/auth/refresh').reply(() => {
      refreshCount++;
      return [200, {}];
    });

    const [ra, rb] = await Promise.all([api.get('/v1/a'), api.get('/v1/b')]);
    expect(ra.data).toEqual({ a: true });
    expect(rb.data).toEqual({ b: true });
    expect(refreshCount).toBe(1);
  });

  it('does NOT retry the same request twice (no infinite loop)', async () => {
    mock.onGet('/v1/data').reply(401);
    mock.onPost('/v1/auth/refresh').reply(200, {});

    await api.get('/v1/data').catch(() => {});
    // 1st call → 401 → refresh → retry → 401 again → stops (no more retries)
    const dataCalls = mock.history.get.filter((r) => r.url === '/v1/data');
    expect(dataCalls).toHaveLength(2); // original + exactly one retry
  });

  it('skips /refresh entirely when no hsm_csrf cookie is present (stale-session noise reduction)', async () => {
    // Stub document.cookie to '' for this test. happy-dom's cookie store
    // doesn't always honor expiry-based deletion across reruns, so the
    // safest way to model "no prior session" is to override the getter.
    const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '',
      set: () => {
        /* no-op */
      },
    });

    const sessionExpired = vi.fn();
    window.addEventListener('auth:session-expired', sessionExpired);

    try {
      mock.onGet('/v1/auth/me').reply(401);
      mock.onPost('/v1/auth/refresh').reply(200, {}); // would succeed if hit

      await api.get('/v1/auth/me').catch(() => {});

      // The refresh endpoint must NOT have been called — there's no
      // point attempting a refresh without a CSRF token; backend would
      // 401/400 and the right outcome is the same: drop auth state +
      // route to login.
      const refreshCalls = mock.history.post.filter((r) => r.url === '/v1/auth/refresh');
      expect(refreshCalls).toHaveLength(0);
      // The session-expired event fires so the auth provider clears
      // cached user data and the route guards send the user to /login.
      expect(sessionExpired).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('auth:session-expired', sessionExpired);
      // Restore the real cookie property so subsequent tests see normal
      // happy-dom semantics.
      if (cookieDescriptor) {
        Object.defineProperty(document, 'cookie', cookieDescriptor);
      }
    }
  });
});
