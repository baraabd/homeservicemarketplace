import { z } from 'zod';

const nodeEnv = z.enum(['development', 'test', 'staging', 'production']);

const trueish = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()),
  );

const baseEnvSchema = z.object({
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

  // Sprint 4 — Mongo is OFF by default. See docs/adr/0002-mongodb.md.
  //
  // A code search across apps/api/src found zero domain consumers: two
  // schemas are declared and wired as providers, and nothing injects either
  // one. The only reader of MongoService is the health check that reports on
  // it — so the database existed to be health-checked, and an outage in a
  // store serving no traffic could mark the whole API not-ready.
  //
  // Enabling it is now explicit. When disabled, no connection is opened and
  // readiness does not mention it.
  MONGODB_ENABLED: trueish.default(false),
  // Optional, because with MONGODB_ENABLED=false there is nothing to connect
  // to. The refinement below makes it required exactly when it is used, so
  // "enabled but unconfigured" still fails at boot rather than at first ping.
  MONGODB_URI: z.string().min(1).optional(),
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

  // ── Sprint 6: transactional outbox ──────────────────────────────────────
  // docs/adr/0004-transactional-outbox.md
  //
  // Every API replica runs a worker; they coordinate through the claim
  // statement (FOR UPDATE SKIP LOCKED), not through configuration.
  //
  // Off ONLY for tests and one-shot processes. With it off, events accumulate
  // in the table and are delivered by whichever replica has it on — nothing is
  // lost, but nothing is delivered either, so a deployment with it off
  // everywhere is an outage that looks like silence.
  OUTBOX_WORKER_ENABLED: trueish.default(true),
  // Rows claimed per tick. Larger batches amortise the claim round-trip;
  // smaller ones spread work more evenly across replicas and shorten the
  // window a crash can orphan.
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(1000).default(50),
  // Idle poll interval. A full batch skips the wait entirely and re-polls
  // immediately, so this bounds LATENCY WHEN IDLE, not throughput.
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  // How long a PROCESSING row may sit before it is presumed orphaned by a
  // dead worker and returned to the queue. MUST exceed the slowest handler:
  // set it too low and a healthy slow handler is reclaimed underneath itself,
  // so the event runs twice concurrently (survivable — the idempotency marker
  // catches it — but wasted work).
  OUTBOX_CLAIM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  OUTBOX_RETRY_BASE_MS: z.coerce.number().int().positive().default(1_000),
  OUTBOX_RETRY_CAP_MS: z.coerce.number().int().positive().default(300_000),
  // How long PROCESSED rows are kept before the cleanup job reaps them. They
  // are an audit trail with a short useful life. DEAD rows are never reaped.
  OUTBOX_RETENTION_HOURS: z.coerce.number().int().positive().default(72),
  OUTBOX_CLEANUP_INTERVAL_MS: z.coerce.number().int().positive().default(3_600_000),
  // Recipients per notification batch during fan-out. Bounds the size of a
  // single transaction: one 10,000-recipient INSERT would hold locks and bloat
  // WAL, and a failure would redo all of it.
  OUTBOX_FANOUT_BATCH_SIZE: z.coerce.number().int().positive().max(5_000).default(200),

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

  // NOTE: AUTH_SESSION_CACHE_TTL_SECONDS was removed in the D-2 remediation.
  // It bounded how long a cached per-USER "in good standing" flag could keep
  // an access token alive after revocation. The per-request check now reads
  // the Session row itself with no positive cache, so there is no staleness
  // window left to configure. Unknown env keys are stripped by this schema,
  // so a deployment that still sets the old variable boots normally.

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

  // --- Rate limiting (D-1) -------------------------------------------------
  // Registration abuse budget. PRODUCTION DEFAULT IS 5 SUBMISSIONS PER
  // ROLLING HOUR and production refuses to boot with a higher value (see
  // env.validation.ts). The override exists so test/dev suites that create
  // many accounts in a row are not throttled — it is NOT a production knob.
  AUTH_REGISTER_THROTTLE_LIMIT: z.coerce.number().int().positive().default(5),
  AUTH_REGISTER_THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  // Number of trusted reverse-proxy hops in front of the API. Express's
  // `trust proxy` is set to exactly this number, so the client IP is taken
  // from the Nth-from-the-right X-Forwarded-For entry and a caller-supplied
  // header cannot forge it. 0 (default) = the API is directly exposed and
  // X-Forwarded-For is IGNORED entirely. Never set this higher than the real
  // number of proxies you control: each extra hop lets the client prepend one
  // forged address and walk out of its own rate-limit bucket.
  TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().max(10).default(0),

  // ── Sprint 3: HTTP response hardening ──────────────────────────────────
  //
  // CSP is rolled out in stages rather than switched on, because a policy
  // that is wrong the first time breaks the app for everyone at once and the
  // usual response is to delete it. 'report-only' ships the header as
  // Content-Security-Policy-Report-Only: browsers evaluate it, report what
  // WOULD have been blocked, and block nothing. Once the reports are quiet,
  // 'enforce' flips the same policy to the enforcing header — no directive
  // changes, so the enforcing step cannot surprise anyone.
  //
  // 'off' exists for one reason: a policy that is actively breaking
  // production must be switchable off with an env var, not a redeploy.
  CSP_MODE: z.enum(['off', 'report-only', 'enforce']).default('report-only'),

  // HSTS max-age in seconds, ramped deliberately.
  //
  // HSTS is the one header a mistake in which cannot be withdrawn: once a
  // browser has pinned the directive it refuses plaintext for the full
  // max-age no matter what the server later sends. So the default is 300 (5
  // minutes) — long enough to be real, short enough that a bad rollout ages
  // out within a coffee break. The documented ramp is 300 -> 86400 -> 2592000
  // -> 31536000, and preload/includeSubDomains only at the end, once every
  // subdomain is known to serve TLS.
  HSTS_MAX_AGE_SECONDS: z.coerce.number().int().nonnegative().max(63_072_000).default(300),
  HSTS_INCLUDE_SUBDOMAINS: trueish.default(false),
  HSTS_PRELOAD: trueish.default(false),

  // Bearer token required to scrape /metrics.
  //
  // The endpoint publishes request volumes, latencies and error rates — a
  // free map of which routes exist and which are failing. It was previously
  // unauthenticated, with a comment deferring the problem to "network policy
  // / reverse-proxy rules", which is a control this repo neither owns nor
  // tests.
  //
  // Optional so local runs and existing scrapers are not broken by an
  // upgrade. When it IS set the endpoint requires it; when it is NOT set in
  // production the endpoint stops existing (404) rather than serving to
  // anyone who asks. Health probes are unaffected — they live on
  // /health/live and /health/ready and are never gated by this.
  METRICS_TOKEN: z.string().min(16).optional(),

  // Rate-limit counters live in Redis so the budget is shared across API
  // replicas. When Redis is unreachable at request time the limiter FAILS
  // CLOSED (429) rather than silently degrading to a per-instance in-memory
  // count an attacker could bypass by spraying replicas. Set false only for
  // single-instance local runs without Redis; production rejects false.
  THROTTLE_REDIS_REQUIRED: trueish.default(true),

  // Sprint 7.0 (refined) — Socket.IO realtime gateway feature flag.
  // When `off`, the gateway closes every handshake at the door and
  // the polling fallback (Sprint 5.5 cadences) is the sole channel.
  // When `on`, the gateway accepts JWT-authed handshakes and (if a
  // Redis client is healthy) wires @socket.io/redis-adapter for
  // multi-instance fan-out. Default: off in dev/test so existing
  // suites are unaffected; flip to on once REDIS is provisioned.
  REALTIME_SOCKET_IO: trueish.default(false),

  // D-4 — cross-instance realtime security.
  //
  // Socket eviction after logout / suspension / provider-status change relies
  // on Socket.IO's Redis adapter to reach sockets held by OTHER API replicas.
  // Without it, a revocation served by pod A silently leaves the victim's
  // socket alive on pod B — the security control appears to work and does not.
  //
  // So: when REALTIME_SOCKET_IO is on and the Redis adapter cannot be wired,
  // a production/staging boot FAILS. Set this to true ONLY for a deployment
  // you know runs exactly one API instance; it is an explicit, auditable
  // acknowledgement that cross-instance eviction is not available, not a
  // convenience toggle.
  REALTIME_ALLOW_SINGLE_INSTANCE: trueish.default(false),

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

// Sprint 4 — "enabled but unconfigured" must fail at BOOT, not at the first
// ping. Leaving MONGODB_URI unconditionally optional would let the API start
// with MONGODB_ENABLED=true and no URI, and the only symptom would be a
// readiness check going down some seconds later.
//
// Kept as a refinement on a named base schema rather than chained directly
// onto the object literal: chaining re-indents all 200+ lines of the object
// and buries a four-line behaviour change in a whole-file diff.
export const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  if (env.MONGODB_ENABLED && !env.MONGODB_URI) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MONGODB_URI'],
      message: 'MONGODB_URI is required when MONGODB_ENABLED=true',
    });
  }
});

export type AppEnv = z.infer<typeof envSchema>;
