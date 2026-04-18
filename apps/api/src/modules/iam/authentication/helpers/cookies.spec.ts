// Pins the cookie-flag contract. Any change here is security-sensitive and
// must be intentional: HttpOnly, Secure, SameSite, Path scoping for the
// refresh cookie, and read-by-JS readability for the CSRF cookie.

import type { AppConfigService } from '../../../../config/app-config.service';
import {
  accessCookieOptions,
  csrfCookieOptions,
  refreshCookieOptions,
  REFRESH_PATH,
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
