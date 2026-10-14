// R27 — summary statistics for repeated measurements.
//
// Percentiles use the nearest-rank method on the sorted sample, so a
// reported p95 is always an observed value, never an interpolation that no
// run produced. With fewer than 20 samples p95 equals the maximum and p99
// is meaningless; `summarize` says so instead of printing a number that
// looks more precise than the sample allows.

/** Nearest-rank percentile of an ascending-sorted array (p in (0, 100]). */
export function percentile(sorted, p) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  if (!(p > 0 && p <= 100)) throw new RangeError(`percentile out of range: ${p}`);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

const round = (value) => (value === null ? null : Math.round(value * 100) / 100);

/**
 * Summarise finite numeric samples. Non-finite values are counted as
 * invalid, not silently dropped, so a run with failed observations cannot
 * look like a smaller clean run.
 */
export function summarize(samples) {
  const valid = samples.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const sorted = [...valid].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = n ? sorted.reduce((sum, v) => sum + v, 0) / n : null;
  return {
    n,
    invalid: samples.length - n,
    min: round(n ? sorted[0] : null),
    p50: round(percentile(sorted, 50)),
    p95: round(n >= 20 ? percentile(sorted, 95) : null),
    p99: round(n >= 100 ? percentile(sorted, 99) : null),
    max: round(n ? sorted[n - 1] : null),
    mean: round(mean),
    confidence:
      n >= 100 ? 'p99-reportable' : n >= 20 ? 'p95-reportable' : n > 0 ? 'median-only' : 'none',
  };
}
