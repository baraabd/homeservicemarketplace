import type { PrismaTx } from '@homeservicemarketplace/database';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { PlanVersionService } from '../subscriptions/plan-version.service';
import { EntitlementUsageService } from './entitlement-usage.service';

function fixture() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'subscription' }]),
    providerSubscription: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'subscription',
        providerProfileId: 'provider',
        planVersionId: 'plan',
        status: 'ACTIVE',
        planVersion: {
          entitlements: [{ key: 'listing.publish', value: { kind: 'LIMIT', limit: 1 } }],
        },
      }),
    },
    subscriptionPeriod: { findFirst: jest.fn().mockResolvedValue({ id: 'paid_period' }) },
    moneyEntitlementUsage: {
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'usage' }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
  };
  const owner = jest.fn().mockResolvedValue('provider');
  const run = jest.fn((operation: (arg: PrismaTx) => unknown) =>
    operation(tx as unknown as PrismaTx),
  );
  const service = new EntitlementUsageService(
    { run } as unknown as TransactionRunner,
    { owner } as unknown as PlanVersionService,
    { now: () => new Date('2030-01-01T00:00:00Z') },
  );
  return { service, tx, owner, run };
}
const input = {
  subscriptionId: 'subscription',
  entitlementKey: 'listing.publish',
  usageKey: 'listing:one',
};

describe('R31 consumption authority', () => {
  it('takes the owned row lock and writes usage in the supplied caller transaction', async () => {
    const h = fixture();
    await expect(
      h.service.consume('user', input, h.tx as unknown as PrismaTx),
    ).resolves.toMatchObject({ allowed: true, used: 1, replayed: false });
    expect(h.run).not.toHaveBeenCalled();
    expect(h.owner).toHaveBeenCalledWith('user', h.tx);
    expect(h.tx.$queryRaw).toHaveBeenCalled();
    expect(h.tx.moneyEntitlementUsage.create).toHaveBeenCalledWith({ data: input });
  });

  it('replays a prior operation at the limit without consuming another unit', async () => {
    const h = fixture();
    h.tx.moneyEntitlementUsage.findUnique.mockResolvedValue({ id: 'usage' });
    h.tx.moneyEntitlementUsage.count.mockResolvedValue(1);
    await expect(h.service.consume('user', input)).resolves.toMatchObject({
      allowed: true,
      used: 1,
      replayed: true,
    });
    expect(h.tx.moneyEntitlementUsage.create).not.toHaveBeenCalled();
  });

  it('does not treat an old usage receipt as an access grant after expiry', async () => {
    const h = fixture();
    h.tx.moneyEntitlementUsage.findUnique.mockResolvedValue({ id: 'usage' });
    h.tx.subscriptionPeriod.findFirst.mockResolvedValue(null);
    await expect(h.service.consume('user', input)).resolves.toMatchObject({
      allowed: false,
      replayed: true,
      reason: 'NO_ACTIVE_SUBSCRIPTION',
    });
  });

  it('denies an exhausted limit and foreign subscription without writing usage', async () => {
    const h = fixture();
    h.tx.moneyEntitlementUsage.count.mockResolvedValue(1);
    await expect(h.service.consume('user', input)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'LIMIT_REACHED' },
    });
    h.tx.$queryRaw.mockResolvedValue([]);
    await expect(h.service.consume('user', input)).rejects.toMatchObject({ status: 404 });
    expect(h.tx.moneyEntitlementUsage.create).not.toHaveBeenCalled();
  });

  it('rechecks capability revocation before any paid-state or usage read', async () => {
    const h = fixture();
    h.owner.mockRejectedValue(new Error('revoked'));
    await expect(h.service.consume('user', input)).rejects.toThrow('revoked');
    expect(h.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it.each(['', 'not a stable key', 'x'.repeat(201)])(
    'refuses invalid usage identities %j',
    (usageKey) => {
      const h = fixture();
      expect(() => h.service.consume('user', { ...input, usageKey })).toThrow(
        'Invalid entitlement usage identity',
      );
      expect(h.run).not.toHaveBeenCalled();
    },
  );
});
