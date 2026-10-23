import type { PrismaTx, SubscriptionPlanVersion } from '@homeservicemarketplace/database';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';
import {
  PlanVersionService,
  planVersionWire,
  type ApprovedPlanVersionInput,
} from './plan-version.service';

const now = new Date('2030-01-01T00:00:00.000Z');
const row: SubscriptionPlanVersion = {
  id: 'plan_one',
  planKey: 'test-plan',
  version: 1,
  billingInterval: 'MONTHLY',
  priceMinor: 9007199254740993n,
  currency: 'XTS',
  entitlements: [],
  publishedAt: now,
  retiredAt: null,
  createdAt: now,
};
function fixture() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'user' }) },
    providerProfile: { findFirst: jest.fn().mockResolvedValue({ id: 'provider' }) },
    subscriptionPlanVersion: {
      findMany: jest.fn().mockResolvedValue([row]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(row),
    },
  };
  const resolveFreshForUser = jest.fn().mockResolvedValue(new Set(['money:read:self']));
  const run = jest.fn((operation: (arg: PrismaTx) => unknown) =>
    operation(tx as unknown as PrismaTx),
  );
  const service = new PlanVersionService(
    { run } as unknown as TransactionRunner,
    { resolveFreshForUser } as unknown as PermissionResolverService,
    { now: () => now },
  );
  return { service, tx, run, resolveFreshForUser };
}

describe('R31 plan version authority', () => {
  it('preserves bigint amounts in the public wire without a guessed minor-unit scale', () => {
    expect(planVersionWire(row).price).toEqual({
      amountMinor: '9007199254740993',
      currency: 'XTS',
    });
  });

  it('lists only currently published nonretired plans with an owner-bound bounded cursor', async () => {
    const h = fixture();
    h.tx.subscriptionPlanVersion.findMany.mockResolvedValue([row, { ...row, id: 'plan_two' }]);
    const result = await h.service.listForUser('user', { limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).not.toBeNull();
    expect(h.tx.subscriptionPlanVersion.findMany).toHaveBeenCalledWith({
      where: { retiredAt: null, publishedAt: { lte: now } },
      orderBy: { id: 'asc' },
      take: 2,
    });
    h.tx.providerProfile.findFirst.mockResolvedValue({ id: 'other_provider' });
    await expect(
      h.service.listForUser('user', { cursor: result.nextCursor! }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('checks fresh money read permissions and the current provider account', async () => {
    const h = fixture();
    h.resolveFreshForUser.mockResolvedValue(new Set());
    await expect(h.service.listForUser('user')).rejects.toMatchObject({ status: 403 });
    expect(h.tx.subscriptionPlanVersion.findMany).not.toHaveBeenCalled();
    h.resolveFreshForUser.mockResolvedValue(new Set(['money:read:self']));
    h.tx.user.findFirst.mockResolvedValue(null);
    await expect(h.service.listForUser('user')).rejects.toMatchObject({ status: 403 });
  });

  it('requires explicit approved commercial input and never updates a purchased version', async () => {
    const h = fixture();
    const input: ApprovedPlanVersionInput = {
      planKey: 'test-plan',
      version: 2,
      billingInterval: 'MONTHLY',
      priceMinor: 99n,
      currency: 'XTS',
      entitlements: [],
      approvalReference: '',
    };
    await expect(
      h.service.publishApprovedVersion(input, h.tx as unknown as PrismaTx),
    ).rejects.toMatchObject({ status: 503 });
    input.approvalReference = 'test-only-commercial-policy';
    h.tx.subscriptionPlanVersion.findFirst.mockResolvedValue({ version: 2 });
    await expect(
      h.service.publishApprovedVersion(input, h.tx as unknown as PrismaTx),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.tx.subscriptionPlanVersion.create).not.toHaveBeenCalled();
    input.version = 3;
    await h.service.publishApprovedVersion(input, h.tx as unknown as PrismaTx);
    expect(h.tx.$executeRaw).toHaveBeenCalled();
    expect(h.tx.subscriptionPlanVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ version: 3, priceMinor: 99n }),
    });
  });

  it.each([0, 51, 1.5, NaN])('rejects invalid catalog page size %s before reading', (limit) => {
    expect(() => fixture().service.listForUser('user', { limit })).toThrow('Invalid page size');
  });
});
