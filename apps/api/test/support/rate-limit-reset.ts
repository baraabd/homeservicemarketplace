import type Redis from 'ioredis';

// Sprint 09B.29 Phase 4 — one definition of "clear this harness's own rate
// budget", instead of a slightly different copy in every integration suite.
//
// WHY IT IS NEEDED AT ALL
//
// The rate limiters are real and Redis-backed, and they are keyed by CALLER
// IP. Every integration suite calls the API from 127.0.0.1, so they all share
// one budget: `POST /auth/login` allows 10 per minute per IP, and a run with
// several suites signing in concurrently exhausts it. The resulting 429 is a
// fact about the harness — about how many suites happened to be in flight —
// and it lands on whichever assertion was unlucky.
//
// WHY THIS DOES NOT HIDE A THROTTLE REGRESSION
//
// Nothing that ASSERTS a throttle asserts it from loopback:
//
//   registration-throttle.integration.spec.ts  drives synthetic 198.51.100.x
//                                              identities
//   auth.e2e.spec.ts                           is hermetic, with no Redis
//
// So the budgets cleared here are exactly the ones no test is watching. A real
// regression in the limiter still fails in the suites that exist to catch it.
//
// This is the same technique `provider-journey.integration.spec.ts` has used
// for the registration budget since Sprint 9; it is extended here to the
// generic `@Throttle` bucket because Phase 4's durability proofs sign in and
// out far more often than any earlier suite.

/** The Redis prefix `RateLimitStore` writes every bucket under. */
const PREFIX = 'rl:';

/**
 * Clear the auth rate budgets this process is about to consume.
 *
 * @param redis      the application's own Redis client
 * @param identities extra identities to clear alongside loopback, typically
 *                   the email addresses the suite registers
 */
export async function clearAuthRateBudget(
  redis: Redis,
  identities: readonly string[] = [],
): Promise<void> {
  const all = ['127.0.0.1', '::1', '::ffff:127.0.0.1', ...identities];

  // The named registration buckets, whose keys embed the identity verbatim.
  const named = all.flatMap((id) => [
    `${PREFIX}auth:register:ip:${id}`,
    `${PREFIX}auth:register:ip:${id}:blocked`,
    `${PREFIX}auth:register:email:${id}`,
    `${PREFIX}auth:register:email:${id}:blocked`,
  ]);
  if (named.length > 0) await redis.del(...named);

  // The generic `@Throttle` buckets — login, verify-otp, refresh. `@nestjs/
  // throttler` hashes the tracker into the key, so the IP cannot be matched by
  // pattern and the whole bucket is cleared. SCAN rather than KEYS: this runs
  // against a live server and a blocking full keyspace walk is a bad habit to
  // put in a helper, even one that only ever meets a test database.
  const doomed: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${PREFIX}throttler:*`, 'COUNT', 500);
    cursor = next;
    doomed.push(...batch);
  } while (cursor !== '0');
  if (doomed.length > 0) await redis.del(...doomed);
}
