import { z } from 'zod';
import { retentionPolicySchema } from './retention-policy';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  EVIDENCE_RETENTION_MODE: z.enum(['off', 'shadow', 'enforce']).default('off'),
  DATABASE_URL: z.string().url(),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  RESTRICTED_STORAGE_DIR: z.string().default(''),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_RESTRICTED_BUCKET: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
  EVIDENCE_RETENTION_APPROVAL_REF: z.string().default(''),
  EVIDENCE_RETENTION_INFRA_REF: z.string().default(''),
  EVIDENCE_RETAIN_VERIFIED_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  EVIDENCE_RETAIN_REJECTED_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  EVIDENCE_RETAIN_ABANDONED_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  EVIDENCE_RETAIN_QUARANTINE_DAYS: z.coerce.number().int().min(1).max(3650).default(180),
  EVIDENCE_RETENTION_KEEP_CHECKSUM: z.enum(['true', 'false']).default('false'),
  EVIDENCE_RETENTION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  EVIDENCE_RETENTION_INTERVAL_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
  EVIDENCE_RETENTION_BATCH: z.coerce.number().int().min(1).max(100).default(25),
  EVIDENCE_RETENTION_PORT: z.coerce.number().int().min(1024).max(65535).default(9091),
  METRICS_TOKEN: z.string().default(''),
});

/** Independent process: no JWT, email, public storage or payment credentials. */
export function retentionWorkerConfig(env: NodeJS.ProcessEnv) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error('retention-worker-invalid-configuration');
  const c = parsed.data;
  const hardened = c.NODE_ENV === 'production' || c.NODE_ENV === 'staging';
  if (c.EVIDENCE_RETENTION_MODE !== 'off') {
    if (hardened && c.METRICS_TOKEN.length < 32)
      throw new Error('retention-worker-metrics-token-required');
    if (c.STORAGE_DRIVER === 's3' && !c.S3_RESTRICTED_BUCKET)
      throw new Error('retention-worker-dedicated-bucket-required');
    if (c.STORAGE_DRIVER === 'local' && !c.RESTRICTED_STORAGE_DIR.startsWith('/'))
      throw new Error('retention-worker-absolute-restricted-root-required');
    if (Boolean(c.S3_ACCESS_KEY_ID) !== Boolean(c.S3_SECRET_ACCESS_KEY))
      throw new Error('retention-worker-incomplete-storage-credentials');
  }
  if (
    c.EVIDENCE_RETENTION_MODE === 'enforce' &&
    (!c.EVIDENCE_RETENTION_APPROVAL_REF || !c.EVIDENCE_RETENTION_INFRA_REF)
  ) {
    throw new Error('retention-worker-approval-references-required');
  }
  const policy = retentionPolicySchema.parse({
    format: 1,
    approvalReference: c.EVIDENCE_RETENTION_APPROVAL_REF || 'UNAPPROVED.SHADOW',
    verifiedDays: c.EVIDENCE_RETAIN_VERIFIED_DAYS,
    rejectedDays: c.EVIDENCE_RETAIN_REJECTED_DAYS,
    abandonedDays: c.EVIDENCE_RETAIN_ABANDONED_DAYS,
    quarantineDays: c.EVIDENCE_RETAIN_QUARANTINE_DAYS,
    maxAttempts: c.EVIDENCE_RETENTION_MAX_ATTEMPTS,
    retainChecksum: c.EVIDENCE_RETENTION_KEEP_CHECKSUM === 'true',
  });
  return { ...c, policy };
}
