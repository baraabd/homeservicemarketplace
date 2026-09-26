import type { LedgerEntryContract } from '@homeservicemarketplace/contracts';
import { assertBalancedLedger, calculateQuote, MoneyDomainError, nextSubscriptionEnd, normalizeCurrency } from './money-domain';
import { assertPaymentTransition, assertSubscriptionTransition, calculateCouponDiscount, type CouponPolicy } from './money-policy';

const entries = (amount = 10n): LedgerEntryContract[] => [
  { accountId: 'receivable', side: 'DEBIT', amountMinor: amount, currency: 'USD' },
  { accountId: 'revenue', side: 'CREDIT', amountMinor: amount, currency: 'USD' },
];
const coupon: CouponPolicy = { kind: 'PERCENTAGE', value: 1000n, currency: null, startsAt: null, endsAt: null, active: true };
const now = new Date('2026-01-01T00:00:00Z');

describe('S10 runtime financial boundaries before persistence', () => {
  it.each([1, 0, 1.25, Number.NaN, Number.POSITIVE_INFINITY, '100', null, undefined])('rejects non-bigint money %p rather than trusting TypeScript erasure', (amount) => {
    expect(() => calculateQuote({ priceMinor: amount as unknown as bigint, currency: 'USD' })).toThrow(MoneyDomainError);
    const values = entries();
    for (const entry of values) entry.amountMinor = amount as unknown as bigint;
    expect(() => assertBalancedLedger(values)).toThrow(MoneyDomainError);
  });
  it.each(['UNKNOWN', 'credit', '', 'toString'])('never treats an unknown ledger side %p as CREDIT', (side) => {
    const values = entries(); values[1].side = side as LedgerEntryContract['side'];
    expect(() => assertBalancedLedger(values)).toThrow('Ledger side must be DEBIT or CREDIT');
  });
  it.each(['', '  ', null, 5])('rejects an absent runtime account identity %p', (accountId) => {
    const values = entries(); values[0].accountId = accountId as string;
    expect(() => assertBalancedLedger(values)).toThrow('account identity');
  });
  it('rejects malformed currency, billing interval and coupon kind/value', () => {
    expect(() => normalizeCurrency(null as unknown as string)).toThrow(MoneyDomainError);
    expect(() => nextSubscriptionEnd(now, 'WEEKLY' as never)).toThrow('MONTHLY or ANNUAL');
    expect(() => calculateCouponDiscount({ subtotalMinor: 100n, currency: 'USD', now, coupon: { ...coupon, kind: 'OTHER' as never } })).toThrow('FIXED or PERCENTAGE');
    expect(() => calculateCouponDiscount({ subtotalMinor: 100n, currency: 'USD', now, coupon: { ...coupon, value: 1000 as unknown as bigint } })).toThrow('integer bigint');
  });
  it.each(['UNKNOWN', '', 'toString', '__proto__'])('rejects unknown-state self-transitions instead of accepting an idempotent-looking noop: %p', (state) => {
    expect(() => assertPaymentTransition(state, state)).toThrow(MoneyDomainError);
    expect(() => assertSubscriptionTransition(state, state)).toThrow(MoneyDomainError);
  });
  it('preserves recognized-state idempotent noops and terminal-state restrictions', () => {
    expect(() => assertPaymentTransition('SUCCEEDED', 'SUCCEEDED')).not.toThrow();
    expect(() => assertSubscriptionTransition('ACTIVE', 'ACTIVE')).not.toThrow();
    expect(() => assertPaymentTransition('SUCCEEDED', 'PROCESSING')).toThrow(MoneyDomainError);
    expect(() => assertSubscriptionTransition('CANCELLED', 'ACTIVE')).toThrow(MoneyDomainError);
  });
  it('keeps exact balance for 5000 deterministic values beyond floating-point integer precision', () => {
    let state = 0x5a10;
    for (let i = 0; i < 5000; i += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const amount = BigInt(Number.MAX_SAFE_INTEGER) + 1n + BigInt(state);
      expect(() => assertBalancedLedger(entries(amount))).not.toThrow();
      const unbalanced = entries(amount); unbalanced[1].amountMinor -= 1n;
      expect(() => assertBalancedLedger(unbalanced)).toThrow('must balance');
      expect(calculateQuote({ priceMinor: amount, discountMinor: 1n, currency: 'usd' }).totalMinor).toBe(amount - 1n);
    }
  });
});
