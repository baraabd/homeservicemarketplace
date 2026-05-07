import { Injectable, Logger } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
