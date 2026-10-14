// Sprint 6 — outbox retry policy. Pure, so it is testable without clocks or
// databases and so the schedule can be reasoned about by reading a table
// rather than by running the worker.

export interface RetryPolicy {
  /** Delay before attempt 1's retry, ms. */
  baseMs: number;
  /** Ceiling on any single delay, ms. Without it, attempt 8 of an
   *  exponential schedule lands hours away and a transient outage turns into
   *  a queue that looks stuck long after the cause is fixed. */
  capMs: number;
  /** Fraction of the delay randomised, 0..1. */
  jitter: number;
}

/** R22 — an absolute ceiling on any event's retry budget.
 *
 *  `maxAttempts` is producer-supplied per row. Without a ceiling a producer
 *  that writes `maxAttempts: 1_000_000` creates an event that can never reach
 *  the dead-letter state, and a poison event like that retries every capped
 *  interval forever. The default budget (8) is far below this. */
export const MAX_ATTEMPTS_CEILING = 25;

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseMs: 1_000,
  capMs: 300_000, // 5 minutes
  jitter: 0.2,
};

/** When to retry after `attempts` failures, or null when the budget is spent.
 *
 *  Exponential: base * 2^(attempts-1), capped. With the defaults that is
 *
 *      1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s      (attempts 1..8)
 *
 *  so the default budget of 8 attempts spans a little over four minutes of
 *  wall clock — long enough to ride out a dependency restart, short enough
 *  that a genuinely broken event reaches the dead-letter state while the
 *  deploy that broke it is still the obvious suspect.
 *
 *  Jitter is not decoration. Without it, a batch of events failing against
 *  one downed dependency retries in lockstep forever, and every retry wave
 *  hits the recovering dependency simultaneously — the thundering herd that
 *  keeps it down. ±20% is enough to smear the waves apart.
 *
 *  `random` is injected so tests can pin the schedule exactly. */
export function nextAttemptDelayMs(
  attempts: number,
  maxAttempts: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
  /** R22 — a handler's Retry-After style hint. It can only LENGTHEN the delay
   *  and never past the cap, so a handler cannot park an event indefinitely. */
  minDelayMs?: number,
): number | null {
  if (attempts >= effectiveMaxAttempts(maxAttempts)) return null;

  const exponential = policy.baseMs * 2 ** Math.max(0, attempts - 1);
  const capped = Math.min(exponential, policy.capMs);

  // Symmetric jitter around the capped delay. Clamped at zero so a jitter
  // factor > 1 (a misconfiguration) cannot produce a negative delay, which
  // would make the event immediately claimable and spin the worker.
  const spread = capped * policy.jitter;
  const delta = (random() * 2 - 1) * spread;
  const jittered = Math.max(0, Math.round(capped + delta));
  if (minDelayMs === undefined || !(minDelayMs > 0)) return jittered;
  return Math.max(jittered, Math.min(Math.round(minDelayMs), policy.capMs));
}

/** The budget actually enforced: the row's own `maxAttempts`, bounded to
 *  [1, MAX_ATTEMPTS_CEILING]. A non-finite or non-positive value (a corrupt or
 *  hand-edited row) is treated as 1 — one try, then dead — never as
 *  "unlimited". */
export function effectiveMaxAttempts(maxAttempts: number): number {
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1) return 1;
  return Math.min(Math.floor(maxAttempts), MAX_ATTEMPTS_CEILING);
}

/** The absolute time an event becomes claimable again, or null for dead. */
export function nextAttemptAt(
  attempts: number,
  maxAttempts: number,
  now: Date,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  random: () => number = Math.random,
  minDelayMs?: number,
): Date | null {
  const delay = nextAttemptDelayMs(attempts, maxAttempts, policy, random, minDelayMs);
  return delay === null ? null : new Date(now.getTime() + delay);
}
