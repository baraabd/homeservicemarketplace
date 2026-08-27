import { envSchema, type AppEnv } from './env.schema';

// D-1 — the registration abuse budget is a security control, so a permissive
// value must not be reachable in production by mis-setting an env var. The
// schema defaults to 5/hour; these rules make production REFUSE TO BOOT when
// an operator tries to widen it, while leaving test/dev free to raise it so
// suites that create many accounts back to back are not throttled.
export const PRODUCTION_MAX_REGISTER_THROTTLE_LIMIT = 5;

// Environments where a widened registration budget / non-shared throttle store
// is acceptable. Anything else (production, staging) is held to the hard cap.
const RELAXABLE_ENVS = new Set(['development', 'test']);

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

  return env;
}
