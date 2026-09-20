import { z } from 'zod';
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  DISPUTE_WORKER_MODE: z.enum(['off', 'shadow', 'enforce']).default('off'),
  DISPUTE_WORKER_INTERVAL_MS: z.coerce.number().int().min(1000).max(3600000).default(30000),
  DISPUTE_WORKER_BATCH: z.coerce.number().int().min(1).max(50).default(10),
  DISPUTE_WORKER_PORT: z.coerce.number().int().min(1024).max(65535).default(9092),
  DISPUTE_PRIVATE_ACTIVE_KEY: z.string().default(''),
  DISPUTE_PRIVATE_KEYS_JSON: z.string().default(''),
  DISPUTE_WORKER_APPROVAL_REF: z.string().default(''),
  DISPUTE_WORKER_INFRA_REF: z.string().default(''),
  METRICS_TOKEN: z.string().default(''),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  RESTRICTED_STORAGE_DIR: z.string().default(''),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_RESTRICTED_BUCKET: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
  EVIDENCE_SCANNER_DRIVER: z.enum(['none', 'test', 'clamav']).default('none'),
  CLAMAV_HOST: z.string().default(''),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(15000),
});
/** References are operator inputs, not evidence of Product/Privacy approval. */
export function workspaceWorkerConfig(env: NodeJS.ProcessEnv) {
  const p = schema.safeParse(env);
  if (!p.success) throw new Error('dispute-worker-invalid-configuration');
  const c = p.data;
  const hardened = ['production', 'staging'].includes(c.NODE_ENV);
  if (
    c.DISPUTE_WORKER_MODE !== 'off' &&
    (!c.METRICS_TOKEN || (hardened && c.METRICS_TOKEN.length < 32))
  )
    throw new Error('dispute-worker-metrics-token-required');
  if (c.DISPUTE_WORKER_MODE === 'enforce') {
    if (!c.DISPUTE_WORKER_APPROVAL_REF || !c.DISPUTE_WORKER_INFRA_REF)
      throw new Error('dispute-worker-approval-references-required');
    if (
      c.EVIDENCE_SCANNER_DRIVER === 'none' ||
      (c.EVIDENCE_SCANNER_DRIVER === 'test' && c.NODE_ENV !== 'test')
    )
      throw new Error('dispute-worker-real-scanner-required');
    if (c.EVIDENCE_SCANNER_DRIVER === 'clamav' && !c.CLAMAV_HOST)
      throw new Error('dispute-worker-scanner-host-required');
    if (c.STORAGE_DRIVER === 'local' && !c.RESTRICTED_STORAGE_DIR.startsWith('/'))
      throw new Error('dispute-worker-absolute-root-required');
    if (c.STORAGE_DRIVER === 's3' && !c.S3_RESTRICTED_BUCKET)
      throw new Error('dispute-worker-restricted-bucket-required');
    if (hardened && c.S3_ENDPOINT && new URL(c.S3_ENDPOINT).protocol !== 'https:')
      throw new Error('dispute-worker-storage-tls-required');
    if (Boolean(c.S3_ACCESS_KEY_ID) !== Boolean(c.S3_SECRET_ACCESS_KEY))
      throw new Error('dispute-worker-storage-credentials-incomplete');
  }
  return c;
}
