import {
  GetBucketPolicyStatusCommand,
  GetObjectCommand,
  GetPublicAccessBlockCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { S3StorageAdapter } from './s3-storage.adapter';
import { StorageFaultError } from './storage-diagnostics';
import { STORAGE_ROOT_MARKER_KEY } from './storage-root';
import type { AppConfigService } from '../../config/app-config.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(async () => 'https://private-upload.test/signed-put'),
}));
const upload = {
  key: 'portfolio-staging/ref/image.jpg',
  contentType: 'image/jpeg' as const,
  sizeBytes: 123,
};
function fixture(overrides: Record<string, unknown> = {}) {
  const values = {
    S3_BUCKET: 'public-media',
    S3_REGION: 'us-east-1',
    S3_PORTFOLIO_BUCKET: 'private-portfolio',
    S3_RESTRICTED_BUCKET: 'identity',
    PUBLIC_API_URL: 'https://api.test',
    ...overrides,
  };
  const adapter = new S3StorageAdapter({
    get: (key: keyof typeof values) => values[key],
  } as unknown as AppConfigService);
  const client = Reflect.get(adapter, 'client') as {
    send: (...args: unknown[]) => Promise<unknown>;
  };
  const send = jest.spyOn(client, 'send');
  return { adapter, send };
}
describe('private S3 portfolio staging', () => {
  afterEach(() => jest.restoreAllMocks());
  it('keeps unrelated boot valid when portfolio storage has not yet been configured', () => {
    expect(() => fixture({ S3_PORTFOLIO_BUCKET: undefined })).not.toThrow();
  });
  it.each([undefined, 'public-media', 'identity'])(
    'refuses absent or shared staging bucket %s',
    async (bucket) => {
      const f = fixture({ S3_PORTFOLIO_BUCKET: bucket });
      await expect(f.adapter.presignUpload(upload)).rejects.toThrow(
        'dedicated private portfolio bucket',
      );
      expect(f.send).not.toHaveBeenCalled();
    },
  );
  it('refuses a bucket with any public-access control disabled before minting a URL', async () => {
    const f = fixture();
    f.send.mockImplementation(async (command) => {
      if (command instanceof GetObjectCommand) throw { name: 'NoSuchKey' };
      if (command instanceof GetPublicAccessBlockCommand)
        return {
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: false,
            RestrictPublicBuckets: true,
          },
        };
      throw new Error('unexpected storage operation');
    });
    await expect(f.adapter.presignUpload(upload)).rejects.toThrow('block all public access');
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
  it('signs a create-only PUT and returns only an API-mediated read path', async () => {
    const f = fixture();
    f.send.mockImplementation(async (command) => {
      if (command instanceof GetPublicAccessBlockCommand)
        return {
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: true,
          },
        };
      if (command instanceof GetBucketPolicyStatusCommand)
        return { PolicyStatus: { IsPublic: false } };
      throw new Error('unexpected storage operation');
    });
    const result = await f.adapter.presignUpload(upload);
    expect(result.fileUrl).toBe('https://api.test/v1/media/files/portfolio-staging/ref/image.jpg');
    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        input: expect.objectContaining({ Bucket: 'private-portfolio', IfNoneMatch: '*' }),
      }),
      // R20 — content-type is a SIGNED header; without it the browser could
      // store any Content-Type on the object (real-storage proof:
      // test/integration/r20-storage, "refuses a different MIME type").
      { expiresIn: 300, signableHeaders: new Set(['content-type']) },
    );
  });

  it.each([
    ['NoSuchKey', { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } }],
    ['NotFound', { name: 'NotFound', $metadata: { httpStatusCode: 404 } }],
    ['unnamed 404', { $metadata: { httpStatusCode: 404 } }],
  ])('returns no stream for a confirmed missing object (%s)', async (_label, failure) => {
    const f = fixture();
    f.send.mockRejectedValueOnce(failure);
    await expect(f.adapter.readObjectStream(upload.key)).resolves.toBeNull();
  });

  // R20 — still a dependency failure and never absence, but now CLASSIFIED and
  // stripped: the raw SDK error (which names the bucket) no longer escapes.
  it.each([
    [
      'missing bucket',
      { name: 'NoSuchBucket', message: 'private-portfolio', $metadata: { httpStatusCode: 404 } },
      'misconfigured',
    ],
    [
      'access denied',
      { name: 'AccessDenied', message: 'private-portfolio', $metadata: { httpStatusCode: 403 } },
      'denied',
    ],
    [
      'connection reset',
      Object.assign(new Error('backend connection lost'), { code: 'ECONNRESET' }),
      'unavailable',
    ],
  ])(
    'preserves %s as a dependency failure without claiming object absence',
    async (_label, failure, outcome) => {
      const f = fixture();
      f.send.mockRejectedValueOnce(failure);
      const error = await f.adapter.readObjectStream(upload.key).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(StorageFaultError);
      expect((error as StorageFaultError).outcome).toBe(outcome);
      expect(String((error as Error).message)).not.toContain('private-portfolio');
    },
  );

  it.each([
    ['bodyless', {}],
    ['unreadable body', { Body: {} }],
  ])('refuses a malformed successful GET response (%s)', async (_label, result) => {
    const f = fixture();
    f.send.mockResolvedValueOnce(result);
    await expect(f.adapter.readObjectStream(upload.key)).rejects.toThrow(StorageFaultError);
  });

  // R20 — a bucket provisioned for ANOTHER namespace is refused before any URL
  // is minted; an unmarked (pre-R20) bucket is still accepted.
  it.each(['restricted', 'public'])(
    'refuses to presign into a bucket marked %s for portfolio staging',
    async (namespace) => {
      const f = fixture();
      f.send.mockImplementation(async (command) => {
        if (command instanceof GetObjectCommand) {
          expect((command as GetObjectCommand).input.Key).toBe(STORAGE_ROOT_MARKER_KEY);
          const marker = JSON.stringify({
            schema: 'hsm.storage-root/v1',
            namespace,
            rootId: '00000000-0000-4000-8000-000000000000',
            createdAt: '2026-10-13T00:00:00.000Z',
          });
          return { Body: { transformToString: async () => marker } };
        }
        throw new Error('unexpected storage operation');
      });
      await expect(f.adapter.presignUpload(upload)).rejects.toThrow(
        'storage-root-namespace-mismatch',
      );
      expect(getSignedUrl).not.toHaveBeenCalled();
    },
  );

  it('returns the successful private object stream with its ownership intact', async () => {
    const f = fixture();
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const stream = Readable.from(bytes);
    f.send.mockResolvedValueOnce({ Body: stream });
    const result = await f.adapter.readObjectStream(upload.key);
    expect(result).toBe(stream);
    expect(stream.destroyed).toBe(false);
    expect(f.send).toHaveBeenCalledWith(expect.any(GetObjectCommand));
    expect(f.send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { Bucket: 'private-portfolio', Key: upload.key },
      }),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of result!) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(bytes);
  });
});
