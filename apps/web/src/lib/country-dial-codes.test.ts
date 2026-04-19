import { describe, it, expect } from 'vitest';
import { COUNTRY_DIAL_CODES, DEFAULT_DIAL_ENTRY, dialForCountry } from './country-dial-codes';

describe('COUNTRY_DIAL_CODES table', () => {
  it('every entry has a valid iso2 (uppercase, 2 letters) and dial code', () => {
    for (const entry of COUNTRY_DIAL_CODES) {
      expect(entry.iso2).toMatch(/^[A-Z]{2}$/);
      expect(entry.dialCode).toMatch(/^\+\d{1,4}$/);
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  it('iso2 codes are unique', () => {
    const codes = COUNTRY_DIAL_CODES.map((c) => c.iso2);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('dialForCountry', () => {
  it('returns the matching entry for a known ISO code', () => {
    expect(dialForCountry('SA').dialCode).toBe('+966');
    expect(dialForCountry('sa').dialCode).toBe('+966'); // case-insensitive
    expect(dialForCountry('EG').dialCode).toBe('+20');
  });

  it('falls back to the default entry for unknown / null / undefined', () => {
    expect(dialForCountry(null).dialCode).toBe(DEFAULT_DIAL_ENTRY.dialCode);
    expect(dialForCountry(undefined).dialCode).toBe(DEFAULT_DIAL_ENTRY.dialCode);
    expect(dialForCountry('ZZ').dialCode).toBe(DEFAULT_DIAL_ENTRY.dialCode);
    expect(dialForCountry('').dialCode).toBe(DEFAULT_DIAL_ENTRY.dialCode);
  });
});
