import { Readable } from 'node:stream';
import { PortfolioMediaService } from './portfolio-media.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { StoragePort } from '../../infrastructure/storage/storage.port';

function fixture() {
  const client = { providerPortfolioItem: { findFirst: jest.fn() } };
  const storage = { readObjectStream: jest.fn(async () => Readable.from('image')) };
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
          { deletedAt: null, mediaAsset: { visibility: 'PUBLIC', deletedAt: null } },
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
});
