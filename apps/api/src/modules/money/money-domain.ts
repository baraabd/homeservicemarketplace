import type { EntitlementDecision, LedgerEntryContract } from '@homeservicemarketplace/contracts';

export class MoneyDomainError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export function normalizeCurrency(currency: string): string {
  const value = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) throw new MoneyDomainError('INVALID_CURRENCY', 'Currency must be a three-letter ISO code');
  return value;
}

export function assertMinorAmount(amountMinor: bigint): void {
  if (amountMinor < 0n) throw new MoneyDomainError('INVALID_AMOUNT', 'Money amount cannot be negative');
}

export function calculateQuote(input: { priceMinor: bigint; currency: string; discountMinor?: bigint }) {
  assertMinorAmount(input.priceMinor);
  const discountMinor = input.discountMinor ?? 0n;
  assertMinorAmount(discountMinor);
  if (discountMinor > input.priceMinor) throw new MoneyDomainError('DISCOUNT_EXCEEDS_SUBTOTAL', 'Discount cannot exceed subtotal');
  return Object.freeze({ currency: normalizeCurrency(input.currency), subtotalMinor: input.priceMinor, discountMinor, totalMinor: input.priceMinor - discountMinor });
}

export function assertBalancedLedger(entries: readonly LedgerEntryContract[]): void {
  if (entries.length < 2) throw new MoneyDomainError('LEDGER_TOO_SMALL', 'A transaction requires at least two entries');
  const currencies = new Set(entries.map((entry) => normalizeCurrency(entry.currency)));
  if (currencies.size !== 1) throw new MoneyDomainError('MIXED_CURRENCY_LEDGER', 'A ledger transaction cannot mix currencies');
  let debits = 0n;
  let credits = 0n;
  for (const entry of entries) {
    if (entry.amountMinor <= 0n) throw new MoneyDomainError('INVALID_LEDGER_AMOUNT', 'Ledger entries must be positive');
    if (entry.side === 'DEBIT') debits += entry.amountMinor;
    else credits += entry.amountMinor;
  }
  if (debits !== credits) throw new MoneyDomainError('UNBALANCED_LEDGER', 'Ledger debits and credits must balance');
}

export function decideEntitlement(input: { key: string; active: boolean; enabled: boolean; limit: number | null; used: number }): EntitlementDecision {
  if (!Number.isSafeInteger(input.used) || input.used < 0 || (input.limit !== null && (!Number.isSafeInteger(input.limit) || input.limit < 0))) {
    throw new MoneyDomainError('INVALID_USAGE', 'Entitlement usage and limit must be non-negative safe integers');
  }
  if (!input.active) return { allowed: false, key: input.key, limit: input.limit, used: input.used, remaining: null, reason: 'NO_ACTIVE_SUBSCRIPTION' };
  if (!input.enabled) return { allowed: false, key: input.key, limit: input.limit, used: input.used, remaining: null, reason: 'NOT_INCLUDED' };
  if (input.limit === null) return { allowed: true, key: input.key, limit: null, used: input.used, remaining: null };
  const remaining = Math.max(0, input.limit - input.used);
  return input.used < input.limit ? { allowed: true, key: input.key, limit: input.limit, used: input.used, remaining } : { allowed: false, key: input.key, limit: input.limit, used: input.used, remaining: 0, reason: 'LIMIT_REACHED' };
}

export function nextSubscriptionEnd(start: Date, interval: 'MONTHLY' | 'ANNUAL'): Date {
  if (!Number.isFinite(start.getTime())) throw new MoneyDomainError('INVALID_DATE', 'Subscription start date must be valid');
  const end = new Date(start.getTime());
  const originalDay = end.getUTCDate();
  end.setUTCDate(1);
  if (interval === 'MONTHLY') end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCFullYear(end.getUTCFullYear() + 1);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(originalDay, lastDay));
  return end;
}
