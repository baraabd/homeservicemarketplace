import {
  GetBucketPolicyCommand,
  GetBucketPolicyStatusCommand,
  GetObjectCommand,
  GetPublicAccessBlockCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3StorageAdapter } from './s3-storage.adapter';
import type { AppConfigService } from '../../config/app-config.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(async () => 'https://upload.test/signed-put'),
}));

const upload = {
  key: 'portfolio-staging/ref/image.jpg',
  contentType: 'image/jpeg' as const,
  sizeBytes: 123,
};
const noPolicy = { name: 'NoSuchBucketPolicy', $metadata: { httpStatusCode: 404 } };

function fixture(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    S3_BUCKET: 'public-media',
    S3_REGION: 'us-east-1',
    S3_PORTFOLIO_BUCKET: 'private-portfolio',
    S3_RESTRICTED_BUCKET: 'identity',
    S3_ENDPOINT: 'https://minio.test',
    S3_PORTFOLIO_PRIVACY_MODE: 'minio',
    PUBLIC_API_URL: 'https://api.test',
    ...overrides,
  };
  const adapter = new S3StorageAdapter({
    get: (key: string) => values[key],
  } as unknown as AppConfigService);
  const client = Reflect.get(adapter, 'client') as {
    send: (...args: unknown[]) => Promise<unknown>;
  };
  const policy = jest.fn<Promise<unknown>, []>();
  const send = jest.spyOn(client, 'send').mockImplementation(async (command) => {
    if (command instanceof GetObjectCommand) throw { name: 'NoSuchKey' };
    return policy();
  });
  return { adapter, send, policy };
}

describe('explicit MinIO portfolio privacy verification', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([undefined, '', ' '])('requires an explicit MinIO endpoint (%p)', (endpoint) => {
    expect(() => fixture({ S3_ENDPOINT: endpoint })).toThrow('requires S3_ENDPOINT');
  });

  it('signs only after authenticated confirmation that no bucket policy exists', async () => {
    const f = fixture();
    f.policy.mockRejectedValue(noPolicy);
    await expect(f.adapter.presignUpload(upload)).resolves.toMatchObject({
      fileUrl: 'https://api.test/v1/media/files/portfolio-staging/ref/image.jpg',
    });
    expect(f.send).toHaveBeenCalledWith(
      expect.objectContaining({ input: { Bucket: 'private-portfolio' } }),
    );
    expect(f.send).toHaveBeenCalledWith(expect.any(GetBucketPolicyCommand));
    expect(f.send).not.toHaveBeenCalledWith(expect.any(GetPublicAccessBlockCommand));
    expect(f.send).not.toHaveBeenCalledWith(expect.any(GetBucketPolicyStatusCommand));
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['public policy', { Policy: '{"Statement":[{"Effect":"Allow","Principal":"*"}]}' }],
    ['conditional policy', { Policy: '{"Statement":[{"Effect":"Allow","Condition":{}}]}' }],
    ['deny policy', { Policy: '{"Statement":[{"Effect":"Deny","Principal":"*"}]}' }],
    ['empty policy', { Policy: '{"Version":"2012-10-17","Statement":[]}' }],
    ['unknown policy', { Policy: '{"futureSchema":true}' }],
    ['invalid JSON', { Policy: 'not-json' }],
    ['empty string', { Policy: '' }],
    ['missing policy field', {}],
    ['absent response', undefined],
  ])('refuses every existing or unverifiable policy (%s)', async (_label, response) => {
    const f = fixture();
    f.policy.mockResolvedValue(response);
    await expect(f.adapter.presignUpload(upload)).rejects.toThrow(
      'must have no anonymous bucket policy',
    );
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it.each([
    ['access denied', { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }],
    ['missing bucket', { name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } }],
    ['generic 404', { name: 'NotFound', $metadata: { httpStatusCode: 404 } }],
    ['unnamed 404', { $metadata: { httpStatusCode: 404 } }],
    ['missing status', { name: 'NoSuchBucketPolicy' }],
    ['wrong status', { name: 'NoSuchBucketPolicy', $metadata: { httpStatusCode: 403 } }],
    ['unsupported API', { name: 'NotImplemented', $metadata: { httpStatusCode: 501 } }],
    ['network error', new Error('connection reset')],
  ])('fails closed on %s without minting a URL', async (_label, failure) => {
    const f = fixture();
    f.policy.mockRejectedValue(failure);
    await expect(f.adapter.presignUpload(upload)).rejects.toBe(failure);
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('rechecks privacy for every upload and refuses a policy introduced after success', async () => {
    const f = fixture();
    f.policy.mockRejectedValueOnce(noPolicy).mockResolvedValueOnce({ Policy: '{}' });
    await f.adapter.presignUpload(upload);
    await expect(f.adapter.presignUpload(upload)).rejects.toThrow(
      'must have no anonymous bucket policy',
    );
    expect(f.policy).toHaveBeenCalledTimes(2);
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 'aws'])('keeps AWS checks strict without MinIO opt-in (%p)', async (mode) => {
    const f = fixture({ S3_PORTFOLIO_PRIVACY_MODE: mode });
    const failure = { name: 'NotImplemented', $metadata: { httpStatusCode: 501 } };
    f.policy.mockRejectedValue(failure);
    await expect(f.adapter.presignUpload(upload)).rejects.toBe(failure);
    expect(f.send).toHaveBeenCalledWith(expect.any(GetPublicAccessBlockCommand));
    expect(f.send).not.toHaveBeenCalledWith(expect.any(GetBucketPolicyCommand));
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
});
