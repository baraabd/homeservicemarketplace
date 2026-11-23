// K02 — hsm.amount-unit.v1: exact decimal ⇄ minor-unit conversion, the
// approved-currency policy and the booked-value aggregation rules.
// Hermetic; the DB CHECK and the end-to-end path are covered by
// test/integration/k02-saudi-contracts.integration.spec.ts.
import {
  AMOUNT_UNIT_CONTRACT_VERSION,
  APPROVED_CURRENCY_SCALES,
  AmountUnitError,
  LAUNCH_CURRENCY,
  MAX_BID_MAJOR_UNITS,
  amountProvenance,
  decimalToMinor,
  isApprovedCurrency,
  minorToDecimal,
  normalizeDigits,
  parseApprovedBidAmount,
} from '@homeservicemarketplace/contracts';

import {
  summarizeBookedValue,
  toSafeNumber,
  type BookedValueGroupRow,
} from '../../src/infrastructure/persistence/bookings/booked-value';

const code = (fn: () => unknown): string => {
  try {
    fn();
    return 'NONE';
  } catch (error) {
    return error instanceof AmountUnitError ? error.code : 'OTHER';
  }
};

describe('K02 amount-unit contract', () => {
  it('approves exactly SAR at ISO 4217 exponent 2 for the Saudi launch', () => {
    expect(AMOUNT_UNIT_CONTRACT_VERSION).toBe('hsm.amount-unit.v1');
    expect(APPROVED_CURRENCY_SCALES).toEqual({ SAR: 2 });
    expect(LAUNCH_CURRENCY).toBe('SAR');
    expect(isApprovedCurrency('SAR')).toBe(true);
    for (const other of ['USD', 'sar', 'EUR', '', 'toString', '__proto__', 'constructor']) {
      expect(isApprovedCurrency(other)).toBe(false);
    }
  });

  it('acceptance example: 100.25 SAR → 10025 halalas → 100.25 SAR', () => {
    const parsed = parseApprovedBidAmount('100.25', 'SAR');
    expect(parsed).toEqual({ amount: 10025, currency: 'SAR', amountScale: 2 });
    expect(minorToDecimal(parsed.amount, parsed.amountScale)).toBe('100.25');
  });

  it('converts without binary floating point: values a float would round', () => {
    // 0.29 * 100 === 28.999999999999996 and 1.15 * 100 === 114.99999999999999
    // in IEEE-754; Math.round(x * 100) style code gets some of these wrong.
    const cases: Array<[string, bigint]> = [
      ['0.29', 29n],
      ['1.15', 115n],
      ['4.35', 435n],
      ['1005.01', 100501n],
      ['0.01', 1n],
      ['7', 700n],
      ['7.5', 750n],
      ['999999.99', 99999999n],
      ['1000000', 100000000n],
    ];
    for (const [input, minor] of cases) {
      expect(decimalToMinor(input, 2)).toBe(minor);
    }
  });

  it('round-trips every cent from 0.00 to 1,000.00 exactly', () => {
    for (let halalas = 0; halalas <= 100_000; halalas += 1) {
      const decimal = minorToDecimal(halalas, 2);
      expect(decimalToMinor(decimal, 2)).toBe(BigInt(halalas));
    }
  });

  it('accepts Arabic-Indic and Persian digits and the Arabic decimal separator', () => {
    expect(normalizeDigits('١٠٠٫٢٥')).toBe('100.25');
    expect(decimalToMinor('١٠٠٫٢٥', 2)).toBe(10025n);
    expect(decimalToMinor('۱۰۰.۲۵', 2)).toBe(10025n);
    expect(decimalToMinor('  100.25 ', 2)).toBe(10025n);
  });

  it('refuses ambiguous or lossy input instead of guessing or rounding', () => {
    expect(code(() => decimalToMinor('1.005', 2))).toBe('TOO_MANY_FRACTION_DIGITS');
    for (const bad of [
      '',
      '.5',
      '5.',
      '1,000',
      '1 000',
      '1e3',
      '-1',
      '+1',
      '01',
      '0x10',
      'NaN',
      'Infinity',
      '1.2.3',
      '١,٠٠٠',
    ]) {
      expect(code(() => decimalToMinor(bad, 2))).toBe('INVALID_DECIMAL');
    }
    expect(code(() => decimalToMinor(100 as unknown as string, 2))).toBe('INVALID_DECIMAL');
    expect(code(() => decimalToMinor('1', 9))).toBe('INVALID_SCALE');
  });

  it('enforces the approved currency and the bid range server-side', () => {
    expect(code(() => parseApprovedBidAmount('10', 'USD'))).toBe('CURRENCY_NOT_APPROVED');
    expect(code(() => parseApprovedBidAmount('0', 'SAR'))).toBe('AMOUNT_OUT_OF_RANGE');
    expect(code(() => parseApprovedBidAmount('0.00', 'SAR'))).toBe('AMOUNT_OUT_OF_RANGE');
    expect(parseApprovedBidAmount('0.01', 'SAR').amount).toBe(1);
    expect(parseApprovedBidAmount(String(MAX_BID_MAJOR_UNITS), 'SAR').amount).toBe(100_000_000);
    expect(code(() => parseApprovedBidAmount('1000000.01', 'SAR'))).toBe('AMOUNT_OUT_OF_RANGE');
    // The PostgreSQL INTEGER column can hold the maximum.
    expect(100_000_000).toBeLessThan(2 ** 31);
  });

  it('formats minor units back to an exact decimal, beyond float precision too', () => {
    expect(minorToDecimal(0, 2)).toBe('0.00');
    expect(minorToDecimal(5, 2)).toBe('0.05');
    expect(minorToDecimal(10025n, 2)).toBe('100.25');
    expect(minorToDecimal(9007199254740993n, 2)).toBe('90071992547409.93');
    expect(minorToDecimal(-150, 2)).toBe('-1.50');
    expect(code(() => minorToDecimal(1.5, 2))).toBe('AMOUNT_OUT_OF_RANGE');
  });

  it('classifies provenance: a null scale is LEGACY_UNVERIFIED, never assumed', () => {
    expect(amountProvenance(2)).toBe('MINOR_UNITS');
    expect(amountProvenance(null)).toBe('LEGACY_UNVERIFIED');
    expect(amountProvenance(undefined)).toBe('LEGACY_UNVERIFIED');
  });
});

describe('K02 booked-value aggregation (summarizeBookedValue)', () => {
  const row = (over: Partial<BookedValueGroupRow>): BookedValueGroupRow => ({
    currency: 'SAR',
    amountScale: 2,
    pricingType: 'FIXED',
    completedCount: 0,
    completedValue: 0,
    currentMonthValue: 0,
    inFlightCount: 0,
    inFlightValue: 0,
    ...over,
  });

  it('never adds two currencies together and sorts per currency', () => {
    const out = summarizeBookedValue([
      row({
        currency: 'SAR',
        completedCount: 2,
        completedValue: 20050,
        inFlightCount: 1,
        inFlightValue: 10025,
      }),
      // A future approved currency would arrive as its own group.
      row({ currency: 'AED', amountScale: 2, completedCount: 1, completedValue: 999 }),
    ]);
    expect(out.byCurrency).toEqual([
      expect.objectContaining({
        currency: 'AED',
        amountScale: 2,
        completedValue: 999,
        completedCount: 1,
      }),
      expect.objectContaining({
        currency: 'SAR',
        amountScale: 2,
        completedValue: 20050,
        inFlightValue: 10025,
      }),
    ]);
    expect(out.completedCount).toBe(3);
  });

  it('excludes legacy-unit and hourly rows from every sum but counts them', () => {
    const out = summarizeBookedValue([
      row({ completedCount: 1, completedValue: 10025 }),
      row({
        currency: 'USD',
        amountScale: null,
        completedCount: 4,
        completedValue: 1000,
        inFlightCount: 1,
        inFlightValue: 35,
      }),
      row({ pricingType: 'HOURLY', completedCount: 2, completedValue: 15000 }),
      row({
        currency: 'USD',
        amountScale: null,
        pricingType: 'HOURLY',
        completedCount: 1,
        completedValue: 50,
      }),
    ]);
    expect(out.byCurrency).toEqual([
      expect.objectContaining({ currency: 'SAR', completedValue: 10025, completedCount: 1 }),
    ]);
    expect(out.excluded).toEqual([
      { currency: 'SAR', reason: 'HOURLY_RATE', completedCount: 2, inFlightCount: 0 },
      { currency: 'USD', reason: 'LEGACY_UNVERIFIED', completedCount: 5, inFlightCount: 1 },
    ]);
    // Every completed booking is counted exactly once, summed or excluded.
    expect(out.completedCount).toBe(8);
  });

  it('acceptance: mixed USD/SAR data is never combined into one figure', () => {
    const out = summarizeBookedValue([
      row({ completedCount: 1, completedValue: 10025 }),
      row({ currency: 'USD', amountScale: null, completedCount: 1, completedValue: 1000 }),
    ]);
    const total = out.byCurrency.reduce((n, c) => n + c.completedValue, 0);
    expect(total).toBe(10025); // the USD 1000 is not in it
    expect(out.byCurrency.map((c) => c.currency)).toEqual(['SAR']);
  });

  it('refuses a lossy total instead of returning a wrong number', () => {
    expect(() =>
      summarizeBookedValue([
        row({ completedValue: Number.MAX_SAFE_INTEGER }),
        row({ completedValue: 2 }),
      ]),
    ).toThrow(/safe integer/);
    expect(toSafeNumber(12n)).toBe(12);
    expect(toSafeNumber(null)).toBe(0);
    expect(() => toSafeNumber(2n ** 60n)).toThrow(/safe integer/);
  });
});
