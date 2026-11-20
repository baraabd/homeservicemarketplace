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
    expect(suggestPhoneCountry([locale], 'Asia/Dubai')).toBe(country);
  });

  it('checks ordered device locales without assigning a country to a language', () => {
    expect(suggestPhoneCountry(['ar', 'en', 'sv-SE'], 'Asia/Riyadh')).toBe('SE');
    expect(suggestPhoneCountry(['en'], 'Etc/UTC')).toBe('SA');
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
      language: 'ar',
      languages: ['ar', 'sv-SE'],
      geolocation: { getCurrentPosition },
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
