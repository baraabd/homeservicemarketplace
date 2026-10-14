import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';

import { type StorageNamespace } from './storage-diagnostics';

// R20 — storage ROOT identity.
//
// THE DEFECT
//
// Every process that touches media resolves its own root: the API, the
// evidence-retention worker, the dispute worker, a second API replica. For the
// local driver the default is `<cwd>/.restricted-uploads`, so an API started
// from `apps/api` and a worker started from the repository root disagree about
// where evidence lives. For S3 the equivalent is a worker given a different —
// existing, empty — bucket name.
//
// Reads fail loudly in that situation, which is fine. ERASURE does not: the
// local adapter certified `verifiedAbsent` whenever `head()` said "not here",
// and "not here" is exactly what a wrong root says about everything. A worker
// pointed at the wrong root would therefore issue a retention erasure receipt
// for a passport that was still on disk.
//
// THE FIX
//
// Each root carries a small marker naming the namespace it was provisioned
// for and a random, non-secret root id. Two processes that print the same root
// id are provably looking at the same storage; a write that finds a marker for
// a DIFFERENT namespace refuses (restricted evidence can never land in the
// public root because an env var was copied); and the local restricted
// adapter refuses to certify absence under a root that has never held
// evidence.
//
// The marker key starts with a dot. `validateKey` refuses dot-leading
// segments, so no server-minted key and no public route can address it.

export const STORAGE_ROOT_MARKER_KEY = '.hsm-storage-root.json';
export const STORAGE_ROOT_MARKER_SCHEMA = 'hsm.storage-root/v1';

export interface StorageRootMarker {
  schema: typeof STORAGE_ROOT_MARKER_SCHEMA;
  namespace: StorageNamespace;
  /** Random and non-secret: safe to log, compare and put in an inventory. */
  rootId: string;
  createdAt: string;
}

const NAMESPACES: readonly StorageNamespace[] = ['public', 'portfolio-staging', 'restricted'];

/** A marker that names a different namespace than the caller expects. */
export class StorageRootMismatchError extends Error {
  constructor() {
    super('storage-root-namespace-mismatch');
    this.name = 'StorageRootMismatchError';
  }
}

export function buildStorageRootMarker(namespace: StorageNamespace): StorageRootMarker {
  return {
    schema: STORAGE_ROOT_MARKER_SCHEMA,
    namespace,
    rootId: randomUUID(),
    createdAt: new Date().toISOString(),
  };
}

/** Parse strictly. Anything unexpected is a misconfigured root, not "absent". */
export function parseStorageRootMarker(text: string): StorageRootMarker {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new StorageRootMismatchError();
  }
  const m = value as Partial<StorageRootMarker> | null;
  if (
    !m ||
    m.schema !== STORAGE_ROOT_MARKER_SCHEMA ||
    !NAMESPACES.includes(m.namespace as StorageNamespace) ||
    typeof m.rootId !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(m.rootId) ||
    typeof m.createdAt !== 'string'
  ) {
    throw new StorageRootMismatchError();
  }
  return {
    schema: STORAGE_ROOT_MARKER_SCHEMA,
    namespace: m.namespace as StorageNamespace,
    rootId: m.rootId,
    createdAt: m.createdAt,
  };
}

export function assertMarkerNamespace(
  marker: StorageRootMarker,
  expected: StorageNamespace,
): StorageRootMarker {
  if (marker.namespace !== expected) throw new StorageRootMismatchError();
  return marker;
}

// ─── Local roots ───────────────────────────────────────────────────────────

export interface ResolvedLocalRoot {
  path: string;
  /** `cwd-default` is the fragile case: two processes started from different
   *  directories get different roots. Surfaced in diagnostics, not guessed. */
  source: 'configured' | 'cwd-default';
}

export function resolveLocalRoot(
  configured: string | undefined,
  defaultDirName: string,
): ResolvedLocalRoot {
  if (configured && configured.length > 0) {
    return { path: normalize(configured), source: 'configured' };
  }
  return { path: normalize(join(process.cwd(), defaultDirName)), source: 'cwd-default' };
}

/** The marker in a local root, or null when the root has none yet. */
export async function readLocalRootMarker(root: string): Promise<StorageRootMarker | null> {
  let text: string;
  try {
    text = await readFile(join(root, STORAGE_ROOT_MARKER_KEY), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return parseStorageRootMarker(text);
}

/**
 * Return this root's marker, creating it if the root has none.
 *
 * Creation is a hard link from a fully written temporary file, so a concurrent
 * reader never sees half a marker and two processes racing to create one end
 * up agreeing on the winner's root id rather than each keeping their own.
 */
export async function ensureLocalRootMarker(
  root: string,
  namespace: StorageNamespace,
): Promise<StorageRootMarker> {
  const existing = await readLocalRootMarker(root);
  if (existing) return assertMarkerNamespace(existing, namespace);

  await mkdir(root, { recursive: true });
  const target = join(root, STORAGE_ROOT_MARKER_KEY);
  const temp = join(root, `.hsm-storage-root.${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(buildStorageRootMarker(namespace)), { flag: 'wx' });
  try {
    await link(temp, target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  } finally {
    await rm(temp, { force: true });
  }
  const settled = await readLocalRootMarker(root);
  if (!settled) throw new StorageRootMismatchError();
  return assertMarkerNamespace(settled, namespace);
}

/** True when `dir` exists and is a directory. */
export async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}
