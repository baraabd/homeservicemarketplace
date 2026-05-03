import { z } from 'zod';

const nodeEnv = z.enum(['development', 'test', 'staging', 'production']);

const trueish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
  );

export const envSchema = z.object({
  NODE_ENV: nodeEnv.default('development'),
  APP_ENV: z.enum(['dev', 'test', 'staging', 'prod']).default('dev'),

  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  METRICS_PORT: z.coerce.number().int().min(1).max(65_535).optional(),

  FRONTEND_URL: z.string().url().optional(),
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    ),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: z.string().min(1).default('homeservicemarketplace'),
  MONGODB_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  MONGODB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().positive().default(20),

  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().min(1).max(65_535).default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().nonnegative().default(0),
  REDIS_TLS: trueish.default(false),
  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  STARTUP_MAX_RETRIES: z.coerce.number().int().positive().default(5),
  STARTUP_RETRY_BASE_MS: z.coerce.number().int().positive().default(200),
  STARTUP_RETRY_CAP_MS: z.coerce.number().int().positive().default(5_000),

  // --- IAM / Auth ---------------------------------------------------------
  // HS256 symmetric secret. 32+ bytes enforced. Production should migrate to
  // RS256 with an external KMS; see docs/iam.md.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  JWT_ISSUER: z.string().min(1).default('hsm-api'),
  JWT_AUDIENCE: z.string().min(1).default('hsm-clients'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(15),

  AUTH_LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
  AUTH_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  // Lower bound on response time for anti-enumeration endpoints
  // (register / forgot-password / resend-verification). Must exceed the
  // upper envelope of the existing-user code path or timing leaks the answer.
  // Set to 0 in test environments to keep tests fast.
  AUTH_ANTI_ENUM_DELAY_MS: z.coerce.number().int().nonnegative().default(200),

  // When false, registration auto-verifies the user (sets emailVerifiedAt +
  // status=ACTIVE) so login works immediately without real mail delivery.
  // Must be true in production. Safe to set false for local dev and QA.
  AUTH_REQUIRE_EMAIL_VERIFICATION: trueish.default(true),

  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: trueish.default(true),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  PERMISSION_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  // Sprint 7.0 (refined) — Socket.IO realtime gateway feature flag.
  // When `off`, the gateway closes every handshake at the door and
  // the polling fallback (Sprint 5.5 cadences) is the sole channel.
  // When `on`, the gateway accepts JWT-authed handshakes and (if a
  // Redis client is healthy) wires @socket.io/redis-adapter for
  // multi-instance fan-out. Default: off in dev/test so existing
  // suites are unaffected; flip to on once REDIS is provisioned.
  REALTIME_SOCKET_IO: trueish.default(false),

  // Provider take-rate (Sprint 5.6 earnings read model). Marketplace fee
  // expressed in basis points (1 bp = 0.01%). 1000 = 10% take, 0 = fee-
  // free, 10000 = 100%. The earnings service computes platform fees as
  // round(gross * BPS / 10000) per row and per aggregate. When the
  // payouts module ships this value moves into a per-tier rate table —
  // until then a single env-driven rate is the right granularity.
  PROVIDER_PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(1000),

  // --- SMTP / Mail ---------------------------------------------------------
  // When SMTP_HOST is set the API uses Nodemailer; otherwise InMemoryMailAdapter.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(1025),
  SMTP_SECURE: trueish.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('noreply@homeservicemarketplace.local'),

  // --- Storage / Media uploads ---------------------------------------------
  // STORAGE_DRIVER=local (default) → LocalDiskStorageAdapter writes to
  //   LOCAL_STORAGE_DIR (default: <repo>/.media-uploads, gitignored). The
  //   API serves uploads via signed PUT + public GET routes the controller
  //   exposes — no external dependency, suitable for dev / CI.
  // STORAGE_DRIVER=s3                → S3StorageAdapter, browser PUTs go
  //   directly to S3-compatible storage (AWS, R2, MinIO, DO Spaces). The
  //   adapter requires S3_BUCKET + S3_REGION at minimum; credentials follow
  //   the AWS SDK provider chain unless S3_ACCESS_KEY_ID + _SECRET are set.
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().optional(),

  // Used by the LocalDiskStorageAdapter to HMAC-sign upload tokens.
  // Optional: when unset the adapter falls back to JWT_ACCESS_SECRET.
  // Production deploys SHOULD set a dedicated secret so the two
  // contexts (auth vs media tokens) can be rotated independently.
  MEDIA_SIGNING_SECRET: z.string().optional(),

  // Public origin the LocalDiskStorageAdapter embeds in presigned URLs
  // it returns to the browser. Falls back to http://localhost:<PORT>
  // for dev. In preview / prod set this to the externally-visible
  // origin of the API (e.g. https://api.example.com).
  PUBLIC_API_URL: z.string().optional(),

  // S3-only env. None is required when STORAGE_DRIVER=local; the
  // adapter throws a clear error at presign time if S3 is selected
  // without a bucket.
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().optional(),
  S3_FORCE_PATH_STYLE: trueish.default(false),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;
