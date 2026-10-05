import { Readable } from 'node:stream';
import sharp from 'sharp';
import { ProviderPortfolioService } from './provider-portfolio.service';
import { portfolioOwnerRef } from './portfolio-policy';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { PlatformSettingRepository } from '../../../infrastructure/persistence/settings/platform-setting.repository';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { AppConfigService } from '../../../config/app-config.service';
import type { StoragePort } from '../../../infrastructure/storage/storage.port';
import * as validation from '../../../infrastructure/storage/portfolio-image-validation';

function fixture() {
  const client = {
    providerProfile: { findFirst: jest.fn(async () => ({ id: 'profile' })) },
    providerPortfolioItem: {
      findFirst: jest.fn(async () => null),
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }) => ({
        ...data,
        id: 'item',
        moderationState: 'PENDING',
        createdAt: new Date(),
        mediaAsset: {
          storageKey: 'portfolio-staging/ref/image.png',
          declaredMimeType: 'image/png',
        },
      })),
    },
    mediaAsset: {
      findFirst: jest.fn(async (): Promise<{ id: string } | null> => null),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: jest.fn(async () => ({ id: 'asset' })),
    },
  };
  const storage = { readObjectStream: jest.fn(async (): Promise<Readable | null> => null) };
  const tx = {
    run: jest.fn(async (fn: (trx: typeof client) => Promise<unknown>) => fn(client)),
  };
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
    expect(f.storage.readObjectStream).not.toHaveBeenCalled();
    expect(f.tx.run).not.toHaveBeenCalled();
  });

  it('reports a missing image only after a valid caller-owned reservation was found', async () => {
    const f = fixture();
    f.client.mediaAsset.findFirst.mockResolvedValue({ id: 'asset' });
    await expect(f.service.create('owner', f.input)).rejects.toMatchObject({
      status: 400,
      details: { reason: 'INVALID_IMAGE' },
    });
    expect(f.storage.readObjectStream).toHaveBeenCalledWith(f.input.storageKey);
    expect(f.tx.run).not.toHaveBeenCalled();
  });
  it('does not blame a valid upload when the native decoder is unavailable', async () => {
    const f = fixture();
    f.client.mediaAsset.findFirst.mockResolvedValue({ id: 'asset' });
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

  it.each(['open', 'stream'])(
    'does not claim an upload when storage fails during %s',
    async (phase) => {
      const f = fixture();
      f.client.mediaAsset.findFirst.mockResolvedValue({ id: 'asset' });
      if (phase === 'open')
        f.storage.readObjectStream.mockRejectedValueOnce(new Error('AccessDenied: secret bucket'));
      else
        f.storage.readObjectStream.mockResolvedValueOnce(
          new Readable({
            read() {
              this.destroy(new Error('ECONNRESET: private endpoint'));
            },
          }),
        );
      await expect(f.service.create('owner', f.input)).rejects.toMatchObject({
        code: 'DEPENDENCY_UNAVAILABLE',
        status: 503,
        message: new validation.PortfolioImageStorageUnavailableError().message,
      });
      expect(f.tx.run).not.toHaveBeenCalled();
    },
  );

  it('leaves a slow upload reservation unclaimed and reports a retryable deadline', async () => {
    jest.useFakeTimers();
    const f = fixture();
    const stream = new Readable({ read() {} });
    f.client.mediaAsset.findFirst.mockResolvedValue({ id: 'asset' });
    f.storage.readObjectStream.mockResolvedValueOnce(stream);
    try {
      const attempt = f.service.create('owner', f.input);
      const rejection = expect(attempt).rejects.toMatchObject({
        code: 'DEPENDENCY_UNAVAILABLE',
        status: 503,
        message: new validation.PortfolioImageStorageUnavailableError().message,
      });
      await jest.advanceTimersByTimeAsync(5000);
      await rejection;
      expect(f.tx.run).not.toHaveBeenCalled();
      expect(stream.destroyed).toBe(true);
    } finally {
      jest.useRealTimers();
      stream.destroy();
    }
  });

  it('attaches the same reservation after storage recovers and persists the fully validated MIME', async () => {
    const f = fixture();
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#226644' },
    })
      .png()
      .toBuffer();
    f.input.contentType = 'image/png';
    f.input.sizeBytes = bytes.byteLength;
    f.client.mediaAsset.findFirst.mockResolvedValue({ id: 'asset' });
    f.storage.readObjectStream
      .mockRejectedValueOnce(new Error('AccessDenied: secret bucket'))
      .mockResolvedValueOnce(Readable.from(bytes));
    await expect(f.service.create('owner', f.input)).rejects.toMatchObject({ status: 503 });
    expect(f.tx.run).not.toHaveBeenCalled();
    await expect(f.service.create('owner', f.input)).resolves.toMatchObject({
      id: 'item',
      moderationState: 'PENDING',
      media: { contentType: 'image/png' },
    });
    expect(f.client.mediaAsset.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        storageKey: f.input.storageKey,
        ownerUserId: 'owner',
        declaredMimeType: 'image/png',
        sizeBytes: bytes.byteLength,
        uploadCompletedAt: null,
        retainUntil: null,
        erasureStartedAt: null,
        uploadExpiresAt: { gt: expect.any(Date) },
      }),
      data: { uploadCompletedAt: expect.any(Date), detectedMimeType: 'image/png' },
    });
  });
});
