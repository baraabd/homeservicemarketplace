// K02 — one exact amount-unit contract for marketplace bid and booking
// amounts (R18 D-2, R16 P8).
//
// A stored amount is an integer plus an uppercase currency plus an
// `amountScale`:
//
//   amountScale = 2    the integer is minor units (SAR halalas). 10025 SAR at
//                      scale 2 is exactly 100.25 SAR.
//   amountScale = null LEGACY_UNVERIFIED. The row was written before K02, when
//                      producers disagreed on the unit (bid form: whole units;
//                      wallet/admin displays: cents). Its unit cannot be
//                      proven, so it is quarantined: shown as its raw integer
//                      with an explicit "unverified" label, never summed into
//                      a total and never multiplied or divided.
//
// Which currencies a NEW record may use is server policy, not client input.
// The Saudi launch approves exactly one: SAR at ISO 4217 exponent 2. Adding a
// currency is a reviewed change to APPROVED_CURRENCY_SCALES plus the database
// CHECK constraint `*_amountScale_currency_check`; there is no FX conversion.
//
// Decimal input is converted to minor units ONCE, by string arithmetic, so
// no binary floating-point value ever stands between "100.25" and 10025.

export const AMOUNT_UNIT_CONTRACT_VERSION = 'hsm.amount-unit.v1' as const;

/** Currencies a new bid/booking may be priced in, with their minor-unit scale. */
export const APPROVED_CURRENCY_SCALES = Object.freeze({ SAR: 2 } as const);
export type ApprovedCurrency = keyof typeof APPROVED_CURRENCY_SCALES;

/** The currency the server assigns to every new Saudi launch record. */
export const LAUNCH_CURRENCY: ApprovedCurrency = 'SAR';
export const LAUNCH_CURRENCY_SCALE = APPROVED_CURRENCY_SCALES[LAUNCH_CURRENCY];

/** Largest bid a provider may enter, in major units (1,000,000.00 SAR). */
export const MAX_BID_MAJOR_UNITS = 1_000_000;

export type AmountProvenance = 'MINOR_UNITS' | 'LEGACY_UNVERIFIED';

export function amountProvenance(amountScale: number | null | undefined): AmountProvenance {
  return amountScale === null || amountScale === undefined ? 'LEGACY_UNVERIFIED' : 'MINOR_UNITS';
}

export function isApprovedCurrency(value: unknown): value is ApprovedCurrency {
  return typeof value === 'string' && Object.hasOwn(APPROVED_CURRENCY_SCALES, value);
}

export class AmountUnitError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_DECIMAL'
      | 'TOO_MANY_FRACTION_DIGITS'
      | 'AMOUNT_OUT_OF_RANGE'
      | 'CURRENCY_NOT_APPROVED'
      | 'INVALID_SCALE',
    message: string,
  ) {
    super(message);
    this.name = 'AmountUnitError';
  }
}

// Arabic-Indic (U+0660–0669) and Extended Arabic-Indic / Persian
// (U+06F0–06F9) digits are accepted and mapped to ASCII. The Arabic decimal
// separator U+066B is accepted as ".". Grouping separators are refused: "1,000"
// is ambiguous across locales and is never guessed.
const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
    } else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
      out += String(code - EXTENDED_ARABIC_INDIC_ZERO);
    } else if (ch === '٫') {
      out += '.';
    } else {
      out += ch;
    }
  }
  return out;
}

const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/u;

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > 4) {
    throw new AmountUnitError('INVALID_SCALE', 'Scale must be an integer from 0 to 4');
  }
}

/**
 * Exact decimal (major units) → integer minor units. "100.25" at scale 2 is
 * 10025n. Surrounding whitespace is trimmed; Arabic-Indic digits are
 * accepted. Signs, exponents, grouping separators, leading zeros ("007") and
 * more fraction digits than the scale ("1.005") are refused — a value is
 * never rounded.
 */
export function decimalToMinor(input: string, scale: number): bigint {
  assertScale(scale);
  if (typeof input !== 'string') {
    throw new AmountUnitError('INVALID_DECIMAL', 'Amount must be a decimal string');
  }
  const normalized = normalizeDigits(input.trim());
  const match = DECIMAL_PATTERN.exec(normalized);
  if (!match) {
    throw new AmountUnitError('INVALID_DECIMAL', 'Amount must be a plain decimal number');
  }
  const whole = match[1]!;
  const fraction = match[2] ?? '';
  if (fraction.length > scale) {
    throw new AmountUnitError(
      'TOO_MANY_FRACTION_DIGITS',
      `Amount has more than ${scale} decimal places`,
    );
  }
  const padded = fraction.padEnd(scale, '0');
  return BigInt(whole + padded);
}

/** Integer minor units → exact decimal string. 10025 at scale 2 is "100.25". */
export function minorToDecimal(minor: bigint | number, scale: number): string {
  assertScale(scale);
  if (typeof minor === 'number' && !Number.isSafeInteger(minor)) {
    throw new AmountUnitError('AMOUNT_OUT_OF_RANGE', 'Amount must be a safe integer');
  }
  const value = BigInt(minor);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString();
  if (scale === 0) return (negative ? '-' : '') + digits;
  const padded = digits.padStart(scale + 1, '0');
  const whole = padded.slice(0, padded.length - scale);
  const fraction = padded.slice(padded.length - scale);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/**
 * Server-side policy: parse a provider's decimal bid in the requested
 * currency. The currency must be approved; the amount must be at least one
 * minor unit and at most MAX_BID_MAJOR_UNITS. Returns a JS number because
 * the bid/booking columns are PostgreSQL INTEGER (max 21,474,836.47 SAR).
 */
export function parseApprovedBidAmount(
  amountDecimal: string,
  currency: string,
): { amount: number; currency: ApprovedCurrency; amountScale: number } {
  if (!isApprovedCurrency(currency)) {
    throw new AmountUnitError('CURRENCY_NOT_APPROVED', 'Currency is not approved for new records');
  }
  const scale = APPROVED_CURRENCY_SCALES[currency];
  const minor = decimalToMinor(amountDecimal, scale);
  const max = BigInt(MAX_BID_MAJOR_UNITS) * 10n ** BigInt(scale);
  if (minor < 1n || minor > max) {
    throw new AmountUnitError('AMOUNT_OUT_OF_RANGE', 'Amount is outside the allowed range');
  }
  return { amount: Number(minor), currency, amountScale: scale };
}

// ─── Read-model aggregation contract ───────────────────────────────────
//
// Booking amounts are BOOKED VALUES, not collected money: under the Saudi
// launch scope the platform collects provider subscriptions only and holds
// no booking funds (R16 D-1 remains disabled). Aggregates therefore:
//   • group by currency and never add two currencies together;
//   • sum only verified (non-null scale) FIXED-price amounts — an hourly bid
//     is a rate, not a payable total, and a legacy amount has no proven unit;
//   • report every excluded row as a count, so nothing disappears silently;
//   • carry no fee or net figure: no platform fee is approved (R16 P10).

/** Verified FIXED-price booked value in one currency. */
export interface CurrencyBookedValue {
  currency: string;
  /** Always a verified scale (2 for SAR). */
  amountScale: number;
  /** Sum of COMPLETED bookings, minor units. */
  completedValue: number;
  completedCount: number;
  /** Sum of COMPLETED bookings since the start of the current UTC month. */
  currentMonthValue: number;
  /** Sum of SCHEDULED + IN_PROGRESS bookings (not earned yet). */
  inFlightValue: number;
  inFlightCount: number;
}

export type ExcludedAmountReason = 'LEGACY_UNVERIFIED' | 'HOURLY_RATE';

/** Bookings left out of every sum, by reason and currency. */
export interface ExcludedAmountGroup {
  currency: string;
  reason: ExcludedAmountReason;
  completedCount: number;
  inFlightCount: number;
}

/** No platform fee is approved; fee and net figures are not computed. */
export type BookingFeeStatus = 'NOT_APPROVED';
