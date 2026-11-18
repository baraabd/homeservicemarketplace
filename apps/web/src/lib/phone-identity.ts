import { COUNTRY_DIAL_CODES, type CountryDialEntry } from './country-dial-codes';
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

// This small display list is not a global numbering-plan database. These
// prefixes include territories absent from it, so a single listed match must
// not imply a country. Matching explicit choices remain usable.
const MANUAL_COUNTRY_PREFIXES = new Set(['+1', '+39', '+44', '+61', '+212']);

function normalizePhoneNumber(value: string): string {
  return normalizeDecimalDigits(value.trim()).replace(/[\s().-]/gu, '');
}

export interface PhoneCountryDisplay {
  international: boolean;
  country: CountryDialEntry | undefined;
  choices: readonly CountryDialEntry[];
  needsCountryChoice: boolean;
}

/** Display convenience only; never rewrites the entered phone number. */
export function phoneCountryDisplay(countryCode: string, localNumber: string): PhoneCountryDisplay {
  const normalized = normalizePhoneNumber(localNumber);
  const international = normalized.startsWith('+') || normalized.startsWith('00');
  const chosen = COUNTRY_DIAL_CODES.find((entry) => entry.iso2 === countryCode.toUpperCase());
  if (!international) {
    return {
      international,
      country: chosen,
      choices: COUNTRY_DIAL_CODES,
      needsCountryChoice: false,
    };
  }
  const fullNumber = normalized.startsWith('00') ? `+${normalized.slice(2)}` : normalized;
  const matches = /^\+\d*$/u.test(fullNumber)
    ? COUNTRY_DIAL_CODES.filter((entry) => fullNumber.startsWith(entry.dialCode))
    : [];
  const prefixLength = Math.max(0, ...matches.map((entry) => entry.dialCode.length));
  const choices = matches.filter((entry) => entry.dialCode.length === prefixLength);
  const needsCountryChoice =
    choices.length > 1 ||
    (choices.length === 1 && MANUAL_COUNTRY_PREFIXES.has(choices[0]!.dialCode));
  const country =
    choices.find((entry) => entry.iso2 === chosen?.iso2) ??
    (needsCountryChoice ? undefined : choices[0]);
  return { international, country, choices, needsCountryChoice };
}

/** Formatting only. The API remains authoritative for identity validation. */
export function toE164Phone(countryCode: string, localNumber: string): string {
  const normalized = normalizePhoneNumber(localNumber);
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
