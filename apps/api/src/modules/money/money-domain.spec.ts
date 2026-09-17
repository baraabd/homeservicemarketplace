import { assertBalancedLedger, calculateQuote, decideEntitlement, MoneyDomainError, nextSubscriptionEnd, normalizeCurrency } from './money-domain';

describe('money domain', () => {
  it('keeps arithmetic in integer minor units', () => {
    expect(calculateQuote({ priceMinor: 1001n, currency: 'usd', discountMinor: 101n })).toEqual({ currency: 'USD', subtotalMinor: 1001n, discountMinor: 101n, totalMinor: 900n });
  });

  it('rejects negative and over-discounted money', () => {
    expect(() => calculateQuote({ priceMinor: -1n, currency: 'USD' })).toThrow(MoneyDomainError);
    expect(() => calculateQuote({ priceMinor: 100n, currency: 'USD', discountMinor: 101n })).toThrow('Discount cannot exceed subtotal');
  });

  it('normalizes and validates currency', () => {
    expect(normalizeCurrency(' sek ')).toBe('SEK');
    expect(() => normalizeCurrency('US')).toThrow('three-letter ISO code');
  });

  it('accepts balanced double entry and rejects imbalance', () => {
    expect(() => assertBalancedLedger([
      { accountId: 'cash', side: 'DEBIT', amountMinor: 1000n, currency: 'USD' },
      { accountId: 'revenue', side: 'CREDIT', amountMinor: 1000n, currency: 'USD' },
    ])).not.toThrow();
    expect(() => assertBalancedLedger([
      { accountId: 'cash', side: 'DEBIT', amountMinor: 1000n, currency: 'USD' },
      { accountId: 'revenue', side: 'CREDIT', amountMinor: 999n, currency: 'USD' },
    ])).toThrow('must balance');
  });

  it('rejects mixed currencies and zero-value ledger entries', () => {
    expect(() => assertBalancedLedger([
      { accountId: 'a', side: 'DEBIT', amountMinor: 1n, currency: 'USD' },
      { accountId: 'b', side: 'CREDIT', amountMinor: 1n, currency: 'EUR' },
    ])).toThrow('cannot mix currencies');
    expect(() => assertBalancedLedger([
      { accountId: 'a', side: 'DEBIT', amountMinor: 0n, currency: 'USD' },
      { accountId: 'b', side: 'CREDIT', amountMinor: 0n, currency: 'USD' },
    ])).toThrow('must be positive');
  });

  it('fails closed without active subscription', () => {
    expect(decideEntitlement({ key: 'requests.accept', active: false, enabled: true, limit: null, used: 0 })).toMatchObject({ allowed: false, reason: 'NO_ACTIVE_SUBSCRIPTION' });
  });

  it('enforces finite and unlimited entitlements', () => {
    expect(decideEntitlement({ key: 'requests.accept', active: true, enabled: true, limit: 5, used: 4 })).toMatchObject({ allowed: true, remaining: 1 });
    expect(decideEntitlement({ key: 'requests.accept', active: true, enabled: true, limit: 5, used: 5 })).toMatchObject({ allowed: false, remaining: 0, reason: 'LIMIT_REACHED' });
    expect(decideEntitlement({ key: 'requests.accept', active: true, enabled: true, limit: null, used: 999 })).toMatchObject({ allowed: true, limit: null });
  });

  it('rejects invalid usage before any entitlement branch can grant or deny', () => {
    expect(() => decideEntitlement({ key: 'requests.accept', active: false, enabled: true, limit: null, used: -1 })).toThrow('non-negative safe integers');
    expect(() => decideEntitlement({ key: 'requests.accept', active: true, enabled: true, limit: null, used: Number.MAX_SAFE_INTEGER + 1 })).toThrow('non-negative safe integers');
    expect(() => decideEntitlement({ key: 'requests.accept', active: true, enabled: false, limit: -1, used: 0 })).toThrow('non-negative safe integers');
  });

  it('uses calendar periods without overflowing end-of-month', () => {
    expect(nextSubscriptionEnd(new Date('2026-01-31T12:00:00Z'), 'MONTHLY').toISOString()).toBe('2026-02-28T12:00:00.000Z');
    expect(nextSubscriptionEnd(new Date('2024-02-29T12:00:00Z'), 'ANNUAL').toISOString()).toBe('2025-02-28T12:00:00.000Z');
  });

  it('rejects invalid subscription dates instead of propagating Invalid Date', () => {
    expect(() => nextSubscriptionEnd(new Date('not-a-date'), 'MONTHLY')).toThrow('Subscription start date must be valid');
  });
});
