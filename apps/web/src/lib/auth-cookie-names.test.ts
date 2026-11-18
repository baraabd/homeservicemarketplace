import { describe, expect, it } from 'vitest';
import { csrfCookieName, readCsrfCookie } from './auth-cookie-names';

describe('environment cookie names', () => {
  it('keeps the production default and selects only the configured staging cookie', () => {
    expect(csrfCookieName(undefined)).toBe('hsm_csrf');
    const cookies = 'hsm_csrf=production; hsm_staging_csrf=staging; other=x';
    expect(readCsrfCookie(cookies, csrfCookieName('hsm_staging'))).toBe('staging');
    expect(readCsrfCookie(cookies, csrfCookieName(undefined))).toBe('production');
    expect(readCsrfCookie('hsm_csrf=production', csrfCookieName('hsm_staging'))).toBeUndefined();
  });

  it('matches exact names without a fallback, substring or regular expression match', () => {
    expect(readCsrfCookie('other_hsm_csrf=bad; hsm_csrf=good=tail', 'hsm_csrf')).toBe('good=tail');
    expect(readCsrfCookie('hsm_csrf=', 'hsm_csrf')).toBeUndefined();
  });

  it.each(['', 'HSM', 'hsm-staging', 'hsm;injected', 'hsm.', 'hsm\n', 'x'.repeat(33)])(
    'rejects invalid prefix %s',
    (prefix) => expect(() => csrfCookieName(prefix)).toThrow(/VITE_AUTH_COOKIE_PREFIX/),
  );
});
