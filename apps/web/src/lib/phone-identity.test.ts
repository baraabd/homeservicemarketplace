import { describe, expect, it } from 'vitest';
import {
  countryFlag,
  isValidPhoneIdentity,
  phoneCountryDisplay,
  toE164Phone,
} from './phone-identity';
import { parseGeocodeAddress } from './reverse-geocode-payload';

describe('phone identity formatting', () => {
  it('does not infer a country from browser locale or choose US by default', () => {
    expect(toE164Phone('', '0501234567')).toBe('');
    expect(isValidPhoneIdentity('', '0501234567')).toBe(false);
  });

  it.each([
    ['SA', '050 123 4567', '+966501234567'],
    ['SY', '٠٩٤٤ ١٢٣ ٤٥٦', '+963944123456'],
    ['SE', '070-123 45 67', '+46701234567'],
    ['IT', '06 12345678', '+390612345678'],
    ['IT', '۰۶ ۱۲۳۴۵۶۷۸', '+390612345678'],
    ['', '+49 (151) 23456789', '+4915123456789'],
    ['US', '00963 944123456', '+963944123456'],
    ['US', '٠۰۹۶۳ ۹٤۴۱۲۳٤۵۶', '+963944123456'],
  ])('formats %s / %s as %s', (country, local, expected) => {
    expect(toE164Phone(country, local)).toBe(expected);
    expect(isValidPhoneIdentity(country, local)).toBe(true);
  });

  it.each(['call501234567', '+0 501234567', '++966501234567', '+123', '+1234567890123456'])(
    'refuses malformed identity %s',
    (input) => {
      expect(isValidPhoneIdentity('SA', input)).toBe(false);
    },
  );

  it('keeps shared calling-code countries distinct by ISO selection', () => {
    expect(countryFlag('US')).not.toBe(countryFlag('CA'));
    expect(countryFlag('')).toBe('');
  });

  it('uses the geocoder ISO country code independently of translated country labels', () => {
    expect(
      parseGeocodeAddress({
        display_name: 'حلب، سوريا',
        address: { country: 'سوريا', country_code: 'sy' },
      }),
    ).toMatchObject({ countryCode: 'SY' });
    expect(
      parseGeocodeAddress({ display_name: 'Somewhere', address: { country_code: '<script>' } }),
    ).not.toHaveProperty('countryCode');
  });
});

describe('phone country display', () => {
  it.each(['+963 944123456', '00963 944123456', '+٩٦٣ ٩٤٤١٢٣٤٥٦', '٠۰۹۶۳ ۹٤۴۱۲۳٤۵۶'])(
    'uses the entered international prefix instead of an incompatible country: %s',
    (number) => {
      const display = phoneCountryDisplay('SA', number);
      expect(display.international).toBe(true);
      expect(display.country?.iso2).toBe('SY');
      expect(display.choices.map((entry) => entry.iso2)).toEqual(['SY']);
      expect(toE164Phone(display.country!.iso2, number)).toBe('+963944123456');
    },
  );

  it.each(['+1', '+39', '+44', '+61', '+212'])(
    'does not infer a territory from the incomplete display list for %s',
    (prefix) => {
      const display = phoneCountryDisplay('SA', `${prefix}123456789`);
      expect(display.country).toBeUndefined();
      expect(display.needsCountryChoice).toBe(true);
    },
  );

  it('retains a matching explicit country for a shared prefix', () => {
    expect(phoneCountryDisplay('CA', '+1 4165550123').country?.iso2).toBe('CA');
    expect(phoneCountryDisplay('US', '+1 2025550123').country?.iso2).toBe('US');
    expect(phoneCountryDisplay('', '+1 4165550123').country).toBeUndefined();
  });

  it.each(['+', '00', '٠٠', '+9', '+98 9123456789', '++966123456789', '+963abc'])(
    'shows no stale country for incomplete, unsupported or malformed international input %s',
    (number) => {
      const display = phoneCountryDisplay('SA', number);
      expect(display.international).toBe(true);
      expect(display.country).toBeUndefined();
      expect(display.choices).toEqual([]);
    },
  );

  it('keeps manual national-number selection available without inferring a default', () => {
    expect(phoneCountryDisplay('', '0501234567').country).toBeUndefined();
    expect(phoneCountryDisplay('SA', '0501234567')).toMatchObject({
      international: false,
      country: { iso2: 'SA', dialCode: '+966' },
    });
  });
});
