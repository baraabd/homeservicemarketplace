// Sprint 9B.20 — how fast a provider actually answers, measured rather than asked.
//
// docs/sprint-09b20/EARNED_SERVICE_AREA.md
//
// The gap between two SERVER-STAMPED timestamps: when the request was created,
// and when this provider's bid arrived. Neither is writable by the provider,
// which is the entire reason this is computed here instead of reading
// `Bid.responseTimeMinutes` — that field is the provider's own ETA, submitted
// with the bid, and using it would mean typing "5" to earn a wider service
// area.
//
// Pure, so the statistic can be tested without a database and cannot quietly
// grow a query.

/**
 * How many recent bids the median is taken over.
 *
 * Bounded on purpose. A lifetime median is dominated by whatever the provider
 * was doing a year ago and takes months to reflect that they have improved,
 * which makes the criterion feel arbitrary to the person trying to clear it.
 */
export const RESPONSE_SAMPLE_SIZE = 50;

export interface ResponseObservation {
  requestCreatedAt: Date;
  bidSubmittedAt: Date;
}

/**
 * The median response, in whole minutes, over the most recent observations.
 *
 * `percentile_disc` semantics — the LOWER of the two middles on an even count,
 * never their average. An average of two middles invents a value that is not
 * in the data and lands on a half-minute, which then has to be rounded, which
 * is one more place an eligibility boundary can be decided by a rounding rule
 * nobody wrote down.
 *
 * Callers pass observations newest-first; only the first RESPONSE_SAMPLE_SIZE
 * are used.
 */
export function medianResponseMinutes(observations: readonly ResponseObservation[]): {
  median: number | null;
  sampleSize: number;
} {
  const minutes = observations
    .slice(0, RESPONSE_SAMPLE_SIZE)
    .map(toMinutes)
    .filter((m): m is number => m !== null)
    .sort((a, b) => a - b);

  if (minutes.length === 0) return { median: null, sampleSize: 0 };
  // Lower middle: index (n-1)/2 floored. n=4 -> 1, n=5 -> 2.
  const index = Math.floor((minutes.length - 1) / 2);
  return { median: minutes[index]!, sampleSize: minutes.length };
}

/**
 * One observation in whole minutes, floored, or null when the pair cannot
 * describe a response.
 *
 * A bid stamped BEFORE its request is not a fast reply, it is a clock problem
 * or a backfill, and counting it as zero would hand out the best possible
 * score for corrupt data. Dropped rather than clamped.
 */
function toMinutes(o: ResponseObservation): number | null {
  const ms = o.bidSubmittedAt.getTime() - o.requestCreatedAt.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 60_000);
}
