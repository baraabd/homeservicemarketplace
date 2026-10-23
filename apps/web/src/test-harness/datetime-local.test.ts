import { describe, expect, it } from 'vitest';
import { utcDatetimeLocal } from '../../e2e/datetime-local';

describe('manual settlement UTC datetime-local input', () => {
  it('preserves nonzero seconds after a recently created payment intent', () => {
    const intentCreatedAt = new Date('2026-10-23T23:45:14.900Z');
    const depositedAt = new Date('2026-10-23T23:45:27.400Z');
    const value = utcDatetimeLocal(depositedAt);
    expect(value).toBe('2026-10-23T23:45:27');
    expect(new Date(`${value}.000Z`).getTime()).toBeGreaterThan(intentCreatedAt.getTime());
  });

  it('uses the browser canonical minute form only when seconds are zero', () => {
    expect(utcDatetimeLocal(new Date('2026-10-23T23:45:00.900Z'))).toBe('2026-10-23T23:45');
  });

  it('preserves UTC across timezone and date boundaries', () => {
    expect(utcDatetimeLocal(new Date('2026-10-24T02:59:59.900+03:00'))).toBe('2026-10-23T23:59:59');
  });

  it('rejects invalid dates instead of fabricating a settlement time', () => {
    expect(() => utcDatetimeLocal(new Date(NaN))).toThrow(RangeError);
  });
});
