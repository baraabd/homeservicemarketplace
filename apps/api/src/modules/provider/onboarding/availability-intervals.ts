// Sprint 8 — weekly availability intervals: normalisation and overlap.
// docs/adr/0008-category-hierarchy-and-onboarding-draft.md
//
// Pure. No Prisma, no Nest. Overlap is a property of a set of numbers, so it
// is decidable without a database — which is what lets the whole matrix of
// cases (touching, containing, identical, straddling midnight) be tested
// exhaustively and cheaply.
//
// WHY THIS LIVES IN APPLICATION CODE AND NOT IN A CHECK CONSTRAINT:
// PostgreSQL can enforce non-overlap with an EXCLUDE constraint over
// int4range, but that requires the btree_gist extension. ADR 0003 declined to
// add infrastructure without measured evidence and this sprint produced none,
// so the rule is enforced here and a plain unique index closes the
// exact-duplicate case at zero cost. The residual risk is a direct database
// write bypassing this function; it is written down in ADR 0008 rather than
// left implicit.

/** Minutes in a day. `endMinute` is EXCLUSIVE, so a window running to
 *  midnight is `1440` and two adjacent windows can touch without overlapping. */
export const MINUTES_PER_DAY = 1440;

/** Sunday. Matches JS `Date#getDay()`, so there is no conversion layer to get
 *  wrong between the client, the server, and the database CHECK constraint. */
export const FIRST_DAY_OF_WEEK = 0;
export const LAST_DAY_OF_WEEK = 6;

/** Guards against a client sending a thousand one-minute slivers. Seven days
 *  of genuinely distinct working windows does not need more than this, and an
 *  unbounded array is a row-count amplification through a single PATCH. */
export const MAX_INTERVALS_PER_PROVIDER = 60;

export interface AvailabilityIntervalInput {
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  /** Minutes from LOCAL midnight, inclusive. */
  startMinute: number;
  /** Minutes from LOCAL midnight, exclusive. */
  endMinute: number;
}

export type AvailabilityIssueCode =
  | 'DAY_OUT_OF_RANGE'
  | 'MINUTE_OUT_OF_RANGE'
  | 'END_NOT_AFTER_START'
  | 'OVERLAP'
  | 'TOO_MANY_INTERVALS';

export interface AvailabilityIssue {
  code: AvailabilityIssueCode;
  /** Index into the submitted array, so the UI can focus the offending row
   *  rather than telling the provider "something in your schedule is wrong". */
  index: number;
  /** For OVERLAP, the index of the interval it collides with. */
  conflictsWith?: number;
}

/**
 * Validate a provider's whole week in one pass.
 *
 * Takes the COMPLETE set rather than one interval at a time: overlap is a
 * property of the set, and validating incrementally would let a client insert
 * two conflicting windows in either order and have each pass on its own.
 */
export function validateAvailability(
  intervals: readonly AvailabilityIntervalInput[],
): AvailabilityIssue[] {
  const issues: AvailabilityIssue[] = [];

  if (intervals.length > MAX_INTERVALS_PER_PROVIDER) {
    // Reported against the first interval past the limit so the message can
    // point at something real.
    issues.push({ code: 'TOO_MANY_INTERVALS', index: MAX_INTERVALS_PER_PROVIDER });
    return issues;
  }

  // Shape first. An interval that fails a bounds check has no meaningful
  // position on the timeline, so including it in the overlap sweep would
  // produce collision reports about a window that cannot exist.
  const wellFormed: { index: number; value: AvailabilityIntervalInput }[] = [];
  intervals.forEach((value, index) => {
    let ok = true;

    if (
      !Number.isInteger(value.dayOfWeek) ||
      value.dayOfWeek < FIRST_DAY_OF_WEEK ||
      value.dayOfWeek > LAST_DAY_OF_WEEK
    ) {
      issues.push({ code: 'DAY_OUT_OF_RANGE', index });
      ok = false;
    }

    if (
      !Number.isInteger(value.startMinute) ||
      !Number.isInteger(value.endMinute) ||
      value.startMinute < 0 ||
      value.endMinute > MINUTES_PER_DAY
    ) {
      issues.push({ code: 'MINUTE_OUT_OF_RANGE', index });
      ok = false;
    } else if (value.startMinute >= value.endMinute) {
      // Checked only when both minutes are in range, so a single malformed
      // row does not produce two issues that say the same thing twice.
      //
      // Note this REJECTS a window that wraps past midnight (22:00 → 02:00).
      // That is deliberate: such a window is two intervals on two days, and
      // accepting it as one would make every downstream comparison special-case
      // the wrap. The wizard splits it before sending.
      issues.push({ code: 'END_NOT_AFTER_START', index });
      ok = false;
    }

    if (ok) wellFormed.push({ index, value });
  });

  // Overlap, per day. Sorting by start makes the sweep linear and means each
  // collision is reported once, against the interval that starts later —
  // which is the one the provider just added.
  const byDay = new Map<number, { index: number; value: AvailabilityIntervalInput }[]>();
  for (const entry of wellFormed) {
    const bucket = byDay.get(entry.value.dayOfWeek);
    if (bucket) bucket.push(entry);
    else byDay.set(entry.value.dayOfWeek, [entry]);
  }

  for (const bucket of byDay.values()) {
    bucket.sort((a, b) => a.value.startMinute - b.value.startMinute || a.index - b.index);
    for (let i = 1; i < bucket.length; i += 1) {
      const previous = bucket[i - 1];
      const current = bucket[i];
      // End is EXCLUSIVE: 09:00-12:00 followed by 12:00-15:00 touch and do NOT
      // overlap, so the comparison is strict.
      if (current.value.startMinute < previous.value.endMinute) {
        issues.push({ code: 'OVERLAP', index: current.index, conflictsWith: previous.index });
      }
    }
  }

  return issues;
}

/** Whether an IANA timezone identifier is one this runtime can actually
 *  resolve. Checked rather than pattern-matched: `Asia/Damascus` and
 *  `Asia/Damascusx` are indistinguishable by shape, and storing an
 *  unresolvable zone turns every future time calculation into a throw. */
export function isValidTimezone(timezone: string): boolean {
  if (typeof timezone !== 'string' || timezone.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Render minutes-from-midnight as HH:mm for display and for messages.
 *  1440 renders as 24:00, which is what an exclusive end means. */
export function formatMinute(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
