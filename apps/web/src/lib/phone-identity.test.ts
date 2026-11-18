import { describe, expect, it } from 'vitest';
import { countryFlag, isValidPhoneIdentity, toE164Phone } from './phone-identity';
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
    ['', '+49 (151) 23456789', '+4915123456789'],
    ['US', '00963 944123456', '+963944123456'],
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
