import { describe, it, expect } from 'vitest';
import { countryFromLocale, countryFromTimezone, resolveCountryFallback } from './geo-bootstrap';

describe('countryFromLocale', () => {
  it('extracts the region from a well-formed locale (en-SA → SA)', () => {
    expect(countryFromLocale('en-SA')).toBe('SA');
  });

  it('returns null for language-only locales (no region)', () => {
    expect(countryFromLocale('en')).toBeNull();
  });

  it('returns null for empty / undefined', () => {
    expect(countryFromLocale('')).toBeNull();
    expect(countryFromLocale(undefined)).toBeNull();
  });

  it('handles locales with extension subtags (en-US-u-hc-h23 → US)', () => {
    expect(countryFromLocale('en-US-u-hc-h23')).toBe('US');
  });
});

describe('countryFromTimezone', () => {
  it('maps a known timezone to its country code (Asia/Riyadh → SA)', () => {
    expect(countryFromTimezone('Asia/Riyadh')).toBe('SA');
  });

  it('returns null for timezones not in the allowlist', () => {
    // An obscure-but-valid tz that we intentionally don't map.
    expect(countryFromTimezone('Pacific/Chatham')).toBeNull();
  });

  it('returns null for empty/undefined', () => {
    expect(countryFromTimezone('')).toBeNull();
    expect(countryFromTimezone(undefined)).toBeNull();
  });
});

describe('resolveCountryFallback', () => {
  it('returns a best-effort country + source without throwing', () => {
    // We cannot assert a specific country here — it depends on the runner's
    // locale. The contract is: never throw, always return a { countryCode,
    // source } tuple. The geo-denied path in the UI relies on this.
    const out = resolveCountryFallback();
    expect(out).toHaveProperty('countryCode');
    expect(['locale', 'timezone', 'unknown']).toContain(out.source);
    // If countryCode is non-null, it MUST be 2 uppercase letters.
    if (out.countryCode) expect(out.countryCode).toMatch(/^[A-Z]{2}$/);
  });
});
