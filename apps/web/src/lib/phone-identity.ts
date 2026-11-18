import { COUNTRY_DIAL_CODES } from './country-dial-codes';
import { normalizeDecimalDigits } from './normalize-decimal-digits';

const NATIONAL_ZERO_PREFIX = new Set([
  'AE',
  'AU',
  'CH',
  'DE',
  'DZ',
  'EG',
  'FR',
  'GB',
  'IN',
  'IQ',
  'JO',
  'LB',
  'LY',
  'MA',
  'NL',
  'PS',
  'SA',
  'SD',
  'SE',
  'SY',
  'TR',
  'YE',
]);

/** Formatting only. The API remains authoritative for identity validation. */
export function toE164Phone(countryCode: string, localNumber: string): string {
  const normalized = normalizeDecimalDigits(localNumber.trim()).replace(/[\s().-]/gu, '');
  if (!/^(?:\+|00)?\d+$/u.test(normalized)) return '';
  if (normalized.startsWith('+')) return normalized;
  if (normalized.startsWith('00')) return `+${normalized.slice(2)}`;
  const country = COUNTRY_DIAL_CODES.find((entry) => entry.iso2 === countryCode.toUpperCase());
  if (!country) return '';
  // Remove only a known national trunk prefix. Italy's fixed-line zero is
  // part of the international number; countries without this prefix keep it.
  const national = NATIONAL_ZERO_PREFIX.has(country.iso2)
    ? normalized.replace(/^0/u, '')
    : normalized;
  return `${country.dialCode}${national}`;
}

export function isValidPhoneIdentity(countryCode: string, localNumber: string): boolean {
  return /^\+[1-9]\d{6,14}$/u.test(toE164Phone(countryCode, localNumber));
}

export function countryFlag(iso2: string): string {
  return /^[A-Z]{2}$/u.test(iso2)
    ? String.fromCodePoint(...Array.from(iso2, (char) => 0x1f1e6 + char.charCodeAt(0) - 65))
    : '';
}
