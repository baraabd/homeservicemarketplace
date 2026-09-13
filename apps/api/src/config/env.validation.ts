import { envSchema, type AppEnv } from './env.schema';

// D-1 — the registration abuse budget is a security control, so a permissive
// value must not be reachable in production by mis-setting an env var. The
// schema defaults to 5/hour; these rules make production REFUSE TO BOOT when
// an operator tries to widen it, while leaving test/dev free to raise it so
// suites that create many accounts back to back are not throttled.
export const PRODUCTION_MAX_REGISTER_THROTTLE_LIMIT = 5;

/** The OTP-verification ceiling a hardened environment will boot with. */
const PRODUCTION_MAX_OTP_VERIFY_THROTTLE_LIMIT = 20;

// Environments where a widened registration budget / non-shared throttle store
// is acceptable. Anything else (production, staging) is held to the hard cap.
const RELAXABLE_ENVS = new Set(['development', 'test']);

/**
 * The validated environment, remembered from boot.
 *
 * For the handful of places that genuinely cannot take `AppConfigService`
 * through DI — specifically a `@Throttle` decorator, whose `Resolvable` is
 * handed only an `ExecutionContext`. Everything that CAN inject the config
 * service must keep doing so; this exists so a route-level rate limit can be
 * configured from the same validated source as everything else instead of
 * carrying a second copy of a number that security review already approved.
 */
let validated: AppEnv | null = null;

/**
 * Read the validated environment.
 *
 * Throws rather than falling back to a default. A rate limit that silently
 * reverts to a literal because configuration had not loaded yet is the kind of
 * control that looks present and is not.
 */
export function validatedEnv(): AppEnv {
  if (validated === null) {
    throw new Error(
      'validatedEnv() was read before the environment was validated — ' +
        'ConfigModule must initialise first.',
    );
  }
  return validated;
}

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;
  const hardened = !RELAXABLE_ENVS.has(env.NODE_ENV);
  const issues: string[] = [];

  if (hardened && env.AUTH_REGISTER_THROTTLE_LIMIT > PRODUCTION_MAX_REGISTER_THROTTLE_LIMIT) {
    issues.push(
      `  - AUTH_REGISTER_THROTTLE_LIMIT: must be <= ${PRODUCTION_MAX_REGISTER_THROTTLE_LIMIT} when NODE_ENV=${env.NODE_ENV} ` +
        `(got ${env.AUTH_REGISTER_THROTTLE_LIMIT})`,
    );
  }

  if (hardened && !env.THROTTLE_REDIS_REQUIRED) {
    issues.push(
      `  - THROTTLE_REDIS_REQUIRED: must be true when NODE_ENV=${env.NODE_ENV} — a per-instance ` +
        `in-memory rate limit is bypassable by spraying replicas`,
    );
  }

  // A shorter window with the same limit is a *tighter* control, so only a
  // longer-than-configured window would be surprising; what must not happen is
  // an effectively-disabled window (e.g. 1 second), which would let an
  // attacker submit 5 per second forever.
  if (hardened && env.AUTH_OTP_VERIFY_THROTTLE_LIMIT > PRODUCTION_MAX_OTP_VERIFY_THROTTLE_LIMIT) {
    issues.push(
      `  - AUTH_OTP_VERIFY_THROTTLE_LIMIT: must be <= ${PRODUCTION_MAX_OTP_VERIFY_THROTTLE_LIMIT} when NODE_ENV=${env.NODE_ENV} ` +
        `(got ${env.AUTH_OTP_VERIFY_THROTTLE_LIMIT})`,
    );
  }

  if (hardened && env.AUTH_OTP_VERIFY_THROTTLE_TTL_SECONDS < 60) {
    issues.push(
      `  - AUTH_OTP_VERIFY_THROTTLE_TTL_SECONDS: must be >= 60 when NODE_ENV=${env.NODE_ENV} ` +
        `(got ${env.AUTH_OTP_VERIFY_THROTTLE_TTL_SECONDS})`,
    );
  }

  if (hardened && env.AUTH_REGISTER_THROTTLE_TTL_SECONDS < 3600) {
    issues.push(
      `  - AUTH_REGISTER_THROTTLE_TTL_SECONDS: must be >= 3600 when NODE_ENV=${env.NODE_ENV} ` +
        `(got ${env.AUTH_REGISTER_THROTTLE_TTL_SECONDS})`,
    );
  }

  // Sprint 9B.14 — the dev shortcut that skips the OTP round-trip entirely.
  //
  // With this false, `register` sets `emailVerifiedAt` and `status: ACTIVE`
  // itself and returns an opaque challenge that will never verify. That is a
  // reasonable convenience locally. In production it means ANY address can be
  // registered and used without ever proving control of the mailbox — account
  // takeover by typo, and a signup funnel with no proof of identity at the
  // bottom of it.
  //
  // The schema already defaults it to true. This makes the unsafe value
  // unreachable rather than merely unusual, which is the same treatment the
  // registration throttle above already gets.
  if (hardened && !env.AUTH_REQUIRE_EMAIL_VERIFICATION) {
    issues.push(
      `  - AUTH_REQUIRE_EMAIL_VERIFICATION: must be true when NODE_ENV=${env.NODE_ENV} — ` +
        `with it off, registration marks accounts verified and ACTIVE without an OTP`,
    );
  }

  if (issues.length > 0) {
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }

  validated = env;
  return env;
}
