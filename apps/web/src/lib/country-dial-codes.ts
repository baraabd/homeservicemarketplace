// Minimal ISO-3166 alpha-2 → international dialing code lookup for
// onboarding convenience. Intentionally small: the frontend only uses this
// to pre-fill the phone prefix selector. Not a geocoding or validation
// source of truth. Keep alphabetical by ISO code.
//
// The default prefix when we cannot resolve a country is '+1' (US). The
// UI must ALWAYS allow the user to override.

export interface CountryDialEntry {
  iso2: string; // ISO 3166-1 alpha-2
  name: string; // English display name
  dialCode: string; // E.164 country calling code, e.g. '+20'
}

export const COUNTRY_DIAL_CODES: readonly CountryDialEntry[] = [
  { iso2: 'AE', name: 'United Arab Emirates', dialCode: '+971' },
  { iso2: 'AU', name: 'Australia', dialCode: '+61' },
  { iso2: 'BH', name: 'Bahrain', dialCode: '+973' },
  { iso2: 'BR', name: 'Brazil', dialCode: '+55' },
  { iso2: 'CA', name: 'Canada', dialCode: '+1' },
  { iso2: 'CH', name: 'Switzerland', dialCode: '+41' },
  { iso2: 'DE', name: 'Germany', dialCode: '+49' },
  { iso2: 'EG', name: 'Egypt', dialCode: '+20' },
  { iso2: 'ES', name: 'Spain', dialCode: '+34' },
  { iso2: 'FR', name: 'France', dialCode: '+33' },
  { iso2: 'GB', name: 'United Kingdom', dialCode: '+44' },
  { iso2: 'IN', name: 'India', dialCode: '+91' },
  { iso2: 'IT', name: 'Italy', dialCode: '+39' },
  { iso2: 'JO', name: 'Jordan', dialCode: '+962' },
  { iso2: 'KW', name: 'Kuwait', dialCode: '+965' },
  { iso2: 'LB', name: 'Lebanon', dialCode: '+961' },
  { iso2: 'MA', name: 'Morocco', dialCode: '+212' },
  { iso2: 'NL', name: 'Netherlands', dialCode: '+31' },
  { iso2: 'OM', name: 'Oman', dialCode: '+968' },
  { iso2: 'QA', name: 'Qatar', dialCode: '+974' },
  { iso2: 'SA', name: 'Saudi Arabia', dialCode: '+966' },
  { iso2: 'SE', name: 'Sweden', dialCode: '+46' },
  { iso2: 'TR', name: 'Turkey', dialCode: '+90' },
  { iso2: 'US', name: 'United States', dialCode: '+1' },
];

const BY_ISO: Readonly<Record<string, CountryDialEntry>> = Object.freeze(
  Object.fromEntries(COUNTRY_DIAL_CODES.map((c) => [c.iso2, c])),
);

export const DEFAULT_DIAL_ENTRY: CountryDialEntry = BY_ISO['US']!;

export function dialForCountry(iso2: string | null | undefined): CountryDialEntry {
  if (!iso2) return DEFAULT_DIAL_ENTRY;
  return BY_ISO[iso2.toUpperCase()] ?? DEFAULT_DIAL_ENTRY;
}
