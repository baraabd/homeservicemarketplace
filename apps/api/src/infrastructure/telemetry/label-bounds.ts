// R23 — bounded metric labels.
//
// Prometheus keeps one time series per distinct label set, for the whole
// retention period. A label fed from a request path, an error message or an id
// therefore turns every unique value into memory on this process and in the
// metrics backend, and a scanner sending random URLs can grow both without
// limit. Every label value written by the telemetry module passes through one
// of these guards first.

export const OVERFLOW_LABEL = 'other';

/** Accepts only declared values; anything else is reported as `other`. */
export class EnumLabel<T extends string> {
  private readonly allowed: ReadonlySet<string>;

  constructor(values: readonly T[]) {
    this.allowed = new Set(values);
  }

  value(input: unknown): T | typeof OVERFLOW_LABEL {
    return typeof input === 'string' && this.allowed.has(input) ? (input as T) : OVERFLOW_LABEL;
  }
}

/**
 * Admits at most `max` distinct values; later new values collapse into
 * `other`. First come, first kept — a burst of junk after start-up cannot evict
 * the real routes already admitted.
 */
export class CardinalityLimiter {
  private readonly seen = new Set<string>();
  private overflowCount = 0;

  constructor(private readonly max: number) {}

  admit(value: string): string {
    if (this.seen.has(value)) return value;
    if (this.seen.size < this.max) {
      this.seen.add(value);
      return value;
    }
    this.overflowCount += 1;
    return OVERFLOW_LABEL;
  }

  get size(): number {
    return this.seen.size;
  }

  get overflows(): number {
    return this.overflowCount;
  }
}

// Identifier-shaped tokens for job, operation and dependency names: short,
// lower-case, no spaces or path separators. Anything else is a bug in the
// caller, and it is reported as `other` rather than echoed.
const NAME_TOKEN = /^[a-z][a-z0-9_.-]{0,47}$/u;

export function nameToken(input: unknown): string {
  return typeof input === 'string' && NAME_TOKEN.test(input) ? input : OVERFLOW_LABEL;
}

const HTTP_METHODS = new EnumLabel([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
] as const);

export function httpMethodLabel(method: unknown): string {
  return HTTP_METHODS.value(typeof method === 'string' ? method.toUpperCase() : method);
}

export function httpStatusLabel(status: unknown): string {
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? String(status)
    : OVERFLOW_LABEL;
}

/**
 * The matched route pattern (`/v1/bookings/:id`), never the concrete URL. A
 * request that matched no route is `unmatched`: 404 scans are one series, not
 * one series per probed path.
 */
const NEST_WILDCARDS = new Set(['/{*path}', '*', '/*', '{*path}']);

export function httpRouteLabel(req: { baseUrl?: string; route?: { path?: unknown } }): string {
  const pattern = req.route?.path;
  // Nest mounts global middleware on a wildcard route; a request that matched
  // no controller finishes with that wildcard as its last matched route.
  if (typeof pattern !== 'string' || NEST_WILDCARDS.has(pattern)) return 'unmatched';
  const full = `${req.baseUrl ?? ''}${pattern}`;
  // Patterns come from controller decorators, so they are short; the cap only
  // protects against a regex route or a misconfigured mount.
  return full.length > 0 && full.length <= 160 ? full : OVERFLOW_LABEL;
}
