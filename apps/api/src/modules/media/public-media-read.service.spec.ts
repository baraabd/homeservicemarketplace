import { Readable } from 'node:stream';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { StoragePort } from '../../infrastructure/storage/storage.port';
import { PublicMediaReadService } from './public-media-read.service';

const suffix = '0123456789abcdef01234567/12345678-1234-4123-8123-123456789abc.png';
const avatarKey = `avatars/${suffix}`;
const requestKey = `requests/${suffix}`;
const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const profile = {
  deletedAt: null,
  profileImageUrl: `https://api.example.test/v1/media/files/${avatarKey}`,
  avatarUrl: null,
};

function fixture(overrides: Record<string, unknown> = {}, request = false) {
  const key = request ? requestKey : avatarKey;
  const row = {
    storageKey: key,
    visibility: 'PUBLIC',
    purpose: request ? 'REQUEST_ATTACHMENT' : null,
    declaredMimeType: 'image/png',
    detectedMimeType: request ? 'image/png' : null,
    sizeBytes: bytes.length,
    scanState: 'PENDING',
    uploadCompletedAt: new Date(),
    deletedAt: null,
    retainUntil: null,
    erasureStartedAt: null,
    verificationCaseId: null,
    verificationDocument: null,
    portfolioItems: [],
    ownerUserId: 'owner',
    owner: { deletedAt: null, providerProfile: profile },
    serviceRequestId: request ? 'request' : null,
    requestClaimedAt: request ? new Date() : null,
    serviceRequest: request ? { deletedAt: null, seekerUserId: 'owner' } : null,
    ...overrides,
  };
  const client = { mediaAsset: { findUnique: jest.fn().mockResolvedValue(row) } };
  const storage = {
    readObjectHead: jest.fn().mockResolvedValue({ sizeBytes: bytes.length, head: bytes }),
    readObjectStream: jest.fn(async (): Promise<Readable | null> => Readable.from(bytes)),
  };
  return {
    key,
    client,
    storage,
    service: new PublicMediaReadService(
      { client } as unknown as PrismaService,
      storage as unknown as StoragePort,
    ),
  };
}

describe('private origin public media authorization', () => {
  it.each([false, true])('opens only published, validated media (request=%s)', async (request) => {
    const f = fixture({}, request);
    const media = await f.service.openPublic(f.key);
    const chunks: Buffer[] = [];
    for await (const chunk of media.stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(media.contentType).toBe('image/png');
    expect(media.sizeBytes).toBe(bytes.length);
    expect(f.client.mediaAsset.findUnique.mock.calls[0][0].where).toEqual({ storageKey: f.key });
  });

  it.each([
    'verification/case/passport.png',
    `portfolio/${suffix}`,
    `portfolio-staging/${suffix}`,
    `receipts/${suffix}`,
    'avatars/legacy.png',
    `avatars/${suffix}/extra`,
    `avatars/${suffix}?download=1`,
    `avatars/../${suffix}`,
    `avatars//${suffix}`,
    `avatars%2f${suffix}`,
    '.hsm-storage-root.json',
  ])('rejects unknown or malformed key before lookup: %s', async (key) => {
    const f = fixture();
    await expect(f.service.openPublic(key)).rejects.toMatchObject({ status: 404 });
    expect(f.client.mediaAsset.findUnique).not.toHaveBeenCalled();
    expect(f.storage.readObjectHead).not.toHaveBeenCalled();
  });

  it.each([
    ['restricted', { visibility: 'RESTRICTED' }],
    ['private', { visibility: 'PRIVATE' }],
    ['reservation', { uploadCompletedAt: null }],
    ['retired', { retainUntil: new Date() }],
    ['deleted', { deletedAt: new Date() }],
    ['erasing', { erasureStartedAt: new Date() }],
    ['quarantined', { scanState: 'QUARANTINED' }],
    ['rejected', { scanState: 'REJECTED' }],
    ['scan failed', { scanState: 'SCAN_FAILED' }],
    ['unknown scan state', { scanState: 'UNKNOWN' }],
    ['evidence case', { verificationCaseId: 'case' }],
    ['evidence document', { verificationDocument: { id: 'document' } }],
    ['portfolio item', { portfolioItems: [{ id: 'item' }] }],
    ['owner removed', { owner: null }],
    ['owner deleted', { owner: { deletedAt: new Date(), providerProfile: profile } }],
    ['owner missing', { ownerUserId: null }],
    ['HTML type', { declaredMimeType: 'text/html' }],
    ['key/type mismatch', { declaredMimeType: 'image/jpeg' }],
    ['zero size', { sizeBytes: 0 }],
    ['negative size', { sizeBytes: -1 }],
    ['fraction size', { sizeBytes: 1.5 }],
    ['oversize avatar', { sizeBytes: 5 * 1024 * 1024 + 1 }],
  ])('denies %s before opening storage', async (_label, override) => {
    const f = fixture(override as Record<string, unknown>);
    await expect(f.service.openPublic(f.key)).rejects.toMatchObject({ status: 404 });
    expect(f.storage.readObjectHead).not.toHaveBeenCalled();
    expect(f.storage.readObjectStream).not.toHaveBeenCalled();
  });

  it('requires a durable ledger row even if storage has the object', async () => {
    const f = fixture();
    f.client.mediaAsset.findUnique.mockResolvedValue(null);
    await expect(f.service.openPublic(f.key)).rejects.toMatchObject({ status: 404 });
    expect(f.storage.readObjectHead).not.toHaveBeenCalled();
  });

  it.each([
    { purpose: 'FINANCIAL_RECEIPT' },
    { serviceRequestId: 'request' },
    { requestClaimedAt: new Date() },
    { owner: { deletedAt: null, providerProfile: null } },
    { owner: { deletedAt: null, providerProfile: { ...profile, deletedAt: new Date() } } },
    { owner: { deletedAt: null, providerProfile: { ...profile, profileImageUrl: null } } },
    {
      owner: {
        deletedAt: null,
        providerProfile: {
          ...profile,
          profileImageUrl: 'https://cdn.test/other.png',
          avatarUrl: profile.profileImageUrl,
        },
      },
    },
    {
      owner: {
        deletedAt: null,
        providerProfile: {
          ...profile,
          profileImageUrl: `https://cdn.test/photo.png?key=${avatarKey}`,
        },
      },
    },
    {
      owner: {
        deletedAt: null,
        providerProfile: { ...profile, profileImageUrl: `https://cdn.test/fake${avatarKey}` },
      },
    },
  ])('does not publish a claimed avatar without its current live pointer: %j', async (override) => {
    const f = fixture(override);
    await expect(f.service.openPublic(f.key)).rejects.toMatchObject({ status: 404 });
    expect(f.storage.readObjectHead).not.toHaveBeenCalled();
  });

  it('accepts a vetted current avatar key after its URL base changes', async () => {
    const f = fixture({
      owner: {
        deletedAt: null,
        providerProfile: {
          ...profile,
          profileImageUrl: `https://old-cdn.test/bucket/${avatarKey}`,
        },
      },
    });
    (await f.service.openPublic(f.key)).stream.destroy();
  });

  it.each([
    { purpose: null },
    { purpose: 'FINANCIAL_RECEIPT' },
    { requestClaimedAt: null },
    { serviceRequestId: null },
    { serviceRequest: null },
    { serviceRequest: { deletedAt: new Date(), seekerUserId: 'owner' } },
    { serviceRequest: { deletedAt: null, seekerUserId: 'someone-else' } },
    { detectedMimeType: null },
    { detectedMimeType: 'image/jpeg' },
    { sizeBytes: 10 * 1024 * 1024 + 1 },
  ])('requires a committed live request attachment: %j', async (override) => {
    const f = fixture(override, true);
    await expect(f.service.openPublic(f.key)).rejects.toMatchObject({ status: 404 });
    expect(f.storage.readObjectHead).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { sizeBytes: bytes.length + 1, head: bytes },
    { sizeBytes: bytes.length, head: Buffer.from('<script>') },
  ])('refuses missing, changed or mismatched stored bytes', async (stored) => {
    const f = fixture();
    f.storage.readObjectHead.mockResolvedValue(stored);
    await expect(f.service.openPublic(f.key)).rejects.toMatchObject({ status: 404 });
    expect(f.storage.readObjectStream).not.toHaveBeenCalled();
  });

  it.each(['readObjectHead', 'readObjectStream'] as const)(
    'sanitizes %s faults',
    async (operation) => {
      const f = fixture();
      f.storage[operation].mockRejectedValue(new Error('AccessDenied secret-bucket/token'));
      await expect(f.service.openPublic(f.key)).rejects.toMatchObject({
        status: 503,
        message: 'Media access is temporarily unavailable. Please try again.',
      });
    },
  );

  it('returns opaque404 if bytes disappear after validation', async () => {
    const f = fixture();
    f.storage.readObjectStream.mockResolvedValue(null);
    await expect(f.service.openPublic(f.key)).rejects.toMatchObject({ status: 404 });
  });
});
