// Sprint 7.13 — compact service-address display helper.
//
// Why: reverse-geocoders (Nominatim) return a long, repetitive
// comma chain, e.g.
//   "شارع السجن, Bayadah district, حي قلعة الشريف, حلب,
//    ناحية مركز جبل سمعان, منطقة جبل سمعان, محافظة حلب, سوريا"
// The persisted snapshot keeps this verbose `line1` (plus the parsed
// `city` / `country`) so provider matching, distance, and cityKey stay
// intact — see AddressSnapshot. This helper is DISPLAY-ONLY: it never
// mutates the snapshot. It strips the broad administrative tiers
// (country, governorate, region, sub-district) and the city itself —
// the user already knows which city they're in — and keeps the useful
// local parts (street, neighbourhood, district, landmark).
//
// It is intentionally heuristic and tolerant: it handles Arabic (،) and
// Latin (,) separators, mixed-script strings, duplicate tokens, and
// empty parts, and it never returns a string with dangling separators.

export interface AddressDisplayInput {
  line1?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface AddressDisplayOptions {
  // The seeker's own profile/service-area city. When provided it is
  // treated as redundant (dropped) just like the snapshot city, so a
  // job inside the user's own city never repeats it.
  profileCity?: string | null;
  // Soft cap for mobile cards. Longer results are truncated with an
  // ellipsis. Defaults to 70 characters.
  maxLength?: number;
}

const DEFAULT_MAX_LENGTH = 70;
// Keep at most this many local parts so the line stays scannable even
// when several useful neighbourhood tokens survive the filter.
const MAX_PARTS = 3;

// Both comma variants used across Arabic/Latin geocoder output.
const SEPARATORS = /[,،]/;

// Broad administrative-tier keywords. A part containing any of these is
// dropped — these are the country/governorate/region/sub-district tiers
// the seeker doesn't need repeated on every card.
const ADMIN_TOKEN_PATTERNS: RegExp[] = [
  /محافظة/, // governorate (ar)
  /منطقة/, // region / broad area (ar)
  /ناحية/, // nahiyah / sub-district (ar)
  /\bgovernorate\b/i,
  /\bprovince\b/i,
  /\bregion\b/i,
  /\bmuhafaza\b/i,
];

function normalizeToken(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Strip a leading administrative keyword from a city label so the
// fallback (when no local part survives) reads "حلب" rather than
// "محافظة حلب".
function stripAdminPrefix(value: string): string {
  let out = value.trim();
  for (const re of ADMIN_TOKEN_PATTERNS) {
    out = out.replace(re, '').trim();
  }
  return out.replace(/\s+/g, ' ').trim() || value.trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/**
 * Produce a short, useful address for display inside the user's city.
 *
 * Accepts either the persisted address snapshot shape
 * (`{ line1, city, country }`) or a raw freeform geocoder string.
 * Never throws; returns `''` only when there is genuinely nothing to
 * show (the caller decides the placeholder).
 *
 * Display-only — does NOT alter the raw snapshot, lat/lng, city, or
 * cityKey used for provider matching.
 */
export function formatServiceAddressForDisplay(
  input: AddressDisplayInput | string | null | undefined,
  options: AddressDisplayOptions = {},
): string {
  if (input == null) return '';

  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;

  let raw: string;
  let city: string | null = null;
  let country: string | null = null;

  if (typeof input === 'string') {
    raw = input;
  } else {
    raw = input.line1 ?? '';
    city = input.city ?? null;
    country = input.country ?? null;
    if (raw.trim().length === 0) {
      // No street line — fall back to the cleaned city.
      return city ? truncate(stripAdminPrefix(city), maxLength) : '';
    }
  }

  if (raw.trim().length === 0) return '';

  // Values we consider redundant and drop from the local parts.
  const redundant: string[] = [];
  for (const value of [city, country, options.profileCity]) {
    if (value && value.trim().length > 0) redundant.push(normalizeToken(value));
  }

  const seen = new Set<string>();
  const kept: string[] = [];

  for (const partRaw of raw.split(SEPARATORS)) {
    const part = partRaw.trim().replace(/\s+/g, ' ');
    if (part.length === 0) continue;

    const norm = normalizeToken(part);

    // Drop parts that match a redundant city/country/profile token.
    // Exact match always drops; a substring drop only fires when the
    // redundant value *contains* this part (e.g. city "محافظة حلب"
    // contains the bare token "حلب"). We deliberately do NOT drop when
    // the part contains the redundant value — that would wrongly strip
    // "Downtown" because it contains the city "Town"; such "city +
    // suffix" tiers (e.g. "Riyadh Region") are handled by the admin
    // patterns below instead.
    const isRedundant = redundant.some((r) => norm === r || (norm.length >= 3 && r.includes(norm)));
    if (isRedundant) continue;

    // Drop the broad administrative tiers.
    if (ADMIN_TOKEN_PATTERNS.some((re) => re.test(part))) continue;

    // Dedupe repeated tokens (case/space-insensitive).
    if (seen.has(norm)) continue;
    seen.add(norm);

    kept.push(part);
    if (kept.length >= MAX_PARTS) break;
  }

  let result: string;
  if (kept.length > 0) {
    result = kept.join('، ');
  } else if (city && city.trim().length > 0) {
    result = stripAdminPrefix(city);
  } else {
    // Last resort: the cleaned raw string (only admin tiers removed).
    result = raw.trim();
  }

  return truncate(result, maxLength);
}
