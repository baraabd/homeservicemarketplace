import { ProviderPortfolioService } from './provider-portfolio.service';
import { portfolioOwnerRef } from './portfolio-policy';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { PlatformSettingRepository } from '../../../infrastructure/persistence/settings/platform-setting.repository';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { AppConfigService } from '../../../config/app-config.service';
import type { StoragePort, StoredObjectHead } from '../../../infrastructure/storage/storage.port';
import * as validation from '../../../infrastructure/storage/portfolio-image-validation';

function fixture() {
  const client = {
    providerProfile: { findFirst: jest.fn(async () => ({ id: 'profile' })) },
    providerPortfolioItem: { findFirst: jest.fn(async () => null) },
    mediaAsset: { findFirst: jest.fn(async (): Promise<{ id: string } | null> => null) },
  };
  const storage = { readObjectHead: jest.fn(async (): Promise<StoredObjectHead | null> => null) };
  const tx = { run: jest.fn() };
  const service = new ProviderPortfolioService(
    { client } as unknown as PrismaService,
    { findByKey: async () => null } as unknown as PlatformSettingRepository,
    tx as unknown as TransactionRunner,
    {
      get: (key: string) => (key === 'JWT_ACCESS_SECRET' ? 'portfolio-secret' : 'local'),
    } as unknown as AppConfigService,
    storage as unknown as StoragePort,
  );
  const input = {
    storageKey: `portfolio-staging/${portfolioOwnerRef('owner', 'portfolio-secret')}/image.jpg`,
    contentType: 'image/jpeg',
    sizeBytes: 1024,
    publicationRightAck: true as const,
  };
  return { client, storage, tx, service, input };
}

describe('portfolio attachment proves reservation ownership before reading bytes', () => {
  it('refuses an unissued or differently owned key without opening storage', async () => {
    const f = fixture();
    await expect(f.service.create('owner', f.input)).rejects.toMatchObject({
      status: 400,
      details: { reason: 'UPLOAD_NOT_RESERVED' },
    });
    expect(f.client.mediaAsset.findFirst).toHaveBeenCalledWith({
      where: {
        storageKey: f.input.storageKey,
        ownerUserId: 'owner',
        visibility: 'PUBLIC',
        uploadCompletedAt: null,
        deletedAt: null,
        retainUntil: null,
        erasureStartedAt: null,
        purpose: null,
        uploadExpiresAt: { gt: expect.any(Date) },
        declaredMimeType: 'image/jpeg',
        sizeBytes: 1024,
      },
      select: { id: true },
    });
    expect(f.storage.readObjectHead).not.toHaveBeenCalled();
    expect(f.tx.run).not.toHaveBeenCalled();
  });

  it('reports a missing image only after a valid caller-owned reservation was found', async () => {
    const f = fixture();
    f.client.mediaAsset.findFirst.mockResolvedValue({ id: 'asset' });
    await expect(f.service.create('owner', f.input)).rejects.toMatchObject({
      status: 400,
      details: { reason: 'INVALID_IMAGE' },
    });
    expect(f.storage.readObjectHead).toHaveBeenCalledWith(f.input.storageKey, expect.any(Number));
    expect(f.tx.run).not.toHaveBeenCalled();
  });
  it('does not blame a valid upload when the native decoder is unavailable', async () => {
    const f = fixture();
    f.client.mediaAsset.findFirst.mockResolvedValue({ id: 'asset' });
    f.storage.readObjectHead.mockResolvedValue({
      sizeBytes: 1024,
      head: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
    });
    const unavailable = jest
      .spyOn(validation, 'validateStoredPortfolioImage')
      .mockRejectedValueOnce(new validation.PortfolioImageDecoderUnavailableError());
    try {
      await expect(f.service.create('owner', f.input)).rejects.toMatchObject({
        status: 503,
        message: 'Portfolio image validation is temporarily unavailable.',
      });
      expect(f.tx.run).not.toHaveBeenCalled();
    } finally {
      unavailable.mockRestore();
    }
  });
});
