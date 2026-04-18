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
});

export type AppEnv = z.infer<typeof envSchema>;
