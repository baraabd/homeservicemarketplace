import { describe, it, expect } from 'vitest';

import { formatOffer } from '../../app/components/provider/bookings/booking-copy';
import { bidPriceError } from './bid-price';
import { formatAmount } from './format-amount';

// K02 — every role formats bid/booking amounts through formatAmount. Compare
// against the live ICU, never a hard-coded localized string (Node and
// Chromium disagree on some Arabic forms; see env_icu_ar_locale_split).
const NBSP = /\u00a0/g;
const plain = (s: string) => s.replace(NBSP, ' ').replace(/[\u200e\u200f\u061c]/g, '');

describe('K02 formatAmount', () => {
  it('acceptance: 10025 halalas at scale 2 reads as exactly 100.25 SAR', () => {
    expect(plain(formatAmount(10025, 'SAR', 2, 'en'))).toBe('SAR 100.25');
    const ar = formatAmount(10025, 'SAR', 2, 'ar');
    // Arabic-Indic digits with the Arabic decimal separator, code SAR.
    expect(ar).toContain('١٠٠٫٢٥');
    expect(ar).toContain('SAR');
  });

  it('never divides a legacy amount and labels it unverified', () => {
    expect(plain(formatAmount(1000, 'USD', null, 'en'))).toBe(
      '1,000 USD · unverified legacy amount',
    );
    expect(formatAmount(1000, 'USD', null, 'ar')).toContain('غير مؤكدة');
    expect(formatAmount(1000, 'USD', null, 'en')).not.toMatch(/\$|10\.00/);
  });

  it('formats from an exact decimal string — no float rounding at any size', () => {
    expect(plain(formatAmount(29, 'SAR', 2, 'en'))).toBe('SAR 0.29');
    expect(plain(formatAmount(115, 'SAR', 2, 'en'))).toBe('SAR 1.15');
    expect(plain(formatAmount(100_000_000, 'SAR', 2, 'en'))).toBe('SAR 1,000,000.00');
    expect(plain(formatAmount(0, 'SAR', 2, 'en'))).toBe('SAR 0.00');
  });

  it('formats each record in its own currency (no shared currency state)', () => {
    expect(plain(formatAmount(500, 'SAR', 2, 'en'))).toBe('SAR 5.00');
    expect(plain(formatAmount(500, 'USD', null, 'en'))).toBe('500 USD · unverified legacy amount');
  });

  it('offers carry their basis: fixed price vs hourly rate', () => {
    expect(formatOffer(10025, 'SAR', 2, 'FIXED', 'en')).toEqual({
      value: formatAmount(10025, 'SAR', 2, 'en'),
      basis: 'fixed price',
    });
    expect(formatOffer(15000, 'SAR', 2, 'HOURLY', 'ar').basis).toBe('للساعة');
  });
});

describe('K02 bid form validation mirrors the server rule', () => {
  it('accepts exact SAR decimals, including Arabic-Indic digits', () => {
    for (const ok of ['100.25', '0.01', '7', '1000000', '١٠٠٫٢٥'])
      expect(bidPriceError(ok)).toBeNull();
  });
  it('refuses lossy, ambiguous and out-of-range input', () => {
    expect(bidPriceError('100.255')).toBe('TOO_MANY_FRACTION_DIGITS');
    expect(bidPriceError('1,000')).toBe('INVALID_DECIMAL');
    expect(bidPriceError('1e3')).toBe('INVALID_DECIMAL');
    expect(bidPriceError('0')).toBe('AMOUNT_OUT_OF_RANGE');
    expect(bidPriceError('1000000.01')).toBe('AMOUNT_OUT_OF_RANGE');
  });
});
