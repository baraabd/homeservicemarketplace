import { describe, expect, it } from 'vitest';
import { normalizeDecimalDigits } from './normalize-decimal-digits';

describe('decimal digits from supported numeric keyboards', () => {
  it.each(['0123456789', '٠١٢٣٤٥٦٧٨٩', '۰۱۲۳۴۵۶۷۸۹', '٠۱2٣۴5٦۷8٩'])(
    'normalizes %s without dropping leading zeroes',
    (digits) => expect(normalizeDecimalDigits(digits)).toBe('0123456789'),
  );

  it('leaves non-digits intact for the caller’s phone or OTP validation', () => {
    expect(normalizeDecimalDigits('+٠٠١ (۲)-abc')).toBe('+001 (2)-abc');
    expect(normalizeDecimalDigits('')).toBe('');
  });
});
