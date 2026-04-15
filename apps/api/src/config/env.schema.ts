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

  // Auth env vars are intentionally NOT part of the infrastructure baseline.
  // They will be added when the auth module is reintroduced in a later phase.
});

export type AppEnv = z.infer<typeof envSchema>;
