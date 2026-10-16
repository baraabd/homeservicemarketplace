import { instrumentStorage } from './storage-telemetry';
import { TelemetryService } from '../telemetry/telemetry.service';
import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  GetPublicAccessBlockCommand,
  GetBucketPolicyStatusCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

import { AppConfigService } from '../../config/app-config.service';
import { PresignUploadInput, PresignedUpload, StoragePort } from './storage.port';
import { isStagedPortfolioKey } from './portfolio-storage-policy';
import { S3BucketRootGuard } from './s3-storage-root';
import {
  StorageFaultError,
  classifyStorageFault,
  keyFingerprint,
  storageFaultEvent,
  type StorageNamespace,
} from './storage-diagnostics';

// Production storage backend. Used when STORAGE_DRIVER=s3 (set via
// .env in production / preview deploys). Hits S3-compatible storage
// via the AWS SDK v3; the same code works against AWS S3, Cloudflare
// R2, MinIO, or DigitalOcean Spaces by adjusting S3_ENDPOINT and
// S3_FORCE_PATH_STYLE in the env.
//
// Browser-direct upload flow:
//   1. Frontend POSTs /v1/media/presigned-url with file metadata.
//   2. We call PutObjectCommand + getSignedUrl(...) → returns a URL
//      the browser PUTs the binary to. The PUT hits S3 directly,
//      bypassing the API entirely (no proxy bandwidth).
//   3. Once the PUT succeeds the browser sends the resulting fileUrl
//      to POST /v1/me/requests as part of mediaUrls[].
//
// Read-after-write: all S3-compatible backends guarantee strong
// read-after-write for new objects, so the fileUrl is immediately
// resolvable as soon as the PUT 200s.

const PRESIGN_TTL_SECONDS = 5 * 60;

@Injectable()
export class S3StorageAdapter extends StoragePort {
  private readonly log = new Logger(S3StorageAdapter.name);
  private readonly client: S3Client;
  /** R20 — refuses a bucket marked for another namespace (storage-root.ts). */
  private readonly root = new S3BucketRootGuard(() => this.client);

  constructor(
    private readonly config: AppConfigService,
    @Optional() telemetry?: TelemetryService,
  ) {
    super();
    const endpoint = this.config.get('S3_ENDPOINT');
    this.client = new S3Client({
      region: this.config.get('S3_REGION'),
      // When the operator sets S3_ENDPOINT (MinIO / R2 / DO Spaces),
      // S3_FORCE_PATH_STYLE is the right idiom for those backends.
      // AWS S3 itself uses virtual-hosted–style; we leave the option
      // unset by default.
      ...(endpoint ? { endpoint, forcePathStyle: this.config.get('S3_FORCE_PATH_STYLE') } : {}),
      // Credentials default to the AWS SDK's standard provider chain
      // (env vars → shared credentials file → EC2/ECS metadata),
      // which is what production deploys want. We only override when
      // explicit env vars are set so dev secrets never leak into the
      // SDK's default provider precedence.
      ...(this.config.get('S3_ACCESS_KEY_ID') && this.config.get('S3_SECRET_ACCESS_KEY')
        ? {
            credentials: {
              accessKeyId: this.config.get('S3_ACCESS_KEY_ID') as string,
              secretAccessKey: this.config.get('S3_SECRET_ACCESS_KEY') as string,
            },
          }
        : {}),
    });
    instrumentStorage(this.client, telemetry);
  }

  async headBuckets(signal: AbortSignal): Promise<void> {
    const buckets = ['S3_BUCKET', 'S3_PORTFOLIO_BUCKET', 'S3_RESTRICTED_BUCKET'] as const;
    for (const key of buckets) {
      const bucket = this.config.get(key);
      if (bucket)
        await this.client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: signal });
    }
  }

  async presignUpload(input: PresignUploadInput): Promise<PresignedUpload> {
    const bucket = this.bucketForKey(input.key);
    if (!bucket) {
      // Mis-configuration: STORAGE_DRIVER=s3 but no bucket. We surface
      // a clear error rather than letting the SDK fail with an opaque
      // "Could not load credentials" later.
      throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
    }

    // R20 — never hand out a PUT into a bucket provisioned for another
    // namespace (for example the restricted bucket via a copied env value).
    await this.root.check(bucket, namespaceForKey(input.key));
    if (isStagedPortfolioKey(input.key)) await this.assertPrivatePortfolioBucket(bucket);
    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
      // Every minted key is unique. Replays must never replace finalized bytes.
      IfNoneMatch: '*',
    });
    // R20 — `content-type` must be SIGNED. By default the presigner signs only
    // host, content-length and if-none-match, so the browser could store any
    // Content-Type on the object (text/html on a PNG/HTML polyglot, served
    // publicly from the CDN). The local driver already binds the type into its
    // HMAC; this restores parity. Every web client PUTs with exactly the type
    // it presigned (verified against real S3-compatible storage in
    // test/integration/r20-storage).
    const uploadUrl = await getSignedUrl(this.client, cmd, {
      expiresIn: PRESIGN_TTL_SECONDS,
      signableHeaders: new Set(['content-type']),
    });
    const fileUrl = this.publicUrlForKey(input.key);
    const expiresAt = new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000).toISOString();
    // R20 — namespace and key fingerprint only. The bucket name and the key
    // (which for staging is a private object) no longer enter logs.
    this.log.log({
      msg: 'storage.s3.presigned',
      namespace: namespaceForKey(input.key),
      keyFp: keyFingerprint(input.key),
      bytes: input.sizeBytes,
    });
    return { uploadUrl, fileUrl, expiresAt };
  }

  async readObjectStream(key: string): Promise<Readable | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucketForKey(key), Key: key }),
      );
      const body = result.Body;
      if (!body || !('pipe' in body)) throw new Error('Object response has no readable body.');
      return body as Readable;
    } catch (error) {
      const { name, $metadata } = error as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      // A missing bucket is a dependency/configuration failure, not evidence
      // that this image was lost. Some compatible backends return an unnamed 404.
      if (
        name === 'NoSuchKey' ||
        name === 'NotFound' ||
        (!name && $metadata?.httpStatusCode === 404)
      ) {
        return null;
      }
      // R20 — classified and stripped. A raw SDK error names the bucket.
      const event = storageFaultEvent({
        operation: 'read',
        namespace: namespaceForKey(key),
        key,
        err: error,
      });
      this.log.error(event);
      throw new StorageFaultError(event.outcome === 'missing' ? 'unavailable' : event.outcome);
    }
  }

  private bucketForKey(key: string): string {
    if (!isStagedPortfolioKey(key)) {
      const bucket = this.config.get('S3_BUCKET');
      if (!bucket) throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
      return bucket;
    }
    const bucket = this.config.get('S3_PORTFOLIO_BUCKET');
    if (
      !bucket ||
      bucket === this.config.get('S3_BUCKET') ||
      bucket === this.config.get('S3_RESTRICTED_BUCKET')
    ) {
      throw new Error('S3_PORTFOLIO_BUCKET must be a dedicated private portfolio bucket');
    }
    return bucket;
  }

  /** Refuse new staging uploads when bucket privacy cannot be established. */
  private async assertPrivatePortfolioBucket(bucket: string): Promise<void> {
    const block = await this.client.send(new GetPublicAccessBlockCommand({ Bucket: bucket }));
    const config = block.PublicAccessBlockConfiguration;
    if (
      !config?.BlockPublicAcls ||
      !config.IgnorePublicAcls ||
      !config.BlockPublicPolicy ||
      !config.RestrictPublicBuckets
    ) {
      throw new Error('Portfolio bucket must block all public access');
    }
    try {
      const policy = await this.client.send(new GetBucketPolicyStatusCommand({ Bucket: bucket }));
      if (policy.PolicyStatus?.IsPublic !== false)
        throw new Error('Portfolio bucket policy is not private');
    } catch (error) {
      if ((error as { name?: string }).name !== 'NoSuchBucketPolicy') throw error;
    }
  }

  /**
   * Sprint 9B.17 — size and leading bytes, for the avatar finalize check.
   *
   * A RANGE request, not a whole GetObject: the caller wants a signature, and
   * with a browser-direct upload this is the API's only look at bytes it never
   * received. Pulling entire objects back out of the bucket to read twelve of
   * them would turn every avatar save into an egress charge.
   *
   * `ContentRange` carries the FULL object length ("bytes 0-15/40213"), so one
   * ranged read answers both questions and no HeadObject is needed.
   */
  async readObjectHead(
    key: string,
    byteCount: number,
  ): Promise<{ sizeBytes: number; head: Uint8Array } | null> {
    const bucket = this.bucketForKey(key);
    if (!bucket) throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');

    const lastByte = Math.max(0, byteCount - 1);
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          Range: `bytes=0-${lastByte}`,
        }),
      );
      const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
      if (!body?.transformToByteArray) return null;
      const head = await body.transformToByteArray();

      // "bytes 0-15/40213" — the part after the slash is the WHOLE object.
      // ContentLength on a ranged response is the length of the range, so
      // reading the size from it would report every avatar as 16 bytes; it is
      // only a fallback for a backend that omits the range header.
      const total = res.ContentRange?.split('/')[1];
      const parsed = total ? Number.parseInt(total, 10) : (res.ContentLength ?? head.byteLength);
      return { sizeBytes: Number.isFinite(parsed) ? parsed : head.byteLength, head };
    } catch (err) {
      // Missing key, no permission, or a transient fault. All read as "nothing
      // usable is there", which is the answer finalize needs: it refuses rather
      // than linking an object it could not inspect.
      //
      // R20 — the CALLER still gets null for all of them, but the operator is
      // told which one it was. Distinguishing them to the caller is change
      // request CR-05 (the avatar finalize route owns that response).
      if (classifyStorageFault(err) !== 'missing') {
        this.log.warn(
          storageFaultEvent({ operation: 'head', namespace: namespaceForKey(key), key, err }),
        );
      }
      return null;
    }
  }

  /** The canonical public read URL for a key, without needing the bucket at
   *  the call site. Shared with presign so the two can never disagree about
   *  what a key resolves to. */
  publicUrlForKey(key: string): string {
    if (isStagedPortfolioKey(key)) {
      const base = this.config.get('PUBLIC_API_URL')?.replace(/\/+$/, '') ?? '';
      return `${base}/v1/media/files/${key.split('/').map(encodeURIComponent).join('/')}`;
    }
    const bucket = this.bucketForKey(key);
    if (!bucket) throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
    return this.publicReadUrl(bucket, key);
  }

  /**
   * Remove one object. Idempotent — see `StoragePort.deleteObject`.
   *
   * S3's DeleteObject is already idempotent: deleting a key that is not
   * there answers 204, exactly as deleting one that is. So the ordinary
   * path needs no special handling, and the cleanup worker's
   * delete-then-record ordering survives a crash between the two steps.
   *
   * NoSuchKey / NotFound are mapped to success for the backends that answer
   * that way instead (MinIO and some R2 configurations), so behaviour does
   * not depend on which S3-compatible provider an operator chose.
   *
   * Everything else RETHROWS. AccessDenied in particular must stay a
   * failure: a bucket policy that forbids deletion is precisely the case
   * where the object is still publicly readable, and swallowing it would
   * let the worker write `deletedAt` for bytes that are still being served.
   */
  async deleteObject(key: string): Promise<void> {
    const bucket = this.bucketForKey(key);
    if (!bucket) throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err) {
      const name = (err as { name?: string })?.name;
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
        ?.httpStatusCode;
      // Absent is the end state this asked for.
      if (name === 'NoSuchKey' || name === 'NotFound' || status === 404) {
        this.log.log({ msg: 'storage.s3.delete.absent', keyFp: keyFingerprint(key) });
        return;
      }
      // A key FINGERPRINT, and no URL: this runs on every cleanup pass, and
      // the signed URL, the public URL and (R20) a staged key must not reach a
      // log.
      this.log.warn({
        ...storageFaultEvent({ operation: 'delete', namespace: namespaceForKey(key), key, err }),
        msg: 'storage.s3.delete.failed',
      });
      // Still a failure, and still the original error for the cleanup worker's
      // retry classification; it is never serialized to a client.
      throw err;
    }
    this.log.log({ msg: 'storage.s3.delete', keyFp: keyFingerprint(key) });
  }

  /** Compose the canonical read URL for an uploaded object.
   *  Operators with a CDN in front (CloudFront, Cloudflare) override
   *  the base via S3_PUBLIC_BASE_URL; otherwise we fall back to the
   *  S3 virtual-hosted–style URL. */
  private publicReadUrl(bucket: string, key: string): string {
    const cdn = this.config.get('S3_PUBLIC_BASE_URL');
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    if (cdn && cdn.length > 0) return `${cdn.replace(/\/+$/, '')}/${encodedKey}`;
    const region = this.config.get('S3_REGION');
    return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
  }
}

/** Which provisioned bucket a server-minted key belongs to. */
function namespaceForKey(key: string): StorageNamespace {
  return isStagedPortfolioKey(key) ? 'portfolio-staging' : 'public';
}
