import { createHash } from 'node:crypto';

// R20 — one vocabulary for "why could this object not be used".
//
// Operators debugging a broken image or an unreadable document need to tell
// four situations apart, and before R20 every adapter flattened them
// differently: the public S3 head read collapsed all of them into `null`, the
// restricted read route answers 404 for all of them (correctly, to callers),
// and the logs carried either nothing or the raw SDK error name.
//
//   missing        the backend answered and the object is not there
//   denied         the backend refused this principal (IAM, ACL, bucket policy)
//   misconfigured  the namespace itself is wrong (no such bucket, wrong root)
//   unavailable    the backend could not be asked (network, timeout, 5xx)
//
// Callers keep their own response policy — a restricted read still answers 404
// for every one of these so a prober learns nothing. This module only decides
// what the OPERATOR is told, and makes sure that what they are told contains
// no bucket name, object key, principal, endpoint or filesystem path.

export type StorageFaultOutcome = 'missing' | 'denied' | 'misconfigured' | 'unavailable';

export type StorageNamespace = 'public' | 'portfolio-staging' | 'restricted';

const DENIED_NAMES = new Set([
  'AccessDenied',
  'AllAccessDisabled',
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'ExpiredToken',
  'InvalidToken',
  'TokenRefreshRequired',
  'CredentialsProviderError',
]);

const MISCONFIGURED_NAMES = new Set([
  'NoSuchBucket',
  'PermanentRedirect',
  'AuthorizationHeaderMalformed',
  'InvalidBucketName',
  'storage-root-namespace-mismatch',
]);

const MISSING_NAMES = new Set(['NoSuchKey', 'NotFound', 'NoSuchVersion']);

/**
 * Classify an S3 SDK or Node fs failure.
 *
 * Order matters: `NoSuchBucket` is ALSO an HTTP 404, and reading it as
 * "missing" is exactly the confusion this exists to remove — a wrong bucket
 * name would look like a provider who never uploaded.
 */
export function classifyStorageFault(err: unknown): StorageFaultOutcome {
  const e = err as {
    name?: string;
    code?: string;
    Code?: string;
    message?: string;
    $metadata?: { httpStatusCode?: number };
  } | null;
  const name = e?.name ?? e?.Code;
  const code = e?.code;
  const status = e?.$metadata?.httpStatusCode;

  if (name && MISCONFIGURED_NAMES.has(name)) return 'misconfigured';
  if (e?.message === 'storage-root-namespace-mismatch') return 'misconfigured';
  if (name && DENIED_NAMES.has(name)) return 'denied';
  if (name && MISSING_NAMES.has(name)) return 'missing';

  // Node filesystem errors.
  if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing';
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'denied';

  if (status === 403) return 'denied';
  // A nameless 404 (HEAD responses carry no error body) is the one ambiguous
  // case: S3 answers HeadObject on a missing bucket and on a missing key with
  // the same bodiless 404. It is reported as missing; a bucket listing in the
  // diagnostic script is what tells the two apart.
  if (status === 404) return 'missing';
  if (status === 301 || status === 400) return 'misconfigured';
  return 'unavailable';
}

/** Fingerprint of a bucket name: stable and short, but not the name. The doctor
 *  and the inventory use it so neither output carries a bucket name. */
export function bucketRef(bucket: string): string {
  return createHash('sha256').update(`bucket:${bucket}`, 'utf8').digest('hex').slice(0, 16);
}

/**
 * A stable, non-reversible handle for an object key.
 *
 * Lets an operator correlate a log line with an inventory row (the inventory
 * script emits the same fingerprint) without the key itself — which for
 * restricted evidence embeds a verification case id — entering logs, error
 * trackers or telemetry.
 */
export function keyFingerprint(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
}

/** The structured, secret-free log payload for a storage fault. */
export function storageFaultEvent(input: {
  operation: string;
  namespace: StorageNamespace;
  key?: string;
  err: unknown;
}): {
  msg: 'storage.fault';
  operation: string;
  namespace: StorageNamespace;
  outcome: StorageFaultOutcome;
  kind: string;
  keyFp?: string;
} {
  const e = input.err as { name?: string; code?: string } | null;
  // NAME or errno code only: stable classifiers. The message is never logged,
  // because SDK messages name the bucket and sometimes the principal.
  const kind = sanitizeKind(e?.name ?? e?.code ?? 'Unknown');
  return {
    msg: 'storage.fault',
    operation: input.operation,
    namespace: input.namespace,
    outcome: classifyStorageFault(input.err),
    kind,
    ...(input.key ? { keyFp: keyFingerprint(input.key) } : {}),
  };
}

/** Error names are attacker-influenced only in theory (a hostile endpoint),
 *  but a log field should still never carry free text. */
function sanitizeKind(kind: string): string {
  return /^[A-Za-z0-9_.-]{1,64}$/.test(kind) ? kind : 'Unknown';
}

/**
 * A storage failure that has already been classified and stripped of
 * coordinates. What crosses an adapter boundary instead of a raw SDK error.
 */
export class StorageFaultError extends Error {
  constructor(readonly outcome: Exclude<StorageFaultOutcome, 'missing'>) {
    super(`storage-${outcome}`);
    this.name = 'StorageFaultError';
  }
}
