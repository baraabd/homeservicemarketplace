import { COUNTRY_DIAL_CODES } from './country-dial-codes';
import { countryFromLocale, countryFromTimezone } from './geo-bootstrap';

const SUPPORTED_COUNTRIES = new Set(COUNTRY_DIAL_CODES.map(({ iso2 }) => iso2));
const DEFAULT_PHONE_COUNTRY = 'SA';

/** A reversible UI suggestion, never evidence of a phone number's country. */
export function suggestPhoneCountry(locales: readonly string[], timezone?: string): string {
  for (const locale of locales) {
    try {
      // Canonicalize case and scripts, and reject malformed locale tags. Do not
      // maximize language-only tags: Arabic/English do not identify a country.
      const country = countryFromLocale(new Intl.Locale(locale).baseName);
      if (country && SUPPORTED_COUNTRIES.has(country)) return country;
    } catch {
      // A malformed or unsupported locale must not prevent the next fallback.
    }
  }

  const country = countryFromTimezone(timezone);
  return country && SUPPORTED_COUNTRIES.has(country) ? country : DEFAULT_PHONE_COUNTRY;
}

/** Read device hints only; never requests coordinates, network, or storage. */
export function getDevicePhoneCountry(): string {
  let locales: string[] = [];
  let timezone: string | undefined;
  try {
    if (typeof navigator !== 'undefined') {
      locales = [navigator.language, ...(navigator.languages ?? [])].filter(Boolean);
    }
  } catch {
    // Restricted browser APIs still allow timezone/default selection.
  }
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // SSR and older runtimes can use the explicit default.
  }
  return suggestPhoneCountry(locales, timezone);
}
