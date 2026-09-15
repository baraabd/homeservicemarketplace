import { AdminPortfolioService } from './admin-portfolio.service';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { AppConfigService } from '../../../config/app-config.service';
import type { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';

function fixture() {
  let row = {
    id: 'item',
    title: 'Kitchen',
    description: null,
    serviceCategoryId: null,
    position: 0,
    moderationState: 'PENDING',
    moderationReason: null,
    moderatedAt: null,
    revision: 4,
    createdAt: new Date('2026-09-01'),
    updatedAt: new Date('2026-09-01'),
    publicationRightAckAt: new Date('2026-09-01'),
    providerProfile: { userId: 'owner' },
    mediaAsset: {
      storageKey: 'portfolio-staging/ref/image.jpg',
      declaredMimeType: 'image/jpeg',
      visibility: 'PUBLIC',
      deletedAt: null,
    },
  };
  const client = {
    providerProfile: { findFirst: jest.fn(async () => ({ id: 'profile' })) },
    providerPortfolioItem: {
      findMany: jest.fn(async () => [row]),
      findFirst: jest.fn(async () => row),
      findUniqueOrThrow: jest.fn(async () => row),
      updateMany: jest.fn(async ({ data }) => {
        row = { ...row, ...data, revision: row.revision + 1 };
        return { count: 1 };
      }),
    },
    auditEvent: { create: jest.fn(async () => ({})), findMany: jest.fn(async () => []) },
  };
  const permissions = {
    resolveFreshForUser: jest.fn(async () => new Set(['portfolio:read', 'portfolio:review'])),
  };
  const service = new AdminPortfolioService(
    { client } as unknown as PrismaService,
    { run: async (fn: (tx: unknown) => unknown) => fn(client) } as unknown as TransactionRunner,
    { get: () => 's3' } as unknown as AppConfigService,
    permissions as unknown as PermissionResolverService,
  );
  return { service, client, permissions, row };
}

describe('Admin portfolio revision decisions', () => {
  it('publishes one reviewed revision and records the decision in the same transaction', async () => {
    const f = fixture();
    const result = await f.service.review('reviewer', 'profile', 'item', {
      action: 'APPROVE',
      expectedRevision: 4,
    });
    expect(result).toMatchObject({
      moderationState: 'APPROVED',
      revision: 5,
      availableActions: ['REJECT'],
    });
    expect(f.client.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'reviewer',
          type: 'ADMIN_PORTFOLIO_APPROVED',
          metadata: expect.objectContaining({ previousRevision: 4, revision: 5 }),
        }),
      }),
    );
    expect(JSON.stringify(result)).not.toContain('portfolio-staging/');
    expect(JSON.stringify(result)).not.toContain('owner');
  });
  it('refuses a stale tab before a decision or audit write', async () => {
    const f = fixture();
    await expect(
      f.service.review('reviewer', 'profile', 'item', { action: 'APPROVE', expectedRevision: 3 }),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.client.providerPortfolioItem.updateMany).not.toHaveBeenCalled();
    expect(f.client.auditEvent.create).not.toHaveBeenCalled();
  });
  it('refuses self-review even when the owner is an administrator', async () => {
    const f = fixture();
    await expect(
      f.service.review('owner', 'profile', 'item', { action: 'APPROVE', expectedRevision: 4 }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await f.service.list('owner', 'profile')).items[0].availableActions).toEqual([]);
  });
  it('requires a provider-visible explanation for rejection', async () => {
    const f = fixture();
    await expect(
      f.service.review('reviewer', 'profile', 'item', {
        action: 'REJECT',
        expectedRevision: 4,
        reason: '   ',
      }),
    ).rejects.toMatchObject({ status: 400 });
    const result = await f.service.review('reviewer', 'profile', 'item', {
      action: 'REJECT',
      expectedRevision: 4,
      reason: ' Remove the customer address. ',
    });
    expect(result.moderationReason).toBe('Remove the customer address.');
  });
  it('honors freshly revoked reviewer permission', async () => {
    const f = fixture();
    f.permissions.resolveFreshForUser.mockResolvedValue(new Set(['portfolio:read']));
    await expect(
      f.service.review('reviewer', 'profile', 'item', { action: 'APPROVE', expectedRevision: 4 }),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.client.providerPortfolioItem.findFirst).not.toHaveBeenCalled();
  });
  it('blocks legacy public S3 objects until their bytes have moved', async () => {
    const f = fixture();
    f.row.mediaAsset.storageKey = 'portfolio/ref/old.jpg';
    expect((await f.service.list('reviewer', 'profile')).items[0]).toMatchObject({
      reviewBlockedReason: 'MEDIA_MIGRATION_REQUIRED',
      availableActions: [],
    });
    await expect(
      f.service.review('reviewer', 'profile', 'item', {
        action: 'REJECT',
        expectedRevision: 4,
        reason: 'Remove it',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('does not succeed if durable audit persistence fails', async () => {
    const f = fixture();
    f.client.auditEvent.create.mockRejectedValueOnce(new Error('unavailable'));
    await expect(
      f.service.review('reviewer', 'profile', 'item', { action: 'APPROVE', expectedRevision: 4 }),
    ).rejects.toThrow('unavailable');
    expect(f.client.providerPortfolioItem.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
