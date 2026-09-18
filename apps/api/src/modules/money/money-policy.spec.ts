import { calculateCouponDiscount, assertPaymentTransition, assertSubscriptionTransition } from './money-policy';

describe('money policy', () => {
  const now = new Date('2026-09-18T00:00:00Z');

  it('calculates percentage discounts in integer basis points', () => {
    expect(calculateCouponDiscount({ subtotalMinor: 999n, currency: 'USD', now, coupon: { kind: 'PERCENTAGE', value: 1500n, currency: null, startsAt: null, endsAt: null, active: true } })).toBe(149n);
  });

  it('caps fixed discounts at subtotal and normalizes currency', () => {
    expect(calculateCouponDiscount({ subtotalMinor: 500n, currency: 'usd', now, coupon: { kind: 'FIXED', value: 800n, currency: ' USD ', startsAt: null, endsAt: null, active: true } })).toBe(500n);
    expect(() => calculateCouponDiscount({ subtotalMinor: 500n, currency: 'USD', now, coupon: { kind: 'FIXED', value: 100n, currency: 'EUR', startsAt: null, endsAt: null, active: true } })).toThrow('does not match');
  });

  it('rejects zero, negative and malformed coupon values', () => {
    expect(() => calculateCouponDiscount({ subtotalMinor: 500n, currency: 'USD', now, coupon: { kind: 'FIXED', value: 0n, currency: 'USD', startsAt: null, endsAt: null, active: true } })).toThrow('must be positive');
    expect(() => calculateCouponDiscount({ subtotalMinor: 500n, currency: 'USD', now, coupon: { kind: 'PERCENTAGE', value: -1n, currency: null, startsAt: null, endsAt: null, active: true } })).toThrow('must be positive');
    expect(() => calculateCouponDiscount({ subtotalMinor: 500n, currency: 'USD', now, coupon: { kind: 'PERCENTAGE', value: 10001n, currency: null, startsAt: null, endsAt: null, active: true } })).toThrow('basis points');
  });

  it('fails closed for inactive, future and expired coupons', () => {
    expect(() => calculateCouponDiscount({ subtotalMinor: 500n, currency: 'USD', now, coupon: { kind: 'PERCENTAGE', value: 1000n, currency: null, startsAt: null, endsAt: null, active: false } })).toThrow('inactive');
    expect(() => calculateCouponDiscount({ subtotalMinor: 500n, currency: 'USD', now, coupon: { kind: 'PERCENTAGE', value: 1000n, currency: null, startsAt: new Date('2026-09-19T00:00:00Z'), endsAt: null, active: true } })).toThrow('not active yet');
    expect(() => calculateCouponDiscount({ subtotalMinor: 500n, currency: 'USD', now, coupon: { kind: 'PERCENTAGE', value: 1000n, currency: null, startsAt: null, endsAt: now, active: true } })).toThrow('expired');
  });

  it('rejects malformed coupon windows and evaluation dates', () => {
    expect(() => calculateCouponDiscount({ subtotalMinor: 500n, currency: 'USD', now: new Date('invalid'), coupon: { kind: 'PERCENTAGE', value: 1000n, currency: null, startsAt: null, endsAt: null, active: true } })).toThrow('evaluation time');
    expect(() => calculateCouponDiscount({ subtotalMinor: 500n, currency: 'USD', now, coupon: { kind: 'PERCENTAGE', value: 1000n, currency: null, startsAt: now, endsAt: new Date('2026-09-17T00:00:00Z'), active: true } })).toThrow('after start date');
  });

  it('allows only explicit payment state transitions', () => {
    expect(() => assertPaymentTransition('PROCESSING', 'SUCCEEDED')).not.toThrow();
    expect(() => assertPaymentTransition('SUCCEEDED', 'PROCESSING')).toThrow('cannot transition');
    expect(() => assertPaymentTransition('UNKNOWN', 'SUCCEEDED')).toThrow('cannot transition');
  });

  it('allows suspension recovery but not resurrection after expiry', () => {
    expect(() => assertSubscriptionTransition('SUSPENDED', 'ACTIVE')).not.toThrow();
    expect(() => assertSubscriptionTransition('EXPIRED', 'ACTIVE')).toThrow('cannot transition');
    expect(() => assertSubscriptionTransition('UNKNOWN', 'ACTIVE')).toThrow('cannot transition');
  });
});
