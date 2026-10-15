import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';

import { classifyStorageFault, type StorageNamespace } from './storage-diagnostics';
import {
  STORAGE_ROOT_MARKER_KEY,
  StorageRootMismatchError,
  parseStorageRootMarker,
  type StorageRootMarker,
} from './storage-root';

// R20 — the bucket half of storage-root.ts. Kept in its own file so the local
// adapters never import the AWS SDK (see the lazy-loading note in
// storage.module.ts).
//
// ROLLOUT POSTURE: a bucket WITHOUT a marker is accepted with a one-time
// warning, because buckets provisioned before R20 have none and refusing them
// would stop evidence uploads and retention on deploy. A marker naming a
// DIFFERENT namespace is refused, which catches the realistic accident —
// S3_RESTRICTED_BUCKET copied from S3_BUCKET, or a worker given the public
// bucket. Requiring the marker everywhere is a coordinator change request
// (shared-change-requests/CR-02), because it needs an env flag and CI fixtures.

export type BucketRootState =
  | { state: 'verified'; marker: StorageRootMarker }
  | { state: 'absent' }
  | { state: 'unverifiable'; outcome: string };

export class S3BucketRootGuard {
  private readonly log = new Logger(S3BucketRootGuard.name);
  /** Settled answers per bucket. Unverifiable answers are NOT cached: they are
   *  a transient fault, and the next call deserves a fresh look. */
  private readonly settled = new Map<string, Promise<BucketRootState>>();
  private readonly warned = new Set<string>();

  constructor(private readonly client: () => S3Client) {}

  /**
   * Throws StorageRootMismatchError when the bucket is marked for another
   * namespace. Otherwise returns what was learned, for diagnostics.
   */
  async check(bucket: string, expected: StorageNamespace): Promise<BucketRootState> {
    let pending = this.settled.get(bucket);
    if (!pending) {
      pending = this.read(bucket);
      this.settled.set(bucket, pending);
    }
    let result: BucketRootState;
    try {
      result = await pending;
    } catch (err) {
      this.settled.delete(bucket);
      throw err;
    }
    if (result.state === 'unverifiable') this.settled.delete(bucket);
    if (result.state === 'verified' && result.marker.namespace !== expected) {
      this.log.error({ msg: 'storage.root.mismatch', expected, found: result.marker.namespace });
      throw new StorageRootMismatchError();
    }
    if (result.state !== 'verified') this.warnOnce(bucket, expected, result);
    return result;
  }

  private async read(bucket: string): Promise<BucketRootState> {
    try {
      const out = await this.client().send(
        new GetObjectCommand({ Bucket: bucket, Key: STORAGE_ROOT_MARKER_KEY }),
      );
      const text = await (
        out.Body as { transformToString?: () => Promise<string> } | undefined
      )?.transformToString?.();
      if (typeof text !== 'string') return { state: 'unverifiable', outcome: 'unavailable' };
      return { state: 'verified', marker: parseStorageRootMarker(text) };
    } catch (err) {
      if (err instanceof StorageRootMismatchError) throw err;
      const outcome = classifyStorageFault(err);
      if (outcome === 'missing') return { state: 'absent' };
      return { state: 'unverifiable', outcome };
    }
  }

  private warnOnce(bucket: string, expected: StorageNamespace, result: BucketRootState): void {
    const id = `${bucket}\0${expected}\0${result.state}`;
    if (this.warned.has(id)) return;
    this.warned.add(id);
    // No bucket name: the namespace says which one is meant.
    this.log.warn({
      msg: 'storage.root.unverified',
      namespace: expected,
      state: result.state,
      ...(result.state === 'unverifiable' ? { outcome: result.outcome } : {}),
    });
  }
}
