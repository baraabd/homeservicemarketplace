import {
  DEFAULT_RETRY_POLICY,
  effectiveMaxAttempts,
  MAX_ATTEMPTS_CEILING,
  nextAttemptAt,
  nextAttemptDelayMs,
} from './outbox.retry';

// R22 — the retry schedule is pure, so its bounds are pinned here exactly.
describe('outbox retry policy', () => {
  const mid = () => 0.5; // zero jitter: (0.5 * 2 - 1) = 0

  it('doubles from the base and caps at capMs', () => {
    const delays = [1, 2, 3, 4, 5, 6, 7].map((a) =>
      nextAttemptDelayMs(a, 25, { baseMs: 1_000, capMs: 10_000, jitter: 0 }, mid),
    );
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000]);
  });

  it('keeps jitter within ±jitter of the capped delay and never negative', () => {
    const policy = { baseMs: 1_000, capMs: 300_000, jitter: 0.2 };
    expect(nextAttemptDelayMs(3, 8, policy, () => 0)).toBe(3_200);
    expect(nextAttemptDelayMs(3, 8, policy, () => 0.999999)).toBe(4_800);
    expect(nextAttemptDelayMs(1, 8, { ...policy, jitter: 5 }, () => 0)).toBe(0);
  });

  it('returns null once the budget is spent', () => {
    expect(nextAttemptDelayMs(7, 8, DEFAULT_RETRY_POLICY, mid)).not.toBeNull();
    expect(nextAttemptDelayMs(8, 8, DEFAULT_RETRY_POLICY, mid)).toBeNull();
    expect(nextAttemptAt(8, 8, new Date(0), DEFAULT_RETRY_POLICY, mid)).toBeNull();
  });

  it('bounds a producer-supplied budget by the ceiling', () => {
    expect(effectiveMaxAttempts(1_000_000)).toBe(MAX_ATTEMPTS_CEILING);
    expect(
      nextAttemptDelayMs(MAX_ATTEMPTS_CEILING, 1_000_000, DEFAULT_RETRY_POLICY, mid),
    ).toBeNull();
  });

  it('treats a corrupt budget as one attempt, never as unlimited', () => {
    for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(effectiveMaxAttempts(bad)).toBe(1);
    }
    expect(nextAttemptDelayMs(1, Number.NaN, DEFAULT_RETRY_POLICY, mid)).toBeNull();
  });

  it('lets a retry-after hint lengthen the delay but never past the cap', () => {
    const policy = { baseMs: 1_000, capMs: 60_000, jitter: 0 };
    expect(nextAttemptDelayMs(1, 8, policy, mid, 30_000)).toBe(30_000);
    expect(nextAttemptDelayMs(1, 8, policy, mid, 10 * 60_000)).toBe(60_000);
    // A shorter hint cannot shorten the schedule.
    expect(nextAttemptDelayMs(5, 8, policy, mid, 1)).toBe(16_000);
    // Garbage hints are ignored.
    expect(nextAttemptDelayMs(1, 8, policy, mid, -5)).toBe(1_000);
    expect(nextAttemptDelayMs(1, 8, policy, mid, Number.NaN)).toBe(1_000);
  });

  it('computes the absolute time from the supplied clock', () => {
    const at = nextAttemptAt(1, 8, new Date(10_000), { baseMs: 500, capMs: 500, jitter: 0 }, mid);
    expect(at?.getTime()).toBe(10_500);
  });
});
