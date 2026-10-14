/* eslint-disable @typescript-eslint/no-require-imports -- the AWS SDK loads only inside the R20 real-storage gate. */
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';

import { buildStorageRootMarker } from '../../../src/infrastructure/storage/storage-root';
import type { StorageNamespace } from '../../../src/infrastructure/storage/storage-diagnostics';

// R20 — shared fixture for the real S3-compatible storage suites.
//
// EMULATOR EVIDENCE ONLY. These suites run against a disposable MinIO built
// from the pinned upstream release (fixture/Dockerfile.minio, mirroring
// scripts/ci/install-minio-fixture.sh). They prove adapter behaviour, policy
// semantics MinIO implements, and the inventory/restore contract. They do NOT
// prove AWS IAM conditions, KMS, Object Ownership, public-access blocks or CDN
// behaviour; those are hosted evidence (docs/production-readiness/r20/ACCEPTANCE.md).
//
// Gate: RUN_R20_STORAGE_INTEGRATION=1 plus
//   R20_S3_ENDPOINT        loopback endpoint of the disposable service
//   R20_S3_ROOT_USER/SECRET  its root credentials (setup only; never logged)
//   R20_MINIO_CONTAINER    container whose bundled `mc` creates least-privilege
//                          users (only the least-privilege block needs it)

export const r20Enabled = process.env.RUN_R20_STORAGE_INTEGRATION === '1';

/** The AWS SDK, loaded lazily (only inside the gate) but fully typed. */
export function sdk(): typeof import('@aws-sdk/client-s3') {
  return require('@aws-sdk/client-s3');
}

export function endpoint(): string {
  const raw = process.env.R20_S3_ENDPOINT;
  if (!raw) throw new Error('r20-storage-tests-require-R20_S3_ENDPOINT');
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('r20-storage-tests-require-loopback');
  }
  return url.href.replace(/\/$/, '');
}

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export function rootCredentials(): Credentials {
  const accessKeyId = process.env.R20_S3_ROOT_USER;
  const secretAccessKey = process.env.R20_S3_ROOT_SECRET;
  if (!accessKeyId || !secretAccessKey)
    throw new Error('r20-storage-tests-require-root-credentials');
  return { accessKeyId, secretAccessKey };
}

export function client(credentials: Credentials = rootCredentials(), at = endpoint()): S3Client {
  const { S3Client: Client } = sdk();
  return new Client({
    endpoint: at,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials,
    // A refused connection must fail fast, not retry into the jest timeout.
    maxAttempts: 1,
  });
}

/** AppConfigService-shaped config for an adapter under test. */
export function adapterConfig(
  buckets: { public?: string; staging?: string; restricted?: string },
  credentials: Credentials = rootCredentials(),
  at = endpoint(),
): { get: (key: string) => unknown } {
  const values: Record<string, unknown> = {
    STORAGE_DRIVER: 's3',
    S3_ENDPOINT: at,
    S3_REGION: 'us-east-1',
    S3_FORCE_PATH_STYLE: true,
    S3_ACCESS_KEY_ID: credentials.accessKeyId,
    S3_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    S3_BUCKET: buckets.public,
    S3_PORTFOLIO_BUCKET: buckets.staging,
    S3_RESTRICTED_BUCKET: buckets.restricted,
  };
  return { get: (key: string) => values[key] };
}

export function bucketName(purpose: string): string {
  return `r20-${purpose}-${randomUUID().slice(0, 8)}`;
}

export async function createBucket(
  s3: S3Client,
  name: string,
  options: { versioning?: boolean; objectLock?: boolean; marker?: StorageNamespace } = {},
): Promise<void> {
  const { CreateBucketCommand, PutBucketVersioningCommand } = sdk();
  await s3.send(
    new CreateBucketCommand({
      Bucket: name,
      ...(options.objectLock ? { ObjectLockEnabledForBucket: true } : {}),
    }),
  );
  if (options.versioning && !options.objectLock) {
    await s3.send(
      new PutBucketVersioningCommand({
        Bucket: name,
        VersioningConfiguration: { Status: 'Enabled' },
      }),
    );
  }
  if (options.marker) await writeMarker(s3, name, options.marker);
}

/** Provision a root marker the way an operator would (R20 storage-root.ts). */
export async function writeMarker(
  s3: S3Client,
  bucket: string,
  namespace: StorageNamespace,
): Promise<string> {
  const { PutObjectCommand } = sdk();
  const marker = buildStorageRootMarker(namespace);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: '.hsm-storage-root.json',
      Body: JSON.stringify(marker),
      ContentType: 'application/json',
    }),
  );
  return marker.rootId;
}

/** Remove every version, delete marker and legal hold, then the bucket. */
export async function destroyBucket(s3: S3Client, name: string): Promise<void> {
  const {
    ListObjectVersionsCommand,
    DeleteObjectCommand,
    DeleteBucketCommand,
    PutObjectLegalHoldCommand,
  } = sdk();
  for (let i = 0; i < 50; i += 1) {
    let page;
    try {
      page = await s3.send(new ListObjectVersionsCommand({ Bucket: name }));
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchBucket') return;
      throw err;
    }
    const items = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])];
    if (items.length === 0) break;
    for (const item of items) {
      await s3
        .send(
          new PutObjectLegalHoldCommand({
            Bucket: name,
            Key: item.Key,
            VersionId: item.VersionId,
            LegalHold: { Status: 'OFF' },
          }),
        )
        .catch(() => undefined);
      await s3.send(
        new DeleteObjectCommand({ Bucket: name, Key: item.Key, VersionId: item.VersionId }),
      );
    }
  }
  await s3.send(new DeleteBucketCommand({ Bucket: name }));
}

export async function putRaw(
  s3: S3Client,
  bucket: string,
  key: string,
  body: Buffer,
  contentType = 'application/octet-stream',
): Promise<string | undefined> {
  const { PutObjectCommand } = sdk();
  const out = await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
  return out.VersionId;
}

export async function headRaw(s3: S3Client, bucket: string, key: string): Promise<number | null> {
  const { HeadObjectCommand } = sdk();
  try {
    const out = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return Number(out.ContentLength);
  } catch (err) {
    if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw err;
  }
}

export async function versionsOf(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<{ versions: number; deleteMarkers: number }> {
  const { ListObjectVersionsCommand } = sdk();
  const out = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: key }));
  return {
    versions: (out.Versions ?? []).filter((v: { Key?: string }) => v.Key === key).length,
    deleteMarkers: (out.DeleteMarkers ?? []).filter((v: { Key?: string }) => v.Key === key).length,
  };
}

/** A GET with no credentials at all: what the internet sees. */
export async function anonymousGet(bucket: string, key: string): Promise<number> {
  const res = await fetch(
    `${endpoint()}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`,
  );
  await res.arrayBuffer();
  return res.status;
}

export async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

// ─── least-privilege principals (MinIO `mc`, inside the lane's container) ───

function mc(args: string[], stdin?: string): string {
  const container = process.env.R20_MINIO_CONTAINER;
  if (!container) throw new Error('least-privilege-tests-require-R20_MINIO_CONTAINER');
  return execFileSync('docker', ['exec', '-i', container, 'mc', ...args], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
}

let aliasReady = false;
function ensureAlias(): void {
  if (aliasReady) return;
  // The container's own root env, so no credential crosses this command line.
  const container = process.env.R20_MINIO_CONTAINER;
  if (!container) throw new Error('least-privilege-tests-require-R20_MINIO_CONTAINER');
  execFileSync(
    'docker',
    [
      'exec',
      container,
      'sh',
      '-c',
      'mc alias set r20 http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null',
    ],
    { env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
  );
  aliasReady = true;
}

/** Create a user holding exactly `policy` (an IAM document) and return its keys. */
export function createPrincipal(name: string, policy: unknown): Credentials {
  ensureAlias();
  const accessKeyId = `${name}${randomBytes(4).toString('hex')}`;
  const secretAccessKey = randomBytes(24).toString('hex');
  const policyName = `${accessKeyId}-policy`;
  const file = `/tmp/${policyName}.json`;
  execFileSync(
    'docker',
    ['exec', '-i', process.env.R20_MINIO_CONTAINER as string, 'sh', '-c', 'cat > "$0"', file],
    { input: JSON.stringify(policy), env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
  );
  mc(['--quiet', 'admin', 'policy', 'create', 'r20', policyName, file]);
  mc(['--quiet', 'admin', 'user', 'add', 'r20', accessKeyId, secretAccessKey]);
  mc(['--quiet', 'admin', 'policy', 'attach', 'r20', policyName, '--user', accessKeyId]);
  return { accessKeyId, secretAccessKey };
}

export function removePrincipal(credentials: Credentials): void {
  ensureAlias();
  const policyName = `${credentials.accessKeyId}-policy`;
  try {
    mc(['--quiet', 'admin', 'user', 'remove', 'r20', credentials.accessKeyId]);
  } finally {
    mc(['--quiet', 'admin', 'policy', 'remove', 'r20', policyName]);
  }
}
