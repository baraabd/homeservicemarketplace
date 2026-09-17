import { MoneyDomainError, assertMinorAmount } from './money-domain';

export type CouponPolicy = Readonly<{
  kind: 'PERCENTAGE' | 'FIXED';
  value: bigint;
  currency: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
}>;

export function calculateCouponDiscount(input: { subtotalMinor: bigint; currency: string; coupon: CouponPolicy; now: Date }): bigint {
  assertMinorAmount(input.subtotalMinor);
  const { coupon } = input;
  if (!coupon.active) throw new MoneyDomainError('COUPON_INACTIVE', 'Coupon is inactive');
  if (coupon.startsAt && input.now < coupon.startsAt) throw new MoneyDomainError('COUPON_NOT_STARTED', 'Coupon is not active yet');
  if (coupon.endsAt && input.now >= coupon.endsAt) throw new MoneyDomainError('COUPON_EXPIRED', 'Coupon has expired');
  if (coupon.kind === 'FIXED') {
    if (coupon.currency !== input.currency) throw new MoneyDomainError('COUPON_CURRENCY_MISMATCH', 'Coupon currency does not match quote currency');
    return coupon.value > input.subtotalMinor ? input.subtotalMinor : coupon.value;
  }
  if (coupon.value <= 0n || coupon.value > 10000n) throw new MoneyDomainError('INVALID_PERCENTAGE', 'Percentage coupon must be between 1 and 10000 basis points');
  return (input.subtotalMinor * coupon.value) / 10000n;
}

const PAYMENT_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  CREATED: ['AWAITING_PAYMENT', 'PROCESSING', 'CANCELLED', 'EXPIRED'],
  AWAITING_PAYMENT: ['PROCESSING', 'CANCELLED', 'EXPIRED'],
  PROCESSING: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: [], FAILED: [], CANCELLED: [], EXPIRED: [],
};

export function assertPaymentTransition(from: string, to: string): void {
  if (from === to) return;
  if (!PAYMENT_TRANSITIONS[from]?.includes(to)) throw new MoneyDomainError('INVALID_PAYMENT_TRANSITION', `Payment intent cannot transition from ${from} to ${to}`);
}

const SUBSCRIPTION_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  PENDING_PAYMENT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['EXPIRED', 'SUSPENDED', 'CANCELLED'],
  SUSPENDED: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
  EXPIRED: [], CANCELLED: [],
};

export function assertSubscriptionTransition(from: string, to: string): void {
  if (from === to) return;
  if (!SUBSCRIPTION_TRANSITIONS[from]?.includes(to)) throw new MoneyDomainError('INVALID_SUBSCRIPTION_TRANSITION', `Subscription cannot transition from ${from} to ${to}`);
}
