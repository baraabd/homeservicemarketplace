import { Injectable, Logger } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { AppConfigService } from '../../config/app-config.service';
import { PresignUploadInput, PresignedUpload, StoragePort } from './storage.port';

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

  constructor(private readonly config: AppConfigService) {
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
  }

  async presignUpload(input: PresignUploadInput): Promise<PresignedUpload> {
    const bucket = this.config.get('S3_BUCKET');
    if (!bucket) {
      // Mis-configuration: STORAGE_DRIVER=s3 but no bucket. We surface
      // a clear error rather than letting the SDK fail with an opaque
      // "Could not load credentials" later.
      throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
    }

    const cmd = new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
    });
    const uploadUrl = await getSignedUrl(this.client, cmd, { expiresIn: PRESIGN_TTL_SECONDS });
    const fileUrl = this.publicReadUrl(bucket, input.key);
    const expiresAt = new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000).toISOString();
    this.log.log({
      msg: 'storage.s3.presigned',
      bucket,
      key: input.key,
      bytes: input.sizeBytes,
    });
    return { uploadUrl, fileUrl, expiresAt };
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
    const bucket = this.config.get('S3_BUCKET');
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
    } catch {
      // Missing key, no permission, or a transient fault. All read as "nothing
      // usable is there", which is the answer finalize needs: it refuses rather
      // than linking an object it could not inspect.
      return null;
    }
  }

  /** The canonical public read URL for a key, without needing the bucket at
   *  the call site. Shared with presign so the two can never disagree about
   *  what a key resolves to. */
  publicUrlForKey(key: string): string {
    const bucket = this.config.get('S3_BUCKET');
    if (!bucket) throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
    return this.publicReadUrl(bucket, key);
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
