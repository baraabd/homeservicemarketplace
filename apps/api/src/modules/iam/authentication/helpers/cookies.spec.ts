// Pins the cookie-flag contract. Any change here is security-sensitive and
// must be intentional: HttpOnly, Secure, SameSite, Path scoping for the
// refresh cookie, and read-by-JS readability for the CSRF cookie.

import type { AppConfigService } from '../../../../config/app-config.service';
import {
  accessCookieOptions,
  csrfCookieOptions,
  refreshCookieOptions,
  REFRESH_PATH,
  authCookieNames,
  clearAuthCookies,
} from './cookies';

function makeConfig(overrides: Record<string, unknown> = {}): AppConfigService {
  const values: Record<string, unknown> = {
    COOKIE_SECURE: true,
    COOKIE_SAMESITE: 'lax',
    COOKIE_DOMAIN: undefined,
    ...overrides,
  };
  return { get: (k: string) => values[k] } as unknown as AppConfigService;
}

describe('cookie helpers', () => {
  it('keeps default names and clears only its configured namespace', () => {
    expect(authCookieNames(makeConfig())).toEqual({
      access: 'hsm_at',
      refresh: 'hsm_rt',
      csrf: 'hsm_csrf',
    });
    const config = makeConfig({ AUTH_COOKIE_PREFIX: 'hsm_staging' });
    expect(authCookieNames(config)).toEqual({
      access: 'hsm_staging_at',
      refresh: 'hsm_staging_rt',
      csrf: 'hsm_staging_csrf',
    });
    const clearCookie = jest.fn();
    clearAuthCookies({ clearCookie } as never, config);
    expect(clearCookie.mock.calls.map(([name]) => name)).toEqual([
      'hsm_staging_at',
      'hsm_staging_rt',
      'hsm_staging_csrf',
    ]);
    expect(clearCookie.mock.calls[1][1]).toMatchObject({
      path: REFRESH_PATH,
      httpOnly: true,
      sameSite: 'strict',
    });
  });

  it.each(['', 'HSM', 'hsm-staging', 'hsm;injected', 'hsm.', 'hsm\n', 'x'.repeat(33)])(
    'rejects invalid prefix %s',
    (prefix) => {
      expect(() => authCookieNames(makeConfig({ AUTH_COOKIE_PREFIX: prefix }))).toThrow(
        /AUTH_COOKIE_PREFIX/,
      );
    },
  );

  describe('accessCookieOptions', () => {
    it('is HttpOnly, Secure, and scoped to root path', () => {
      const opts = accessCookieOptions(makeConfig(), 600);
      expect(opts.httpOnly).toBe(true);
      expect(opts.secure).toBe(true);
      expect(opts.sameSite).toBe('lax');
      expect(opts.path).toBe('/');
      expect(opts.maxAge).toBe(600 * 1000);
    });

    it('honors COOKIE_DOMAIN when configured', () => {
      const opts = accessCookieOptions(makeConfig({ COOKIE_DOMAIN: 'api.example.com' }), 600);
      expect(opts.domain).toBe('api.example.com');
    });

    it('omits the domain field when COOKIE_DOMAIN is unset', () => {
      const opts = accessCookieOptions(makeConfig({ COOKIE_DOMAIN: undefined }), 600);
      expect(opts).not.toHaveProperty('domain');
    });

    it('SameSite tracks COOKIE_SAMESITE config', () => {
      expect(accessCookieOptions(makeConfig({ COOKIE_SAMESITE: 'strict' }), 600).sameSite).toBe(
        'strict',
      );
      expect(accessCookieOptions(makeConfig({ COOKIE_SAMESITE: 'none' }), 600).sameSite).toBe(
        'none',
      );
    });
  });

  describe('refreshCookieOptions', () => {
    it('is HttpOnly, Secure, SameSite=Strict, and Path-scoped to /v1/auth/refresh', () => {
      const expiresAt = new Date(Date.now() + 60_000);
      const opts = refreshCookieOptions(makeConfig(), expiresAt);
      expect(opts.httpOnly).toBe(true);
      expect(opts.secure).toBe(true);
      expect(opts.sameSite).toBe('strict');
      expect(opts.path).toBe(REFRESH_PATH);
    });

    it('forces SameSite=Strict regardless of COOKIE_SAMESITE — refresh never rides along on cross-site navigation', () => {
      const opts = refreshCookieOptions(
        makeConfig({ COOKIE_SAMESITE: 'lax' }),
        new Date(Date.now() + 60_000),
      );
      expect(opts.sameSite).toBe('strict');
    });

    it('maxAge cannot go negative if expiresAt is already in the past', () => {
      const opts = refreshCookieOptions(makeConfig(), new Date(Date.now() - 10_000));
      expect(opts.maxAge).toBe(0);
    });
  });

  describe('csrfCookieOptions', () => {
    it('is NOT HttpOnly (app JS must read it to echo X-CSRF-Token) but is Secure + SameSite=Strict', () => {
      const opts = csrfCookieOptions(makeConfig(), 600);
      expect(opts.httpOnly).toBe(false);
      expect(opts.secure).toBe(true);
      expect(opts.sameSite).toBe('strict');
    });
  });
});
