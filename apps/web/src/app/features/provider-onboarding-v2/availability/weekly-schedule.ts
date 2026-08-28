// Sprint 9B.21 — the weekly schedule, as a value.
//
// docs/sprint-09b21/BULK_AVAILABILITY.md
//
// THE POINT OF THIS MODULE
//
// The brief asks the editor to "prevent UI states the API cannot persist".
// Validating after the fact is the weak version of that: it lets the state
// exist and then complains. Everything here is built so the invalid state is
// unreachable instead — `applyToDays` REPLACES a day rather than appending to
// it, `addWindow` refuses a window that would collide, and the editor derives
// its end-time options from the chosen start so an inverted range cannot be
// selected at all.
//
// `validateWeek` exists anyway, and is used as the property tests' oracle: the
// property worth having is that NO sequence of operations can produce a week
// the server would reject.
//
// WHERE THE RULES ACTUALLY LIVE
//
// On the server, in
// `apps/api/src/modules/provider/onboarding/availability-intervals.ts`. That
// file is the authority and the only enforcement point that matters; this one
// is a client-side mirror whose job is to keep the provider from ever hitting
// it. The constants and codes below are named to match it so a reviewer can
// diff them by eye, and the integration test proves the server still refuses a
// week these rules would have refused — so a drift here surfaces as a 422,
// never as a silently-persisted bad schedule.

/** Minutes in a day. `endMinute` is EXCLUSIVE, so a window running to midnight
 *  ends at 1440 and two adjacent windows can touch without overlapping. */
export const MINUTES_PER_DAY = 1440;

/** 0 = Sunday … 6 = Saturday. Matches JS `Date#getDay()`, the Prisma column,
 *  and DAY_LABELS — there is no conversion layer anywhere in the stack. */
export const DAYS_IN_WEEK = 7;

/** Mirrors MAX_INTERVALS_PER_PROVIDER on the server. */
export const MAX_INTERVALS_PER_WEEK = 60;

/**
 * The granularity the editor offers.
 *
 * The column stores minutes, so any value is storable; this is a UI choice.
 * Fifteen minutes is how service appointments are actually discussed, and a
 * fixed grid is what lets the end-time control offer only values after the
 * start — which is what makes an inverted range unreachable rather than merely
 * rejected.
 *
 * A stored value that is NOT on the grid (a legacy row saved through the V1
 * wizard's free-text time input) is preserved: `timeOptions` splices it in
 * rather than snapping it, because silently moving someone's saved hours is
 * worse than an odd-looking option.
 */
export const SLOT_MINUTES = 15;

export interface Window {
  /** Minutes from LOCAL midnight, inclusive. */
  startMinute: number;
  /** Minutes from LOCAL midnight, EXCLUSIVE. 1440 = midnight. */
  endMinute: number;
}

export interface DayWindow extends Window {
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
}

/** Seven days of windows, indexed by `dayOfWeek`. A day with no windows is a
 *  day the provider is unavailable — there is no separate flag, because two
 *  representations of "not working" would eventually disagree. */
export type Week = readonly (readonly Window[])[];

export const EMPTY_WEEK: Week = Object.freeze([[], [], [], [], [], [], []]);

/** The two schedules the brief names, as DAY SELECTIONS.
 *
 *  Applying one selects days and nothing else: the provider still has to
 *  choose the hours and press apply. A preset that silently filled in a
 *  working week would be the platform deciding when someone works. */
export const DAY_PRESETS = {
  SUN_THU: [0, 1, 2, 3, 4],
  MON_FRI: [1, 2, 3, 4, 5],
} as const;

export type DayPresetKey = keyof typeof DAY_PRESETS;

// ── building and unbuilding ────────────────────────────────────────────────

/** Group the server's flat interval list into a week. Windows are sorted, so
 *  two identical schedules always produce identical weeks whatever order the
 *  API returned them in — which is what keeps the summary and the tests from
 *  depending on row order. */
export function toWeek(intervals: readonly DayWindow[]): Week {
  const week: Window[][] = Array.from({ length: DAYS_IN_WEEK }, () => []);
  for (const interval of intervals) {
    if (!Number.isInteger(interval.dayOfWeek)) continue;
    if (interval.dayOfWeek < 0 || interval.dayOfWeek >= DAYS_IN_WEEK) continue;
    week[interval.dayOfWeek]!.push({
      startMinute: interval.startMinute,
      endMinute: interval.endMinute,
    });
  }
  return week.map(sortWindows);
}

/** Flatten back to what the PATCH carries: day-major, then start-major. */
export function toIntervals(week: Week): DayWindow[] {
  const out: DayWindow[] = [];
  week.forEach((windows, dayOfWeek) => {
    for (const w of sortWindows(windows)) {
      out.push({ dayOfWeek, startMinute: w.startMinute, endMinute: w.endMinute });
    }
  });
  return out;
}

export function countWindows(week: Week): number {
  return week.reduce((total, day) => total + day.length, 0);
}

export function isDayAvailable(week: Week, dayOfWeek: number): boolean {
  return (week[dayOfWeek]?.length ?? 0) > 0;
}

/** The one-line summary at the top of the screen.
 *
 *  Days WORKED rather than windows: a provider with a morning and an
 *  afternoon window on Monday works one day, and calling that two would
 *  make the headline disagree with the list underneath it. */
export function weekTotals(week: Week): { dayCount: number; totalMinutes: number } {
  let dayCount = 0;
  let totalMinutes = 0;
  for (const windows of week) {
    if (windows.length === 0) continue;
    dayCount += 1;
    for (const w of windows) totalMinutes += Math.max(0, w.endMinute - w.startMinute);
  }
  return { dayCount, totalMinutes };
}

// ── operations ─────────────────────────────────────────────────────────────

export type RejectionCode = 'OVERLAP' | 'DUPLICATE' | 'INVALID_RANGE' | 'TOO_MANY_INTERVALS';

export interface WeekChange {
  week: Week;
  /** Set when the operation was refused. The week comes back UNCHANGED, so a
   *  caller that ignores this cannot corrupt the schedule — it just does
   *  nothing, which is the safe failure. */
  rejected?: RejectionCode;
}

/**
 * The bulk action: set every selected day to exactly this one window.
 *
 * REPLACE, not append. Appending is how "apply Sun–Thu 9–5" twice produces
 * seven duplicate windows and a validation error the provider did not cause.
 * Replacing also makes the operation idempotent, which is what lets someone
 * correct a mistake by applying again rather than undoing first.
 *
 * Days not selected are untouched — that is what makes "bulk apply, then fix
 * Wednesday" work without the fix being clobbered by the next bulk apply.
 */
export function applyToDays(week: Week, days: readonly number[], window: Window): WeekChange {
  if (!isWellFormed(window)) return { week, rejected: 'INVALID_RANGE' };

  const selected = new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d < DAYS_IN_WEEK));
  if (selected.size === 0) return { week };

  const next = week.map((windows, day) =>
    selected.has(day) ? [{ ...window }] : windows.map((w) => ({ ...w })),
  );
  if (countWindows(next) > MAX_INTERVALS_PER_WEEK) return { week, rejected: 'TOO_MANY_INTERVALS' };
  return { week: next.map(sortWindows) };
}

/** Add one more window to a single day. Refused rather than merged: merging
 *  09:00–12:00 into an existing 11:00–14:00 silently changes hours the
 *  provider entered deliberately, and they can see both rows to fix it. */
export function addWindow(week: Week, dayOfWeek: number, window: Window): WeekChange {
  if (!isWellFormed(window)) return { week, rejected: 'INVALID_RANGE' };
  const day = week[dayOfWeek];
  if (day === undefined) return { week, rejected: 'INVALID_RANGE' };

  if (day.some((w) => w.startMinute === window.startMinute && w.endMinute === window.endMinute)) {
    return { week, rejected: 'DUPLICATE' };
  }
  if (day.some((w) => overlaps(w, window))) return { week, rejected: 'OVERLAP' };
  if (countWindows(week) + 1 > MAX_INTERVALS_PER_WEEK) {
    return { week, rejected: 'TOO_MANY_INTERVALS' };
  }

  const next = week.map((windows, i) =>
    i === dayOfWeek ? sortWindows([...windows, { ...window }]) : windows.map((w) => ({ ...w })),
  );
  return { week: next };
}

/** Replace one window in place — the per-day edit after a bulk apply. */
export function replaceWindow(
  week: Week,
  dayOfWeek: number,
  index: number,
  window: Window,
): WeekChange {
  if (!isWellFormed(window)) return { week, rejected: 'INVALID_RANGE' };
  const day = week[dayOfWeek];
  if (day === undefined || index < 0 || index >= day.length) {
    return { week, rejected: 'INVALID_RANGE' };
  }

  const others = day.filter((_, i) => i !== index);
  if (
    others.some((w) => w.startMinute === window.startMinute && w.endMinute === window.endMinute)
  ) {
    return { week, rejected: 'DUPLICATE' };
  }
  if (others.some((w) => overlaps(w, window))) return { week, rejected: 'OVERLAP' };

  const next = week.map((windows, i) =>
    i === dayOfWeek ? sortWindows([...others, { ...window }]) : windows.map((w) => ({ ...w })),
  );
  return { week: next };
}

export function removeWindow(week: Week, dayOfWeek: number, index: number): WeekChange {
  const day = week[dayOfWeek];
  if (day === undefined || index < 0 || index >= day.length) return { week };
  const next = week.map((windows, i) =>
    i === dayOfWeek
      ? windows.filter((_, j) => j !== index).map((w) => ({ ...w }))
      : windows.map((w) => ({ ...w })),
  );
  return { week: next };
}

/** Mark a day unavailable. Clearing its windows IS the representation — see
 *  the note on `Week`. */
export function clearDay(week: Week, dayOfWeek: number): WeekChange {
  if (week[dayOfWeek] === undefined) return { week };
  const next = week.map((windows, i) => (i === dayOfWeek ? [] : windows.map((w) => ({ ...w }))));
  return { week: next };
}

// ── the oracle ─────────────────────────────────────────────────────────────

export type WeekIssueCode =
  | 'DAY_OUT_OF_RANGE'
  | 'MINUTE_OUT_OF_RANGE'
  | 'END_NOT_AFTER_START'
  | 'OVERLAP'
  | 'TOO_MANY_INTERVALS';

export interface WeekIssue {
  code: WeekIssueCode;
  dayOfWeek: number;
  index: number;
}

/**
 * Would the server accept this week?
 *
 * Deliberately a re-statement of the server's rules rather than a call to
 * them: the web bundle cannot import API code, and importing runtime values
 * from the contracts package breaks the production Rollup build. Used by the
 * property tests as the oracle, and as a last guard before a save.
 */
export function validateWeek(week: Week): WeekIssue[] {
  const issues: WeekIssue[] = [];

  if (countWindows(week) > MAX_INTERVALS_PER_WEEK) {
    issues.push({ code: 'TOO_MANY_INTERVALS', dayOfWeek: -1, index: -1 });
    return issues;
  }
  if (week.length !== DAYS_IN_WEEK) {
    issues.push({ code: 'DAY_OUT_OF_RANGE', dayOfWeek: -1, index: -1 });
    return issues;
  }

  week.forEach((windows, dayOfWeek) => {
    const sorted = sortWindows(windows);
    sorted.forEach((w, index) => {
      if (
        !Number.isInteger(w.startMinute) ||
        !Number.isInteger(w.endMinute) ||
        w.startMinute < 0 ||
        w.endMinute > MINUTES_PER_DAY
      ) {
        issues.push({ code: 'MINUTE_OUT_OF_RANGE', dayOfWeek, index });
        return;
      }
      // A window that wraps past midnight is rejected here exactly as the
      // server rejects it. It is two windows on two days, and accepting it as
      // one would make every later comparison special-case the wrap.
      if (w.startMinute >= w.endMinute) {
        issues.push({ code: 'END_NOT_AFTER_START', dayOfWeek, index });
        return;
      }
      // End is EXCLUSIVE, so 09:00–12:00 and 12:00–15:00 touch and do NOT
      // overlap. The comparison is strict for that reason.
      const previous = sorted[index - 1];
      if (previous && w.startMinute < previous.endMinute) {
        issues.push({ code: 'OVERLAP', dayOfWeek, index });
      }
    });
  });

  return issues;
}

// ── time options ───────────────────────────────────────────────────────────

/**
 * The values a start control may offer: every slot from 00:00 up to (not
 * including) midnight, plus `extra` if it is off-grid.
 */
export function startOptions(extra?: number): number[] {
  return withExtra(range(0, MINUTES_PER_DAY - SLOT_MINUTES), extra);
}

/**
 * The values an END control may offer GIVEN the start.
 *
 * Only values strictly after it, up to and including 1440 (midnight). This is
 * the whole inverted-range and overnight defence: the provider cannot pick an
 * end before the start, so `END_NOT_AFTER_START` is unreachable through the
 * UI rather than reported by it.
 */
export function endOptions(startMinute: number, extra?: number): number[] {
  const first = Math.floor(startMinute / SLOT_MINUTES) * SLOT_MINUTES + SLOT_MINUTES;
  return withExtra(
    range(Math.max(first, startMinute + 1), MINUTES_PER_DAY).filter((m) => m > startMinute),
    extra !== undefined && extra > startMinute ? extra : undefined,
  );
}

/** Minutes as HH:mm. 1440 renders as 24:00 — an exclusive end of "00:00"
 *  reads as the start of the day it is actually the end of. */
export function formatMinute(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// ── internals ──────────────────────────────────────────────────────────────

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let m = Math.ceil(from / SLOT_MINUTES) * SLOT_MINUTES; m <= to; m += SLOT_MINUTES) {
    out.push(m);
  }
  return out;
}

function withExtra(values: number[], extra?: number): number[] {
  if (extra === undefined || values.includes(extra)) return values;
  if (extra < 0 || extra > MINUTES_PER_DAY) return values;
  return [...values, extra].sort((a, b) => a - b);
}

function isWellFormed(window: Window): boolean {
  return (
    Number.isInteger(window.startMinute) &&
    Number.isInteger(window.endMinute) &&
    window.startMinute >= 0 &&
    window.endMinute <= MINUTES_PER_DAY &&
    window.startMinute < window.endMinute
  );
}

function overlaps(a: Window, b: Window): boolean {
  return a.startMinute < b.endMinute && b.startMinute < a.endMinute;
}

function sortWindows(windows: readonly Window[]): Window[] {
  return [...windows]
    .map((w) => ({ startMinute: w.startMinute, endMinute: w.endMinute }))
    .sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
}
