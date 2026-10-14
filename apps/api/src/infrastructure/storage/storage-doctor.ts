import { bucketRef, classifyStorageFault, type StorageNamespace } from './storage-diagnostics';
import { readLocalRootMarker, resolveLocalRoot, StorageRootMismatchError } from './storage-root';

// R20 — a redacted, read-only description of the storage roots THIS process
// resolves. Run it in every process that touches media (API replicas, the
// retention/dispute/scan workers, a one-off job): processes that report the
// same `rootId` per namespace are provably reading and erasing the same
// storage. A differing or null id is the misconfiguration to fix — by
// configuration, never by searching other host directories or by making a
// bucket public.
//
// Never reports a bucket name, endpoint, credential, object key or local path.
// Read-only: it creates no marker and no directory.

type ConfigLike = { get(key: string): unknown };

export const STORAGE_DOCTOR_SCHEMA = 'hsm.storage-doctor/v1';

export interface NamespaceDiagnosis {
  namespace: StorageNamespace;
  driver: 'local' | 's3';
  /** Local: how the root was resolved. S3: a bucket fingerprint. */
  rootSource?: 'configured' | 'cwd-default';
  bucketRef?: string;
  marker: 'verified' | 'absent' | 'mismatch' | 'unverifiable';
  rootId: string | null;
  /** Only when unverifiable: missing | denied | misconfigured | unavailable. */
  outcome?: string;
}

export interface StorageDiagnosis {
  schema: typeof STORAGE_DOCTOR_SCHEMA;
  namespaces: NamespaceDiagnosis[];
  /** True when every namespace has a verified marker for itself. */
  healthy: boolean;
}

const LOCAL_ROOTS: Array<{ namespace: StorageNamespace; env: string; dir: string }> = [
  { namespace: 'public', env: 'LOCAL_STORAGE_DIR', dir: '.media-uploads' },
  { namespace: 'restricted', env: 'RESTRICTED_STORAGE_DIR', dir: '.restricted-uploads' },
];

const S3_BUCKETS: Array<{ namespace: StorageNamespace; env: string }> = [
  { namespace: 'public', env: 'S3_BUCKET' },
  { namespace: 'portfolio-staging', env: 'S3_PORTFOLIO_BUCKET' },
  { namespace: 'restricted', env: 'S3_RESTRICTED_BUCKET' },
];

export async function diagnoseStorage(config: ConfigLike): Promise<StorageDiagnosis> {
  const namespaces =
    config.get('STORAGE_DRIVER') === 's3' ? await diagnoseS3(config) : await diagnoseLocal(config);
  return {
    schema: STORAGE_DOCTOR_SCHEMA,
    namespaces,
    healthy: namespaces.every((n) => n.marker === 'verified'),
  };
}

async function diagnoseLocal(config: ConfigLike): Promise<NamespaceDiagnosis[]> {
  const out: NamespaceDiagnosis[] = [];
  for (const root of LOCAL_ROOTS) {
    const resolved = resolveLocalRoot(config.get(root.env) as string | undefined, root.dir);
    const base = {
      namespace: root.namespace,
      driver: 'local' as const,
      rootSource: resolved.source,
    };
    try {
      const marker = await readLocalRootMarker(resolved.path);
      if (!marker) out.push({ ...base, marker: 'absent', rootId: null });
      else if (marker.namespace !== root.namespace)
        out.push({ ...base, marker: 'mismatch', rootId: null });
      else out.push({ ...base, marker: 'verified', rootId: marker.rootId });
    } catch (err) {
      if (err instanceof StorageRootMismatchError) {
        out.push({ ...base, marker: 'mismatch', rootId: null });
      } else {
        out.push({
          ...base,
          marker: 'unverifiable',
          rootId: null,
          outcome: classifyStorageFault(err),
        });
      }
    }
  }
  return out;
}

async function diagnoseS3(config: ConfigLike): Promise<NamespaceDiagnosis[]> {
  // Lazy: a local-driver process must never load the AWS SDK for a diagnosis.
  const { S3Client } = await import('@aws-sdk/client-s3');
  const { S3BucketRootGuard } = await import('./s3-storage-root');
  const endpoint = config.get('S3_ENDPOINT') as string | undefined;
  const id = config.get('S3_ACCESS_KEY_ID') as string | undefined;
  const secret = config.get('S3_SECRET_ACCESS_KEY') as string | undefined;
  const client = new S3Client({
    region: (config.get('S3_REGION') as string | undefined) ?? 'us-east-1',
    ...(endpoint ? { endpoint, forcePathStyle: Boolean(config.get('S3_FORCE_PATH_STYLE')) } : {}),
    ...(id && secret ? { credentials: { accessKeyId: id, secretAccessKey: secret } } : {}),
  });
  try {
    const out: NamespaceDiagnosis[] = [];
    for (const b of S3_BUCKETS) {
      let bucket = config.get(b.env) as string | undefined;
      // The restricted bucket falls back to S3_BUCKET in env.schema; diagnose
      // what the adapter would actually use, and let the marker say if it is wrong.
      if (!bucket && b.namespace === 'restricted') bucket = config.get('S3_BUCKET') as string;
      const base = { namespace: b.namespace, driver: 's3' as const };
      if (!bucket) {
        out.push({ ...base, marker: 'unverifiable', rootId: null, outcome: 'misconfigured' });
        continue;
      }
      const guard = new S3BucketRootGuard(() => client);
      try {
        const found = await guard.check(bucket, b.namespace);
        out.push({
          ...base,
          bucketRef: bucketRef(bucket),
          marker: found.state,
          rootId: found.state === 'verified' ? found.marker.rootId : null,
          ...(found.state === 'unverifiable' ? { outcome: found.outcome } : {}),
        });
      } catch (err) {
        if (!(err instanceof StorageRootMismatchError)) throw err;
        out.push({ ...base, bucketRef: bucketRef(bucket), marker: 'mismatch', rootId: null });
      }
    }
    return out;
  } finally {
    client.destroy();
  }
}
