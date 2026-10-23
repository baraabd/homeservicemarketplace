import { describe, expect, it } from 'vitest';
import { toMoneyWire } from '@homeservicemarketplace/contracts';
import {
  formatManualAmount,
  MANUAL_PAYMENT_COPY,
  manualMethodLabel,
  manualStatusLabel,
  parseManualAmount,
} from './manual-payments.copy';

describe('R30 bilingual copy and exact amount display', () => {
  it('has complete nonempty Arabic and English key parity', () => {
    expect(Object.keys(MANUAL_PAYMENT_COPY.ar).sort()).toEqual(
      Object.keys(MANUAL_PAYMENT_COPY.en).sort(),
    );
    for (const lang of ['ar', 'en'] as const)
      for (const value of Object.values(MANUAL_PAYMENT_COPY[lang]))
        expect(value.trim()).not.toBe('');
  });
  it('preserves values above safe JavaScript integer precision', () => {
    expect(
      formatManualAmount(
        toMoneyWire({ amountMinor: 9223372036854775807n, currency: 'USD' }),
        2,
        'en',
      ),
    ).toBe('92,233,720,368,547,758.07 USD');
  });
  it('uses the approved scale, including zero and three, without a two-decimal default', () => {
    const amount = toMoneyWire({ amountMinor: 1005n, currency: 'SYP' });
    expect(formatManualAmount(amount, 0, 'en')).toBe('1,005 SYP');
    expect(formatManualAmount(amount, 3, 'en')).toBe('1.005 SYP');
    expect(formatManualAmount(amount, null, 'en')).toBe('1005 SYP (minor units)');
  });
  it('parses operator-entered decimals exactly and supports Arabic digits', () => {
    expect(parseManualAmount('1234.50', 2)).toBe('123450');
    expect(parseManualAmount('١٢٣٤٫٥', 2)).toBe('123450');
    expect(parseManualAmount('92233720368547758.07', 2)).toBe('9223372036854775807');
  });
  it.each(['12.001', '-1', '1e3', '01', '1,000', 'NaN', 'Infinity', '92233720368547758.08'])(
    'refuses ambiguous or unsafe amount %s',
    (value) => {
      expect(parseManualAmount(value, 2)).toBeNull();
    },
  );
  it('does not infer an absent scale or expose unknown state codes', () => {
    expect(parseManualAmount('10', null)).toBeNull();
    expect(manualStatusLabel('INTERNAL_DATABASE_CODE', 'en')).toBe(MANUAL_PAYMENT_COPY.en.unknown);
    expect(manualMethodLabel('unapproved-wallet', 'ar')).toBe(MANUAL_PAYMENT_COPY.ar.unknown);
  });
});
