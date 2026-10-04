import { Readable } from 'node:stream';
import sharp from 'sharp';
import { LIVE_PORTFOLIO_ASSET, PortfolioMediaService } from './portfolio-media.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { StoragePort } from '../../infrastructure/storage/storage.port';
import * as validation from '../../infrastructure/storage/portfolio-image-validation';

let image: Buffer;
beforeAll(async () => {
  image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#226644' } })
    .jpeg()
    .toBuffer();
});

function fixture() {
  const client = { providerPortfolioItem: { findFirst: jest.fn() } };
  const storage = {
    readObjectStream: jest.fn(async (): Promise<Readable | null> => Readable.from(image)),
  };
  return {
    client,
    storage,
    service: new PortfolioMediaService(
      { client } as unknown as PrismaService,
      storage as unknown as StoragePort,
    ),
  };
}
describe('portfolio bytes are resolved through persisted moderation and ownership', () => {
  it('requires an approved undeleted public asset for every public read', async () => {
    const f = fixture();
    f.client.providerPortfolioItem.findFirst.mockResolvedValue(null);
    await expect(f.service.openPublic('portfolio-staging/ref/image.jpg')).rejects.toMatchObject({
      status: 404,
    });
    expect(f.client.providerPortfolioItem.findFirst).toHaveBeenCalledWith({
      where: {
        AND: [
          {
            moderationState: 'APPROVED',
            providerProfile: { deletedAt: null },
            mediaAsset: {
              storageKey: 'portfolio-staging/ref/image.jpg',
              visibility: 'PUBLIC',
              deletedAt: null,
            },
          },
          { deletedAt: null, mediaAsset: LIVE_PORTFOLIO_ASSET },
        ],
      },
      select: { mediaAsset: { select: { storageKey: true, declaredMimeType: true } } },
    });
    expect(f.storage.readObjectStream).not.toHaveBeenCalled();
  });
  it('keeps owner preview scoped inside the query, including pending items', async () => {
    const f = fixture();
    f.client.providerPortfolioItem.findFirst.mockResolvedValue({
      mediaAsset: { storageKey: 'portfolio-staging/ref/image.jpg', declaredMimeType: 'image/jpeg' },
    });
    const result = await f.service.openForOwner('owner', 'item');
    expect(result.contentType).toBe('image/jpeg');
    expect(f.client.providerPortfolioItem.findFirst.mock.calls[0][0].where.AND[0]).toEqual({
      id: 'item',
      providerProfile: { userId: 'owner', deletedAt: null },
    });
    result.stream.destroy();
  });
  it.each(['verification/case/document.jpg', 'requests/user/request.jpg'])(
    'refuses a mislinked storage namespace %s',
    async (storageKey) => {
      const f = fixture();
      f.client.providerPortfolioItem.findFirst.mockResolvedValue({
        mediaAsset: { storageKey, declaredMimeType: 'image/jpeg' },
      });
      await expect(f.service.openForReviewer('profile', 'item')).rejects.toMatchObject({
        status: 404,
      });
      expect(f.storage.readObjectStream).not.toHaveBeenCalled();
    },
  );
  it('returns a safe retryable error when private storage is temporarily unavailable', async () => {
    const f = fixture();
    f.client.providerPortfolioItem.findFirst.mockResolvedValue({
      mediaAsset: { storageKey: 'portfolio-staging/ref/image.jpg', declaredMimeType: 'image/jpeg' },
    });
    f.storage.readObjectStream.mockRejectedValueOnce(
      new Error('AccessDenied: secret bucket details'),
    );
    await expect(f.service.openForReviewer('profile', 'item')).rejects.toMatchObject({
      status: 503,
      message: 'Portfolio image access is temporarily unavailable. Please try again.',
    });
  });
  it('refuses missing bytes without producing an image stream', async () => {
    const f = fixture();
    f.client.providerPortfolioItem.findFirst.mockResolvedValue({
      mediaAsset: { storageKey: 'portfolio-staging/ref/image.jpg', declaredMimeType: 'image/jpeg' },
    });
    f.storage.readObjectStream.mockResolvedValueOnce(null);
    await expect(f.service.openForReviewer('profile', 'item')).rejects.toMatchObject({
      status: 404,
    });
  });
  it('checks current revision and finalized non-retired media before inspecting approval bytes', async () => {
    const f = fixture();
    f.client.providerPortfolioItem.findFirst.mockResolvedValue({
      mediaAsset: {
        storageKey: 'portfolio-staging/ref/image.jpg',
        declaredMimeType: 'image/jpeg',
        sizeBytes: image.byteLength,
      },
    });
    await f.service.assertAvailableForApproval('profile', 'item', 4);
    expect(f.client.providerPortfolioItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'item',
          providerProfileId: 'profile',
          revision: 4,
          deletedAt: null,
          providerProfile: { deletedAt: null },
          mediaAsset: LIVE_PORTFOLIO_ASSET,
        },
      }),
    );
    expect(f.storage.readObjectStream).toHaveBeenCalledWith('portfolio-staging/ref/image.jpg');
  });
  it('never skips approval inspection when the live revision disappears between checks', async () => {
    const f = fixture();
    f.client.providerPortfolioItem.findFirst.mockResolvedValue(null);
    await expect(f.service.assertAvailableForApproval('profile', 'item', 4)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'MEDIA_UNAVAILABLE' },
    });
    expect(f.storage.readObjectStream).not.toHaveBeenCalled();
  });
  it('reports unavailable native validation as a retryable dependency failure', async () => {
    const f = fixture();
    f.client.providerPortfolioItem.findFirst.mockResolvedValue({
      mediaAsset: {
        storageKey: 'portfolio-staging/ref/image.jpg',
        declaredMimeType: 'image/jpeg',
        sizeBytes: image.byteLength,
      },
    });
    const unavailable = jest
      .spyOn(validation, 'validateStoredPortfolioImage')
      .mockRejectedValueOnce(new validation.PortfolioImageDecoderUnavailableError());
    try {
      await expect(
        f.service.assertAvailableForApproval('profile', 'item', 4),
      ).rejects.toMatchObject({
        status: 503,
        message: 'Portfolio image validation is temporarily unavailable.',
      });
    } finally {
      unavailable.mockRestore();
    }
  });
  it.each(['missing', 'size mismatch', 'content mismatch', 'corrupt pixels'])(
    'refuses approval when stored media has %s',
    async (failure) => {
      const f = fixture();
      f.client.providerPortfolioItem.findFirst.mockResolvedValue({
        mediaAsset: {
          storageKey: 'portfolio-staging/ref/image.jpg',
          declaredMimeType: 'image/jpeg',
          sizeBytes: image.byteLength,
        },
      });
      let bytes = image;
      if (failure === 'size mismatch') bytes = Buffer.concat([image, Buffer.from([0])]);
      if (failure === 'content mismatch') bytes = Buffer.alloc(image.byteLength, 0x3c);
      if (failure === 'corrupt pixels') {
        bytes = Buffer.alloc(image.byteLength);
        bytes.set([0xff, 0xd8, 0xff, 0xe0]);
      }
      f.storage.readObjectStream.mockResolvedValueOnce(
        failure === 'missing' ? null : Readable.from(bytes),
      );
      await expect(
        f.service.assertAvailableForApproval('profile', 'item', 4),
      ).rejects.toMatchObject({
        status: 409,
        details: { reason: 'MEDIA_UNAVAILABLE' },
      });
    },
  );
});
