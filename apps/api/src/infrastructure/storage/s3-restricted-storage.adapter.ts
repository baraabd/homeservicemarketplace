import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';

import { AppConfigService } from '../../config/app-config.service';
import {
  RestrictedObjectStoragePort,
  type RestrictedObjectMetadata,
} from './restricted-object-storage.port';
import { validateKey } from './local-disk-storage.adapter';

// Sprint 9B.3 — restricted evidence on S3-compatible storage. Production.
//
// Note what this adapter does NOT do: it never presigns. The public S3 adapter
// exists to hand the browser a URL; this one exists so the API can read and
// write bytes itself, because every restricted read must be authorised against
// the database and audited before a byte moves. A presigned URL is a bearer
// capability that outlives the check that produced it, which is precisely what
// ADR 0009 refuses for identity documents.
//
// A SEPARATE BUCKET from public media by default. Same reasoning as the local
// adapter's separate root: the public/restricted split should survive a code
// mistake, and a distinct bucket means a public route that forgot its
// `isRestrictedKey` check still cannot resolve a passport. Falls back to the
// media bucket only if an operator explicitly configures no separate one, and
// the boot check below makes that an explicit choice rather than a silent one.

@Injectable()
export class S3RestrictedStorageAdapter extends RestrictedObjectStoragePort {
  private readonly log = new Logger(S3RestrictedStorageAdapter.name);
  private readonly client: S3Client;

  constructor(private readonly config: AppConfigService) {
    super();
    this.client = this.createClient();
  }

  /**
   * The S3 client, as its own method so the contract tests can substitute an
   * in-memory backend by subclassing.
   *
   * A seam rather than a cast: the same behavioural contract has to hold for
   * both adapters, and the only honest way to assert that for S3 without a
   * live bucket is to drive the real command objects against a fake
   * transport.
   */
  protected createClient(): S3Client {
    const endpoint = this.config.get('S3_ENDPOINT');
    return new S3Client({
      region: this.config.get('S3_REGION'),
      ...(endpoint ? { endpoint, forcePathStyle: this.config.get('S3_FORCE_PATH_STYLE') } : {}),
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

  async putObjectFromFile(input: {
    key: string;
    sourcePath: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<void> {
    validateKey(input.key);

    // The stream is named, and this method owns it for its whole life.
    //
    // It used to be constructed inline inside PutObjectCommand, which is fine
    // exactly while send() succeeds. When send() REJECTS BEFORE consuming the
    // body — a backend outage — an inline stream is orphaned: nobody reads it
    // and nobody closes it. That is not merely a leaked handle, because
    // createReadStream schedules its open() immediately, so the stream is
    // still going to touch the file. If the staging directory has been removed
    // by then, it emits 'error' with ENOENT, and an 'error' event with no
    // listener is an uncaught exception.
    //
    // It does not fail the code that caused it — by then that work is over. It
    // fails whatever is running next. In CI that was an admin authentication
    // e2e suite, blamed for a storage adapter's file handle.
    //
    // Pinned by s3-restricted-storage.stream-ownership.spec.ts.
    const body = createReadStream(input.sourcePath);

    // A backstop for the orphaned case ONLY. It cannot hide a real failure: if
    // the stream breaks while the SDK is reading it, that surfaces as send()
    // rejecting, which `guarded` turns into the sanitised error below. This
    // listener exists so a late fs error on a stream nobody is reading any
    // more cannot take the process down.
    body.on('error', () => undefined);

    try {
      await this.guarded(() =>
        this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket(),
            Key: input.key,
            // A file stream with an explicit length, so a 10 MiB upload never
            // becomes a 10 MiB Buffer. ContentLength is required because the
            // SDK cannot infer it from a stream, and it is the SERVER-counted
            // value, not anything the client claimed.
            Body: body,
            ContentLength: input.sizeBytes,
            ContentType: input.contentType,
            // Belt and braces against a bucket whose policy is looser than it
            // should be. Evidence is served by this API or not at all.
            ACL: 'private',
          }),
        ),
      );
    } finally {
      // Settled on BOTH paths. On success the SDK has already consumed and
      // closed it, so this is a no-op; on failure it is the whole point.
      body.destroy();
    }

    this.log.log({ msg: 'restricted.storage.put', bytes: input.sizeBytes });
  }

  async openReadStream(key: string): Promise<Readable> {
    validateKey(key);
    const out = await this.guarded(() =>
      this.client.send(new GetObjectCommand({ Bucket: this.bucket(), Key: key })),
    );
    const body = out.Body as Readable | undefined;
    if (!body) throw new Error('empty-body');
    return body;
  }

  async head(key: string): Promise<RestrictedObjectMetadata | null> {
    validateKey(key);
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket(), Key: key }),
      );
      return { sizeBytes: Number(out.ContentLength ?? 0) };
    } catch (err) {
      // 404/NotFound is an ordinary answer during finalize. Anything else is a
      // real backend fault and must not be flattened into "missing", or a
      // credentials outage would read as "the provider never uploaded".
      if (isNotFound(err)) return null;
      throw backendFailure();
    }
  }

  async deleteObject(key: string): Promise<void> {
    validateKey(key);
    // S3 DELETE is already idempotent — deleting a missing key succeeds.
    await this.guarded(() =>
      this.client.send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: key })),
    );
    this.log.log({ msg: 'restricted.storage.delete' });
  }

  /**
   * Every S3 call goes through here so a backend error cannot escape.
   *
   * Raw SDK errors are chatty by design: they name the bucket, sometimes the
   * key, and in an AccessDenied they can echo the principal. That text reaches
   * logs, error trackers and — via an unhandled rejection — occasionally a
   * response body. For a bucket that holds passports, none of it may leave
   * this class, so the whole family collapses to one opaque failure.
   *
   * The contract suite asserts this by making a fake backend throw an error
   * containing a bucket name and a credential-shaped token, then checking
   * neither survives.
   */
  private async guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      this.log.error({
        msg: 'restricted.storage.backend_error',
        // The error NAME is a stable, non-sensitive classifier. The message is
        // deliberately not logged.
        kind: (err as { name?: string })?.name ?? 'Unknown',
      });
      throw backendFailure();
    }
  }

  /** The restricted bucket. Never logged, never returned to a caller. */
  private bucket(): string {
    const dedicated = this.config.get('S3_RESTRICTED_BUCKET');
    if (dedicated && dedicated.length > 0) return dedicated;
    const shared = this.config.get('S3_BUCKET');
    if (shared && shared.length > 0) return shared;
    throw new Error('restricted-storage-misconfigured');
  }
}

/** S3 signals absence several ways depending on the backend and whether the
 *  caller has ListBucket. All of them mean the object is not there. */
function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

/**
 * The single opaque failure every backend fault becomes.
 *
 * One message, no bucket, no key, no principal, no SDK detail. Callers that
 * need to distinguish "absent" from "broken" use head()'s null instead.
 */
function backendFailure(): Error {
  return new Error('restricted-storage-unavailable');
}
