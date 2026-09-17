import { MoneyQuoteService, type CouponRecord, type MoneyCatalogPort, type PublishedPlanPrice } from './money-application';

describe('MoneyQuoteService', () => {
  const plan: PublishedPlanPrice = {
    id: 'pv_1', planId: 'plan_vip', billingInterval: 'MONTHLY', priceMinor: 1000n,
    currency: 'usd', publishedAt: new Date('2026-01-01T00:00:00Z'), retiredAt: null,
  };
  const coupon: CouponRecord = {
    id: 'coupon_1', code: 'SAVE10', kind: 'PERCENTAGE', value: 1000n, currency: null,
    startsAt: null, endsAt: null, active: true, maxRedemptions: 100, maxRedemptionsPerProvider: 1,
  };

  function catalog(overrides: Partial<MoneyCatalogPort> = {}): MoneyCatalogPort {
    return {
      findPublishedPlanVersion: jest.fn().mockResolvedValue(plan),
      findCouponByCode: jest.fn().mockResolvedValue(coupon),
      countCouponRedemptions: jest.fn().mockResolvedValue(0),
      countProviderCouponRedemptions: jest.fn().mockResolvedValue(0),
      ...overrides,
    };
  }

  it('derives price and currency exclusively from the published server plan', async () => {
    const service = new MoneyQuoteService(catalog());
    await expect(service.quote({ providerProfileId: 'provider_1', planVersionId: 'pv_1', paymentMethod: 'STRIPE' }))
      .resolves.toMatchObject({ subtotalMinor: 1000n, discountMinor: 0n, totalMinor: 1000n, currency: 'USD' });
  });

  it('normalizes coupon input and applies integer discount policy', async () => {
    const repo = catalog();
    const service = new MoneyQuoteService(repo);
    await expect(service.quote({ providerProfileId: 'provider_1', planVersionId: 'pv_1', paymentMethod: 'SHAM_CASH', couponCode: ' save10 ' }))
      .resolves.toMatchObject({ discountMinor: 100n, totalMinor: 900n, couponId: 'coupon_1' });
    expect(repo.findCouponByCode).toHaveBeenCalledWith('SAVE10');
  });

  it('fails closed for missing or retired plan versions', async () => {
    await expect(new MoneyQuoteService(catalog({ findPublishedPlanVersion: jest.fn().mockResolvedValue(null) }))
      .quote({ providerProfileId: 'p', planVersionId: 'missing', paymentMethod: 'STRIPE' })).rejects.toMatchObject({ code: 'PLAN_VERSION_UNAVAILABLE' });
    await expect(new MoneyQuoteService(catalog({ findPublishedPlanVersion: jest.fn().mockResolvedValue({ ...plan, retiredAt: new Date() }) }))
      .quote({ providerProfileId: 'p', planVersionId: 'pv_1', paymentMethod: 'STRIPE' })).rejects.toMatchObject({ code: 'PLAN_VERSION_UNAVAILABLE' });
  });

  it('enforces global and per-provider coupon redemption ceilings', async () => {
    await expect(new MoneyQuoteService(catalog({ countCouponRedemptions: jest.fn().mockResolvedValue(100) }))
      .quote({ providerProfileId: 'p', planVersionId: 'pv_1', paymentMethod: 'STRIPE', couponCode: 'SAVE10' }))
      .rejects.toMatchObject({ code: 'COUPON_EXHAUSTED' });
    await expect(new MoneyQuoteService(catalog({ countProviderCouponRedemptions: jest.fn().mockResolvedValue(1) }))
      .quote({ providerProfileId: 'p', planVersionId: 'pv_1', paymentMethod: 'STRIPE', couponCode: 'SAVE10' }))
      .rejects.toMatchObject({ code: 'COUPON_PROVIDER_LIMIT' });
  });

  it('rejects blank provider identity and unsupported runtime payment methods', async () => {
    const service = new MoneyQuoteService(catalog());
    await expect(service.quote({ providerProfileId: ' ', planVersionId: 'pv_1', paymentMethod: 'STRIPE' })).rejects.toMatchObject({ code: 'INVALID_PROVIDER' });
    await expect(service.quote({ providerProfileId: 'p', planVersionId: 'pv_1', paymentMethod: 'BITCOIN' as never })).rejects.toMatchObject({ code: 'INVALID_PAYMENT_METHOD' });
  });
});
