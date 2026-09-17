import { Injectable } from '@nestjs/common';
import type { BillingInterval, PaymentMethod } from '@homeservicemarketplace/contracts';

import { calculateQuote, MoneyDomainError, normalizeCurrency } from './money-domain';
import { calculateCouponDiscount, type CouponPolicy } from './money-policy';

export type PublishedPlanPrice = Readonly<{
  id: string;
  planId: string;
  billingInterval: BillingInterval;
  priceMinor: bigint;
  currency: string;
  publishedAt: Date;
  retiredAt: Date | null;
}>;

export type CouponRecord = CouponPolicy & Readonly<{
  id: string;
  code: string;
  maxRedemptions: number | null;
  maxRedemptionsPerProvider: number | null;
}>;

export interface MoneyCatalogPort {
  findPublishedPlanVersion(id: string): Promise<PublishedPlanPrice | null>;
  findCouponByCode(code: string): Promise<CouponRecord | null>;
  countCouponRedemptions(couponId: string): Promise<number>;
  countProviderCouponRedemptions(couponId: string, providerProfileId: string): Promise<number>;
}

export type ServerQuote = Readonly<{
  providerProfileId: string;
  planVersionId: string;
  paymentMethod: PaymentMethod;
  currency: string;
  subtotalMinor: bigint;
  discountMinor: bigint;
  totalMinor: bigint;
  couponId: string | null;
}>;

const PAYMENT_METHOD_SET = new Set<PaymentMethod>(['STRIPE', 'SHAM_CASH', 'SYRIATEL_CASH', 'CASH_OFFICE']);

@Injectable()
export class MoneyQuoteService {
  constructor(private readonly catalog: MoneyCatalogPort) {}

  async quote(input: {
    providerProfileId: string;
    planVersionId: string;
    paymentMethod: PaymentMethod;
    couponCode?: string;
    now?: Date;
  }): Promise<ServerQuote> {
    if (!input.providerProfileId.trim()) throw new MoneyDomainError('INVALID_PROVIDER', 'Provider profile is required');
    if (!PAYMENT_METHOD_SET.has(input.paymentMethod)) throw new MoneyDomainError('INVALID_PAYMENT_METHOD', 'Unsupported payment method');

    const plan = await this.catalog.findPublishedPlanVersion(input.planVersionId);
    if (!plan || !plan.publishedAt || plan.retiredAt) {
      throw new MoneyDomainError('PLAN_VERSION_UNAVAILABLE', 'Plan version is not available for purchase');
    }

    const currency = normalizeCurrency(plan.currency);
    let discountMinor = 0n;
    let couponId: string | null = null;
    const couponCode = input.couponCode?.trim().toUpperCase();
    if (couponCode) {
      const coupon = await this.catalog.findCouponByCode(couponCode);
      if (!coupon) throw new MoneyDomainError('COUPON_NOT_FOUND', 'Coupon was not found');
      await this.assertCouponCapacity(coupon, input.providerProfileId);
      discountMinor = calculateCouponDiscount({
        subtotalMinor: plan.priceMinor,
        currency,
        coupon,
        now: input.now ?? new Date(),
      });
      couponId = coupon.id;
    }

    const calculated = calculateQuote({ priceMinor: plan.priceMinor, currency, discountMinor });
    return Object.freeze({
      providerProfileId: input.providerProfileId,
      planVersionId: plan.id,
      paymentMethod: input.paymentMethod,
      ...calculated,
      couponId,
    });
  }

  private async assertCouponCapacity(coupon: CouponRecord, providerProfileId: string): Promise<void> {
    if (coupon.maxRedemptions !== null) {
      const total = await this.catalog.countCouponRedemptions(coupon.id);
      if (total >= coupon.maxRedemptions) throw new MoneyDomainError('COUPON_EXHAUSTED', 'Coupon redemption limit reached');
    }
    if (coupon.maxRedemptionsPerProvider !== null) {
      const providerTotal = await this.catalog.countProviderCouponRedemptions(coupon.id, providerProfileId);
      if (providerTotal >= coupon.maxRedemptionsPerProvider) {
        throw new MoneyDomainError('COUPON_PROVIDER_LIMIT', 'Coupon provider redemption limit reached');
      }
    }
  }
}
