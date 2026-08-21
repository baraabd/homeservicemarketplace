import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { AppError } from '../../shared/errors/app-error';
import { RateLimitStore } from './rate-limit.store';

// D-1 — production-safe registration abuse budget.
//
// Before: `@Throttle({ default: { limit: 500, ttl: 3_600_000 } })` on
// POST /v1/auth/register. 500 registrations per hour per IP is not a rate
// limit, and because the throttler store was in-memory the real budget was
// 500 × replicas.
//
// Now: the production default is exactly 5 submissions per rolling hour, the
// counters are shared across replicas (Redis), and production refuses to boot
// with a wider limit (see config/env.validation.ts).
//
// ── Throttle identity ────────────────────────────────────────────────────────
// TWO independent buckets are charged on every attempt, and either one can
// reject the request:
//
//   auth:register:ip     keyed by the client IP resolved through the
//                        configured trusted-proxy depth. Stops one abusive
//                        source from cycling through fresh email addresses to
//                        get a fresh budget each time.
//
//   auth:register:email  keyed by the NORMALISED email (trimmed + lowercased),
//                        so `Foo@Example.com `, `foo@example.com`, and
//                        `  FOO@EXAMPLE.COM` all share one budget. Stops a
//                        distributed source from re-sending registration mail
//                        to one victim address.
//
// Both are charged before the outcome is known, so a duplicate-email
// submission and a fresh-email submission consume exactly the same budget and
// receive exactly the same 429 — the limiter cannot be used as an account
// enumeration oracle.
//
// ── Placement ────────────────────────────────────────────────────────────────
// This runs at the top of the controller handler rather than in a guard.
// Nest's pipeline is guards → interceptors → pipes → handler, so a guard would
// charge the budget BEFORE ValidationPipe, letting a stream of malformed
// bodies burn a legitimate user's five attempts. Charging here means the
// budget is spent only by validly shaped submissions, which is exactly the
// acceptance rule: the first five validly shaped attempts reach the
// controller, the sixth is rejected with 429.
@Injectable()
export class RegistrationThrottleService {
  private readonly logger = new Logger(RegistrationThrottleService.name);

  constructor(
    private readonly store: RateLimitStore,
    private readonly config: AppConfigService,
  ) {}

  async assertWithinBudget(params: { ipAddress: string; email: string }): Promise<void> {
    const limit = this.config.get('AUTH_REGISTER_THROTTLE_LIMIT');
    const windowMs = this.config.get('AUTH_REGISTER_THROTTLE_TTL_SECONDS') * 1000;

    const ipIdentity = normalizeIp(params.ipAddress);
    const emailIdentity = normalizeEmailIdentity(params.email);

    // Charge both buckets. They are evaluated together (not short-circuited)
    // so an attacker cannot learn which dimension tripped by timing the
    // response or by observing that only one counter advanced.
    const [byIp, byEmail] = await Promise.all([
      this.store.consume({ bucket: 'auth:register:ip', identity: ipIdentity, limit, windowMs }),
      this.store.consume({
        bucket: 'auth:register:email',
        identity: emailIdentity,
        limit,
        windowMs,
      }),
    ]);

    const blocked = [byIp, byEmail].filter((d) => d.isBlocked);
    if (blocked.length === 0) return;

    const retryAfter = Math.max(...blocked.map((d) => d.secondsUntilBlockExpires));
    // Log the decision, never the email — it is user PII and the whole point
    // of the anti-enumeration work is that registration attempts do not leak
    // which addresses were tried.
    this.logger.warn({
      msg: 'auth.register.throttled',
      byIp: byIp.isBlocked,
      byEmail: byEmail.isBlocked,
      limit,
      retryAfterSeconds: retryAfter,
    });
    throw new RegistrationThrottledError(retryAfter);
  }
}

// Carries the Retry-After value to the controller, which sets the header. A
// dedicated class (rather than a bare AppError) lets the controller recognise
// it without string-matching a code.
export class RegistrationThrottledError extends AppError {
  constructor(public readonly retryAfterSeconds: number) {
    super('RATE_LIMITED', 'Too many registration attempts. Please try again later.', 429);
  }
}

// Normalise so casing / surrounding whitespace cannot mint a fresh bucket.
// This MUST match the normalisation the registration service applies to the
// stored email, or the limiter and the uniqueness check would disagree about
// what "the same account" means.
export function normalizeEmailIdentity(raw: string): string {
  return (raw ?? '').trim().toLowerCase();
}

// IPv6-mapped IPv4 (`::ffff:203.0.113.5`) and the bare form must not be two
// different buckets.
export function normalizeIp(raw: string): string {
  const value = (raw ?? '').trim().toLowerCase();
  if (value.startsWith('::ffff:')) return value.slice('::ffff:'.length);
  return value || 'unknown';
}
