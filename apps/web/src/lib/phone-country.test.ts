import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDevicePhoneCountry, suggestPhoneCountry } from './phone-country';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('phone country suggestions', () => {
  it.each([
    ['ar-SA', 'SA'],
    ['en-us', 'US'],
    ['sv-SE', 'SE'],
    ['ar-SY', 'SY'],
    ['en-Latn-gb', 'GB'],
    ['en-US-u-hc-h23', 'US'],
  ])('uses a supported explicit locale region: %s', (locale, country) => {
    expect(suggestPhoneCountry([locale], 'Etc/UTC')).toBe(country);
  });

  it('checks ordered device locales without assigning a country to a language', () => {
    expect(suggestPhoneCountry(['ar', 'en', 'sv-SE'], 'Etc/UTC')).toBe('SE');
    expect(suggestPhoneCountry(['en'], 'Etc/UTC')).toBe('SA');
  });

  it.each([
    ['en-US', 'Europe/Stockholm', 'SE'],
    ['sv-SE', 'Asia/Riyadh', 'SA'],
    ['ar-SA', 'Europe/Berlin', 'DE'],
  ])('prefers a known timezone to a conflicting locale: %s / %s', (locale, timezone, country) => {
    expect(suggestPhoneCountry([locale], timezone)).toBe(country);
  });

  it('falls back to a locale when the timezone is unavailable or unsupported', () => {
    expect(suggestPhoneCountry(['en-US'], undefined)).toBe('US');
    expect(suggestPhoneCountry(['sv-SE'], 'Pacific/Chatham')).toBe('SE');
  });

  it.each([
    ['Europe/Stockholm', 'SE'],
    ['Asia/Damascus', 'SY'],
    ['Asia/Dubai', 'AE'],
  ])('uses the existing timezone allowlist for regionless locales: %s', (timezone, country) => {
    expect(suggestPhoneCountry(['ar', 'en'], timezone)).toBe(country);
  });

  it.each(['bad_tag', '', 'en-ZZ', 'en-NZ', 'es-419'])(
    'ignores malformed or unsupported locale regions: %s',
    (locale) => {
      expect(suggestPhoneCountry([locale], 'Europe/Stockholm')).toBe('SE');
    },
  );

  it('uses Saudi Arabia when no supported device hint is available', () => {
    expect(suggestPhoneCountry([], undefined)).toBe('SA');
    expect(suggestPhoneCountry(['ar', 'en-ZZ'], 'Etc/UTC')).toBe('SA');
    expect(suggestPhoneCountry(['en'], 'Pacific/Chatham')).toBe('SA');
  });

  it('reads device hints without geolocation, network, or storage access', () => {
    const getCurrentPosition = vi.fn();
    const fetch = vi.fn();
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    vi.stubGlobal('navigator', {
      language: 'en-US',
      languages: ['en-US', 'ar-SA'],
      geolocation: { getCurrentPosition },
    });
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      ...new Intl.DateTimeFormat().resolvedOptions(),
      timeZone: 'Europe/Stockholm',
    });
    vi.stubGlobal('fetch', fetch);
    expect(getDevicePhoneCountry()).toBe('SE');
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('supports SSR and browsers with unavailable locale/timezone APIs', () => {
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('Intl', undefined);
    expect(getDevicePhoneCountry()).toBe('SA');
  });
});
