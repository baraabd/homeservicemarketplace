import { createHash, randomUUID } from 'node:crypto';
import {
  GetBucketVersioningCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

import { bucketRef, keyFingerprint, type StorageNamespace } from './storage-diagnostics';
import { STORAGE_ROOT_MARKER_KEY, parseStorageRootMarker } from './storage-root';

// R20 — object inventory and restore verification, the contract R36 (backup and
// restore) consumes.
//
// An inventory says what a bucket held at a point in time: every version and
// delete marker, its size, ETag and (in deep mode) a SHA-256 of the bytes. A
// restore report compares a restored bucket against that inventory.
//
// WHAT IS DELIBERATELY NOT IN THE OUTPUT
//
// - Object keys. A restricted key embeds a verification case id; a staging key
//   is a private object. Entries carry `keyFp` (storage-diagnostics), the same
//   fingerprint the adapters log, so an operator correlates an entry with a log
//   line or with `keyFingerprint(MediaAsset.storageKey)` without the key.
// - Bucket names, endpoints and credentials. `bucketRef` is a fingerprint; the
//   operator already knows which bucket they pointed the tool at.
// - Object bytes. Deep mode hashes them in a stream and keeps only the digest.
//
// Lives here (not in scripts/) so it compiles with the adapters, uses the same
// fingerprint and root-marker code, and is exercised against real S3-compatible
// storage by test/integration/r20-storage.

export const STORAGE_INVENTORY_SCHEMA = 'hsm.storage-inventory/v1';
export const STORAGE_RESTORE_REPORT_SCHEMA = 'hsm.storage-restore-report/v1';

export interface InventoryEntry {
  keyFp: string;
  versionId: string;
  isLatest: boolean;
  deleteMarker: boolean;
  sizeBytes: number;
  etag: string | null;
  lastModified: string | null;
  /** Deep mode only, and never for a delete marker. */
  sha256?: string;
}

export interface StorageInventory {
  schema: typeof STORAGE_INVENTORY_SCHEMA;
  namespace: StorageNamespace;
  bucketRef: string;
  rootId: string | null;
  versioning: string;
  mode: 'shallow' | 'deep';
  correlationId: string;
  generatedAt: string;
  counts: { liveObjects: number; versions: number; deleteMarkers: number; liveBytes: number };
  entries: InventoryEntry[];
  manifestSha256: string;
}

export interface RestoreReport {
  schema: typeof STORAGE_RESTORE_REPORT_SCHEMA;
  namespace: StorageNamespace;
  inventoryCorrelationId: string;
  inventoryManifestSha256: string;
  correlationId: string;
  mode: 'shallow' | 'deep';
  expectedLive: number;
  matched: number;
  /** keyFp of every live inventory object absent from the restored bucket. */
  missing: string[];
  /** keyFp of every live object whose size (or SHA-256 in deep mode) differs. */
  mismatched: string[];
  /** Live objects in the restored bucket the inventory never listed. */
  unexpected: number;
  ok: boolean;
}

export class StorageInventoryError extends Error {
  constructor(code: string) {
    super(`storage-inventory-${code}`);
    this.name = 'StorageInventoryError';
  }
}

interface ListedVersion {
  key: string;
  entry: InventoryEntry;
}

/** Every version and delete marker under `prefix`, fully paginated. */
async function listVersions(
  client: S3Client,
  bucket: string,
  prefix: string | undefined,
): Promise<ListedVersion[]> {
  const out: ListedVersion[] = [];
  let keyMarker: string | undefined;
  let versionMarker: string | undefined;
  for (let page = 0; page < 100_000; page += 1) {
    const res = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: prefix,
        KeyMarker: keyMarker,
        VersionIdMarker: versionMarker,
        MaxKeys: 1000,
      }),
    );
    for (const v of res.Versions ?? []) {
      if (!v.Key || v.Key === STORAGE_ROOT_MARKER_KEY) continue;
      out.push({
        key: v.Key,
        entry: {
          keyFp: keyFingerprint(v.Key),
          versionId: v.VersionId ?? 'null',
          isLatest: v.IsLatest === true,
          deleteMarker: false,
          sizeBytes: Number(v.Size ?? 0),
          etag: v.ETag ? v.ETag.replace(/"/g, '') : null,
          lastModified: v.LastModified ? v.LastModified.toISOString() : null,
        },
      });
    }
    for (const m of res.DeleteMarkers ?? []) {
      if (!m.Key || m.Key === STORAGE_ROOT_MARKER_KEY) continue;
      out.push({
        key: m.Key,
        entry: {
          keyFp: keyFingerprint(m.Key),
          versionId: m.VersionId ?? 'null',
          isLatest: m.IsLatest === true,
          deleteMarker: true,
          sizeBytes: 0,
          etag: null,
          lastModified: m.LastModified ? m.LastModified.toISOString() : null,
        },
      });
    }
    if (!res.IsTruncated) return out;
    keyMarker = res.NextKeyMarker;
    versionMarker = res.NextVersionIdMarker;
    // A truncated page without a cursor cannot be continued honestly.
    if (!keyMarker) throw new StorageInventoryError('truncated-without-cursor');
  }
  throw new StorageInventoryError('page-budget-exhausted');
}

async function sha256Of(
  client: S3Client,
  bucket: string,
  key: string,
  versionId: string,
): Promise<string> {
  const res = await client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(versionId !== 'null' ? { VersionId: versionId } : {}),
    }),
  );
  const hash = createHash('sha256');
  for await (const chunk of res.Body as Readable) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function readRootId(client: S3Client, bucket: string): Promise<string | null> {
  try {
    const res = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: STORAGE_ROOT_MARKER_KEY }),
    );
    const text = await (
      res.Body as { transformToString?: () => Promise<string> } | undefined
    )?.transformToString?.();
    return text ? parseStorageRootMarker(text).rootId : null;
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'NoSuchKey' || name === 'NotFound') return null;
    throw err;
  }
}

function sortEntries(entries: InventoryEntry[]): InventoryEntry[] {
  return [...entries].sort((a, b) =>
    a.keyFp === b.keyFp ? a.versionId.localeCompare(b.versionId) : a.keyFp.localeCompare(b.keyFp),
  );
}

/** Canonical digest over the sorted entries, so two runs over unchanged
 *  storage produce the same manifest hash whatever the listing order. */
export function manifestDigest(entries: InventoryEntry[]): string {
  return createHash('sha256')
    .update(JSON.stringify(sortEntries(entries)), 'utf8')
    .digest('hex');
}

export async function buildInventory(
  client: S3Client,
  input: {
    bucket: string;
    namespace: StorageNamespace;
    prefix?: string;
    deep?: boolean;
    now?: Date;
    correlationId?: string;
  },
): Promise<StorageInventory> {
  const versioning =
    (await client.send(new GetBucketVersioningCommand({ Bucket: input.bucket }))).Status ??
    'Unversioned';
  const rootId = await readRootId(client, input.bucket);
  const listed = await listVersions(client, input.bucket, input.prefix);
  if (input.deep) {
    for (const item of listed) {
      if (!item.entry.deleteMarker) {
        item.entry.sha256 = await sha256Of(client, input.bucket, item.key, item.entry.versionId);
      }
    }
  }
  const entries = sortEntries(listed.map((l) => l.entry));
  const live = entries.filter((e) => e.isLatest && !e.deleteMarker);
  return {
    schema: STORAGE_INVENTORY_SCHEMA,
    namespace: input.namespace,
    bucketRef: bucketRef(input.bucket),
    rootId,
    versioning,
    mode: input.deep ? 'deep' : 'shallow',
    correlationId: input.correlationId ?? randomUUID(),
    generatedAt: (input.now ?? new Date()).toISOString(),
    counts: {
      liveObjects: live.length,
      versions: entries.filter((e) => !e.deleteMarker).length,
      deleteMarkers: entries.filter((e) => e.deleteMarker).length,
      liveBytes: live.reduce((n, e) => n + e.sizeBytes, 0),
    },
    entries,
    manifestSha256: manifestDigest(entries),
  };
}

/** Refuse an inventory that was edited after it was produced. */
export function assertInventoryIntact(inventory: StorageInventory): void {
  if (inventory.schema !== STORAGE_INVENTORY_SCHEMA) throw new StorageInventoryError('schema');
  if (manifestDigest(inventory.entries) !== inventory.manifestSha256) {
    throw new StorageInventoryError('manifest-mismatch');
  }
}

/**
 * Compare a restored bucket's LIVE objects with an inventory's live objects.
 *
 * Shallow mode compares sizes; deep mode compares SHA-256 and requires a deep
 * inventory. ETags are not compared: they legitimately differ across buckets
 * under SSE-KMS and multipart uploads, so equality would be a false signal.
 */
export async function verifyRestore(
  client: S3Client,
  input: {
    bucket: string;
    inventory: StorageInventory;
    deep?: boolean;
    correlationId?: string;
  },
): Promise<RestoreReport> {
  assertInventoryIntact(input.inventory);
  if (input.deep && input.inventory.mode !== 'deep') {
    throw new StorageInventoryError('deep-verify-needs-deep-inventory');
  }
  const expected = new Map(
    input.inventory.entries.filter((e) => e.isLatest && !e.deleteMarker).map((e) => [e.keyFp, e]),
  );
  const restored = (await listVersions(client, input.bucket, undefined)).filter(
    (l) => l.entry.isLatest && !l.entry.deleteMarker,
  );
  const restoredByFp = new Map(restored.map((l) => [l.entry.keyFp, l]));

  const missing: string[] = [];
  const mismatched: string[] = [];
  let matched = 0;
  for (const [fp, want] of expected) {
    const got = restoredByFp.get(fp);
    if (!got) {
      missing.push(fp);
      continue;
    }
    let same = got.entry.sizeBytes === want.sizeBytes;
    if (same && input.deep) {
      same = (await sha256Of(client, input.bucket, got.key, got.entry.versionId)) === want.sha256;
    }
    if (same) matched += 1;
    else mismatched.push(fp);
  }
  const unexpected = [...restoredByFp.keys()].filter((fp) => !expected.has(fp)).length;
  return {
    schema: STORAGE_RESTORE_REPORT_SCHEMA,
    namespace: input.inventory.namespace,
    inventoryCorrelationId: input.inventory.correlationId,
    inventoryManifestSha256: input.inventory.manifestSha256,
    correlationId: input.correlationId ?? randomUUID(),
    mode: input.deep ? 'deep' : 'shallow',
    expectedLive: expected.size,
    matched,
    missing: missing.sort(),
    mismatched: mismatched.sort(),
    unexpected,
    ok: missing.length === 0 && mismatched.length === 0,
  };
}
