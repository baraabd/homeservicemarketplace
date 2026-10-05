import { AdminPortfolioService } from './admin-portfolio.service';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { AppConfigService } from '../../../config/app-config.service';
import type { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';
import type { PortfolioMediaService } from '../../media/portfolio-media.service';
import { AppError } from '../../../shared/errors/app-error';

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
      uploadCompletedAt: new Date('2026-09-01'),
      retainUntil: null as Date | null,
      erasureStartedAt: null as Date | null,
      scanState: 'PENDING',
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
  const media = { assertAvailableForApproval: jest.fn(async () => undefined) };
  const tx = { run: jest.fn(async (fn: (tx: unknown) => unknown) => fn(client)) };
  const service = new AdminPortfolioService(
    { client } as unknown as PrismaService,
    tx as unknown as TransactionRunner,
    { get: () => 's3' } as unknown as AppConfigService,
    permissions as unknown as PermissionResolverService,
    media as unknown as PortfolioMediaService,
  );
  return { service, client, permissions, media, row, tx };
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
    expect(f.media.assertAvailableForApproval).not.toHaveBeenCalled();
  });
  it('refuses self-review even when the owner is an administrator', async () => {
    const f = fixture();
    await expect(
      f.service.review('owner', 'profile', 'item', { action: 'APPROVE', expectedRevision: 4 }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await f.service.list('owner', 'profile')).items[0].availableActions).toEqual([]);
    expect(f.media.assertAvailableForApproval).not.toHaveBeenCalled();
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
    expect(f.media.assertAvailableForApproval).not.toHaveBeenCalled();
  });
  it('retains the migration gate for unavailable legacy S3 bytes', async () => {
    const f = fixture();
    f.row.mediaAsset.storageKey = 'portfolio/ref/old.jpg';
    f.row.mediaAsset.retainUntil = new Date();
    expect((await f.service.list('reviewer', 'profile')).items[0]).toMatchObject({
      reviewBlockedReason: 'MEDIA_MIGRATION_REQUIRED',
      availableActions: [],
    });
    await expect(
      f.service.review('reviewer', 'profile', 'item', {
        action: 'APPROVE',
        expectedRevision: 4,
      }),
    ).rejects.toMatchObject({ status: 409, details: { reason: 'MEDIA_MIGRATION_REQUIRED' } });
    expect(f.media.assertAvailableForApproval).not.toHaveBeenCalled();
  });
  it('does not succeed if durable audit persistence fails', async () => {
    const f = fixture();
    f.client.auditEvent.create.mockRejectedValueOnce(new Error('unavailable'));
    await expect(
      f.service.review('reviewer', 'profile', 'item', { action: 'APPROVE', expectedRevision: 4 }),
    ).rejects.toThrow('unavailable');
    expect(f.client.providerPortfolioItem.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it('does not approve an image whose stored bytes are unavailable', async () => {
    const f = fixture();
    f.media.assertAvailableForApproval.mockRejectedValueOnce({
      status: 409,
      details: { reason: 'MEDIA_UNAVAILABLE' },
    });
    await expect(
      f.service.review('reviewer', 'profile', 'item', { action: 'APPROVE', expectedRevision: 4 }),
    ).rejects.toMatchObject({ status: 409, details: { reason: 'MEDIA_UNAVAILABLE' } });
    expect(f.client.providerPortfolioItem.updateMany).not.toHaveBeenCalled();
    expect(f.client.auditEvent.create).not.toHaveBeenCalled();
  });
  it('does not begin a decision transaction during a retryable storage failure', async () => {
    const f = fixture();
    f.media.assertAvailableForApproval.mockRejectedValueOnce(
      new AppError(
        'DEPENDENCY_UNAVAILABLE',
        'Portfolio image storage is temporarily unavailable. Please try again.',
        503,
      ),
    );
    await expect(
      f.service.review('reviewer', 'profile', 'item', { action: 'APPROVE', expectedRevision: 4 }),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', status: 503 });
    expect(f.tx.run).not.toHaveBeenCalled();
    expect(f.client.providerPortfolioItem.updateMany).not.toHaveBeenCalled();
    expect(f.client.auditEvent.create).not.toHaveBeenCalled();
    expect(f.row.moderationState).toBe('PENDING');
    expect(f.row.revision).toBe(4);
  });
  it('rechecks a provider edit that commits while approval bytes are inspected', async () => {
    const f = fixture();
    f.client.providerPortfolioItem.findFirst
      .mockResolvedValueOnce(f.row)
      .mockResolvedValueOnce({ ...f.row, revision: 5 });
    await expect(
      f.service.review('reviewer', 'profile', 'item', {
        action: 'APPROVE',
        expectedRevision: 4,
      }),
    ).rejects.toMatchObject({ status: 409, details: { reason: 'STALE_REVISION' } });
    expect(f.media.assertAvailableForApproval).toHaveBeenCalled();
    expect(f.client.providerPortfolioItem.updateMany).not.toHaveBeenCalled();
  });
  it('rechecks media retirement that commits while approval bytes are inspected', async () => {
    const f = fixture();
    f.client.providerPortfolioItem.findFirst.mockResolvedValueOnce(f.row).mockResolvedValueOnce({
      ...f.row,
      mediaAsset: { ...f.row.mediaAsset, retainUntil: new Date() },
    });
    await expect(
      f.service.review('reviewer', 'profile', 'item', {
        action: 'APPROVE',
        expectedRevision: 4,
      }),
    ).rejects.toMatchObject({ status: 409, details: { reason: 'MEDIA_UNAVAILABLE' } });
    expect(f.client.providerPortfolioItem.updateMany).not.toHaveBeenCalled();
    expect(f.client.auditEvent.create).not.toHaveBeenCalled();
  });
  it('rechecks revoked permission after media inspection, before committing approval', async () => {
    const f = fixture();
    f.permissions.resolveFreshForUser
      .mockResolvedValueOnce(new Set(['portfolio:read', 'portfolio:review']))
      .mockResolvedValueOnce(new Set(['portfolio:read']));
    await expect(
      f.service.review('reviewer', 'profile', 'item', {
        action: 'APPROVE',
        expectedRevision: 4,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.client.providerPortfolioItem.updateMany).not.toHaveBeenCalled();
  });
  it.each(['QUARANTINED', 'REJECTED', 'SCAN_FAILED'])(
    'blocks approval of %s media',
    async (scanState) => {
      const f = fixture();
      f.row.mediaAsset.scanState = scanState;
      expect((await f.service.list('reviewer', 'profile')).items[0]).toMatchObject({
        reviewBlockedReason: 'MEDIA_UNAVAILABLE',
        availableActions: ['REJECT'],
      });
      await expect(
        f.service.review('reviewer', 'profile', 'item', { action: 'APPROVE', expectedRevision: 4 }),
      ).rejects.toMatchObject({ status: 409, details: { reason: 'MEDIA_UNAVAILABLE' } });
      expect(f.client.providerPortfolioItem.updateMany).not.toHaveBeenCalled();
    },
  );
  it('can request a replacement by rejecting unavailable media without reopening its bytes', async () => {
    const f = fixture();
    f.row.mediaAsset.erasureStartedAt = new Date();
    const result = await f.service.review('reviewer', 'profile', 'item', {
      action: 'REJECT',
      expectedRevision: 4,
      reason: 'This upload is unavailable. Please replace this image.',
    });
    expect(result.moderationState).toBe('REJECTED');
    expect(result.availableActions).toEqual([]);
    expect(f.media.assertAvailableForApproval).not.toHaveBeenCalled();
  });
});
