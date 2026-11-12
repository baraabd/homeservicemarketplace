import type { S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import type { AppConfigService } from '../../../src/config/app-config.service';
import { S3StorageAdapter } from '../../../src/infrastructure/storage/s3-storage.adapter';
import {
  adapterConfig,
  anonymousGet,
  bucketName,
  client,
  createBucket,
  createPrincipal,
  destroyBucket,
  putRaw,
  r20Enabled,
  readAll,
  removePrincipal,
  sdk,
  type Credentials,
} from './r20-s3-fixture';

const d = r20Enabled ? describe : describe.skip;
jest.setTimeout(120_000);

d('explicit MinIO portfolio privacy — real least-privilege storage', () => {
  const bucket = bucketName('privacy');
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  let admin: S3Client;
  let app: Credentials;
  let denied: Credentials;
  let appClient: S3Client;

  function adapter(credentials: Credentials) {
    const base = adapterConfig({ public: `${bucket}-public`, staging: bucket }, credentials);
    return new S3StorageAdapter({
      get: (key: string) =>
        key === 'S3_PORTFOLIO_PRIVACY_MODE'
          ? 'minio'
          : key === 'PUBLIC_API_URL'
            ? 'https://api.test'
            : base.get(key),
    } as AppConfigService);
  }

  const upload = () => ({
    key: `portfolio-staging/privacy/${randomUUID()}.jpg`,
    contentType: 'image/jpeg' as const,
    sizeBytes: bytes.length,
  });

  beforeAll(async () => {
    admin = client();
    await createBucket(admin, bucket, { marker: 'portfolio-staging' });
    const objects = [
      {
        Effect: 'Allow',
        Action: ['s3:PutObject', 's3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/portfolio-staging/*`],
      },
      {
        Effect: 'Allow',
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/.hsm-storage-root.json`],
      },
    ];
    app = createPrincipal('r20privacy', {
      Version: '2012-10-17',
      Statement: [
        ...objects,
        {
          Effect: 'Allow',
          Action: ['s3:GetBucketPolicy'],
          Resource: [`arn:aws:s3:::${bucket}`],
        },
      ],
    });
    denied = createPrincipal('r20noprivacy', { Version: '2012-10-17', Statement: objects });
    appClient = client(app);
  });

  afterAll(async () => {
    for (const principal of [app, denied]) if (principal) removePrincipal(principal);
    if (admin) await destroyBucket(admin, bucket);
    admin?.destroy();
    appClient?.destroy();
  });

  it('verifies missing policy with app credentials, uploads once, and denies anonymous read', async () => {
    const { GetBucketPolicyCommand } = sdk();
    await expect(
      appClient.send(new GetBucketPolicyCommand({ Bucket: bucket })),
    ).rejects.toMatchObject({
      name: 'NoSuchBucketPolicy',
      $metadata: { httpStatusCode: 404 },
    });
    const input = upload();
    const asApp = adapter(app);
    const signed = await asApp.presignUpload(input);
    const response = await fetch(signed.uploadUrl, {
      method: 'PUT',
      body: bytes,
      headers: { 'Content-Type': input.contentType, 'If-None-Match': '*' },
    });
    await response.arrayBuffer();
    expect(response.status).toBe(200);
    expect(signed.fileUrl).toBe(`https://api.test/v1/media/files/${input.key}`);
    expect(await readAll((await asApp.readObjectStream(input.key))!)).toEqual(bytes);
    expect(await anonymousGet(bucket, input.key)).toBe(403);
  });

  it('refuses an app credential without the read-only policy permission', async () => {
    await expect(adapter(denied).presignUpload(upload())).rejects.toMatchObject({
      name: 'AccessDenied',
      $metadata: { httpStatusCode: 403 },
    });
  });

  it('cannot grant or remove anonymous access using the app credential', async () => {
    const { PutBucketPolicyCommand, DeleteBucketPolicyCommand } = sdk();
    const Policy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${bucket}/*`,
        },
      ],
    });
    await expect(
      appClient.send(new PutBucketPolicyCommand({ Bucket: bucket, Policy })),
    ).rejects.toMatchObject({ name: 'AccessDenied' });
    await expect(
      appClient.send(new DeleteBucketPolicyCommand({ Bucket: bucket })),
    ).rejects.toMatchObject({ name: 'AccessDenied' });
  });

  it.each(['Allow', 'Deny'])(
    'refuses every existing policy, including %s, then recovers after removal',
    async (Effect) => {
      const { PutBucketPolicyCommand, DeleteBucketPolicyCommand } = sdk();
      const asApp = adapter(app);
      const exposed = upload();
      await putRaw(admin, bucket, exposed.key, bytes, exposed.contentType);
      await expect(asApp.presignUpload(upload())).resolves.toHaveProperty('uploadUrl');
      try {
        await admin.send(
          new PutBucketPolicyCommand({
            Bucket: bucket,
            Policy: JSON.stringify({
              Version: '2012-10-17',
              Statement: [
                {
                  Effect,
                  Principal: '*',
                  Action: 's3:GetObject',
                  Resource: `arn:aws:s3:::${bucket}/portfolio-staging/*`,
                },
              ],
            }),
          }),
        );
        expect(await anonymousGet(bucket, exposed.key)).toBe(Effect === 'Allow' ? 200 : 403);
        await expect(asApp.presignUpload(upload())).rejects.toThrow(
          'must have no anonymous bucket policy',
        );
      } finally {
        await admin.send(new DeleteBucketPolicyCommand({ Bucket: bucket }));
      }
      expect(await anonymousGet(bucket, exposed.key)).toBe(403);
      await expect(asApp.presignUpload(upload())).resolves.toHaveProperty('uploadUrl');
    },
  );
});
