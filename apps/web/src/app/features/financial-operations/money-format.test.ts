import { describe, expect, it } from 'vitest';
import type { MoneyWire } from '@homeservicemarketplace/contracts';
import { formatFinancialDate, formatMoneyMinor } from './money-format';

const money = (amountMinor: string, currency = 'USD') => ({ amountMinor, currency }) as MoneyWire;
describe('exact policy-neutral money formatting', () => {
  it('retains every bigint digit without inventing a two-decimal scale', () => {
    expect(formatMoneyMinor(money('9223372036854775807'), 'en')).toBe(
      '9,223,372,036,854,775,807 USD · minor units',
    );
    expect(formatMoneyMinor(money('9007199254740993'), 'en')).toContain('9,007,199,254,740,993');
  });
  it('rejects out-of-contract and unbounded integers without formatting or rounding', () => {
    for (const amount of ['9223372036854775808', '18446744073709551614', '9'.repeat(100_000)]) {
      expect(formatMoneyMinor(money(amount), 'en')).toBe('Amount unavailable');
    }
  });
  it('localizes Arabic digits and names the currency and actual stored unit', () => {
    expect(formatMoneyMinor(money('123456789', 'JPY'), 'ar')).toBe('١٢٣٬٤٥٦٬٧٨٩ JPY · وحدة صغرى');
  });
  it.each(['USD', 'EUR', 'JPY', 'BHD', 'XXX'])(
    'does not infer a scale or supported market for %s',
    (currency) => {
      expect(formatMoneyMinor(money('1234', currency), 'en')).toBe(
        '1,234 ' + currency + ' · minor units',
      );
    },
  );
  it('distinguishes unavailable from a proven zero', () => {
    expect(formatMoneyMinor(null, 'en')).toBe('Amount unavailable');
    expect(formatMoneyMinor(money('0'), 'en')).toBe('0 USD · minor units');
  });
  it.each(['-1', '1.5', '01', '1e5', ' 123', 'NaN', ''])(
    'rejects noncanonical %s without rounding',
    (amount) => {
      expect(formatMoneyMinor(money(amount), 'en')).toBe('Amount unavailable');
    },
  );
  it.each(['usd', '=CMD', 'U$D', 'US'])('refuses malformed currency %s', (currency) => {
    expect(formatMoneyMinor(money('100', currency), 'ar')).toBe('المبلغ غير متاح');
  });
  it('formats explicit UTC times and fails closed for invalid timestamps', () => {
    expect(formatFinancialDate('2026-10-23T04:11:34Z', 'en')).toContain('UTC');
    expect(formatFinancialDate(null, 'en')).toBe('—');
    expect(formatFinancialDate('not-a-date', 'ar')).toBe('—');
  });
});
