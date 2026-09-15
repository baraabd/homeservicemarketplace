import { GetBucketPolicyStatusCommand, GetPublicAccessBlockCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3StorageAdapter } from './s3-storage.adapter';
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
    f.send.mockResolvedValueOnce({
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: false,
        RestrictPublicBuckets: true,
      },
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
      { expiresIn: 300 },
    );
  });
});
