import { describe, expect, it } from 'vitest';

import {
  DAY_PRESETS,
  EMPTY_WEEK,
  MAX_INTERVALS_PER_WEEK,
  MINUTES_PER_DAY,
  SLOT_MINUTES,
  addWindow,
  applyToDays,
  clearDay,
  countWindows,
  endOptions,
  formatMinute,
  isDayAvailable,
  removeWindow,
  replaceWindow,
  startOptions,
  toIntervals,
  toWeek,
  validateWeek,
  type Week,
  type Window,
} from './weekly-schedule';

// Sprint 9B.21 — the week as a value.
//
// The load-bearing test in this file is the PROPERTY at the bottom: no
// sequence of editor operations, from any starting week, may produce a
// schedule the server would reject. Everything above it is the specific
// behaviour that property alone would not pin down.

const NINE_TO_FIVE: Window = { startMinute: 540, endMinute: 1020 };

describe('toWeek / toIntervals', () => {
  it('round-trips a schedule', () => {
    const intervals = [
      { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
      { dayOfWeek: 1, startMinute: 780, endMinute: 1020 },
      { dayOfWeek: 4, startMinute: 600, endMinute: 900 },
    ];
    expect(toIntervals(toWeek(intervals))).toEqual(intervals);
  });

  it('sorts, so row order from the API cannot change what is displayed', () => {
    const scrambled = toWeek([
      { dayOfWeek: 3, startMinute: 780, endMinute: 1020 },
      { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
      { dayOfWeek: 3, startMinute: 540, endMinute: 720 },
    ]);
    expect(toIntervals(scrambled)).toEqual([
      { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
      { dayOfWeek: 3, startMinute: 540, endMinute: 720 },
      { dayOfWeek: 3, startMinute: 780, endMinute: 1020 },
    ]);
  });

  it('drops a row for a day that does not exist rather than crashing', () => {
    // A malformed response must not take down the screen the provider is
    // trying to finish.
    const week = toWeek([
      { dayOfWeek: 9, startMinute: 540, endMinute: 1020 },
      { dayOfWeek: -1, startMinute: 540, endMinute: 1020 },
      { dayOfWeek: 2, startMinute: 540, endMinute: 1020 },
    ]);
    expect(countWindows(week)).toBe(1);
    expect(isDayAvailable(week, 2)).toBe(true);
  });
});

describe('applyToDays — the bulk action', () => {
  it('sets a whole working week in ONE action', () => {
    // The acceptance criterion: Sunday–Thursday, entered once.
    const { week } = applyToDays(EMPTY_WEEK, DAY_PRESETS.SUN_THU, NINE_TO_FIVE);
    expect(toIntervals(week)).toEqual([
      { dayOfWeek: 0, startMinute: 540, endMinute: 1020 },
      { dayOfWeek: 1, startMinute: 540, endMinute: 1020 },
      { dayOfWeek: 2, startMinute: 540, endMinute: 1020 },
      { dayOfWeek: 3, startMinute: 540, endMinute: 1020 },
      { dayOfWeek: 4, startMinute: 540, endMinute: 1020 },
    ]);
  });

  it('does Monday–Friday too', () => {
    const { week } = applyToDays(EMPTY_WEEK, DAY_PRESETS.MON_FRI, NINE_TO_FIVE);
    expect(toIntervals(week).map((i) => i.dayOfWeek)).toEqual([1, 2, 3, 4, 5]);
  });

  it('REPLACES rather than appends, so applying twice is idempotent', () => {
    // Appending is how "apply Sun–Thu 9–5" twice produces duplicate windows
    // and a validation error the provider did not cause.
    const once = applyToDays(EMPTY_WEEK, DAY_PRESETS.SUN_THU, NINE_TO_FIVE).week;
    const twice = applyToDays(once, DAY_PRESETS.SUN_THU, NINE_TO_FIVE).week;
    expect(toIntervals(twice)).toEqual(toIntervals(once));
  });

  it('leaves unselected days completely alone', () => {
    // What makes "bulk apply, then fix Wednesday" survive the next bulk apply
    // of a different set.
    const base = applyToDays(EMPTY_WEEK, [3], { startMinute: 600, endMinute: 720 }).week;
    const { week } = applyToDays(base, [1, 2], NINE_TO_FIVE);
    expect(week[3]).toEqual([{ startMinute: 600, endMinute: 720 }]);
  });

  it('refuses an inverted range and changes nothing', () => {
    const result = applyToDays(EMPTY_WEEK, [1], { startMinute: 1020, endMinute: 540 });
    expect({ rejected: result.rejected, changed: result.week !== EMPTY_WEEK }).toEqual({
      rejected: 'INVALID_RANGE',
      changed: false,
    });
  });

  it('refuses an overnight range — it is two windows on two days', () => {
    const result = applyToDays(EMPTY_WEEK, [1], { startMinute: 1320, endMinute: 120 });
    expect(result.rejected).toBe('INVALID_RANGE');
  });

  it('does nothing when no days are selected', () => {
    const result = applyToDays(EMPTY_WEEK, [], NINE_TO_FIVE);
    expect({ rejected: result.rejected, count: countWindows(result.week) }).toEqual({
      rejected: undefined,
      count: 0,
    });
  });

  it('ignores day numbers outside the week', () => {
    const { week } = applyToDays(EMPTY_WEEK, [-1, 7, 99, 2], NINE_TO_FIVE);
    expect(toIntervals(week).map((i) => i.dayOfWeek)).toEqual([2]);
  });
});

describe('per-day editing after a bulk apply', () => {
  const base = applyToDays(EMPTY_WEEK, DAY_PRESETS.MON_FRI, NINE_TO_FIVE).week;

  it('edits one day without touching the others', () => {
    const { week } = replaceWindow(base, 3, 0, { startMinute: 600, endMinute: 780 });
    expect(week[3]).toEqual([{ startMinute: 600, endMinute: 780 }]);
    expect(week[2]).toEqual([{ startMinute: 540, endMinute: 1020 }]);
  });

  it('adds a second window to one day, since the API supports several', () => {
    const cleared = replaceWindow(base, 2, 0, { startMinute: 540, endMinute: 720 }).week;
    const { week, rejected } = addWindow(cleared, 2, { startMinute: 780, endMinute: 1020 });
    expect({ rejected, day: week[2] }).toEqual({
      rejected: undefined,
      day: [
        { startMinute: 540, endMinute: 720 },
        { startMinute: 780, endMinute: 1020 },
      ],
    });
  });

  it('refuses a window that overlaps one already on that day', () => {
    const result = addWindow(base, 1, { startMinute: 600, endMinute: 1200 });
    expect({ rejected: result.rejected, day: result.week[1] }).toEqual({
      rejected: 'OVERLAP',
      day: [{ startMinute: 540, endMinute: 1020 }],
    });
  });

  it('refuses an exact duplicate', () => {
    expect(addWindow(base, 1, NINE_TO_FIVE).rejected).toBe('DUPLICATE');
  });

  it('allows two windows that TOUCH, because the end is exclusive', () => {
    const cleared = replaceWindow(base, 1, 0, { startMinute: 540, endMinute: 720 }).week;
    const { rejected } = addWindow(cleared, 1, { startMinute: 720, endMinute: 1020 });
    expect(rejected).toBeUndefined();
  });

  it('does not count a window against itself when replacing it', () => {
    const { rejected } = replaceWindow(base, 1, 0, { startMinute: 541, endMinute: 1020 });
    expect(rejected).toBeUndefined();
  });

  it('removes a window, and removing the last one makes the day unavailable', () => {
    const { week } = removeWindow(base, 1, 0);
    expect(isDayAvailable(week, 1)).toBe(false);
  });

  it('clearDay marks a day unavailable in one action', () => {
    const { week } = clearDay(base, 4);
    expect({ four: isDayAvailable(week, 4), three: isDayAvailable(week, 3) }).toEqual({
      four: false,
      three: true,
    });
  });

  it('removing from an index that is not there changes nothing', () => {
    expect(toIntervals(removeWindow(base, 1, 5).week)).toEqual(toIntervals(base));
  });
});

describe('the interval ceiling', () => {
  it('refuses an add that would exceed what the server accepts', () => {
    // Built by hand rather than through the editor: the point is the guard,
    // not whether the editor can reach it.
    const day: Window[] = [];
    for (let i = 0; i < MAX_INTERVALS_PER_WEEK; i += 1) {
      day.push({ startMinute: i * 2, endMinute: i * 2 + 1 });
    }
    const full: Week = [day, [], [], [], [], [], []];
    expect(countWindows(full)).toBe(MAX_INTERVALS_PER_WEEK);
    expect(addWindow(full, 1, NINE_TO_FIVE).rejected).toBe('TOO_MANY_INTERVALS');
  });
});

describe('time options', () => {
  it('offers only ends AFTER the start, so an inverted range cannot be picked', () => {
    const ends = endOptions(540);
    expect(Math.min(...ends)).toBe(540 + SLOT_MINUTES);
    expect(ends.every((m) => m > 540)).toBe(true);
  });

  it('offers midnight as an end, which the column can store and a clock cannot', () => {
    expect(endOptions(1320)).toContain(MINUTES_PER_DAY);
  });

  it('never offers midnight as a START', () => {
    expect(startOptions()).not.toContain(MINUTES_PER_DAY);
  });

  it('keeps an off-grid stored value rather than snapping it', () => {
    // A legacy row saved through the V1 wizard's free time input. Silently
    // moving someone's saved hours is worse than an odd-looking option.
    expect(startOptions(545)).toContain(545);
    expect(endOptions(540, 1025)).toContain(1025);
  });

  it('does not offer an off-grid extra that would invert the range', () => {
    expect(endOptions(540, 300)).not.toContain(300);
  });

  it('renders an exclusive midnight as 24:00', () => {
    expect(formatMinute(MINUTES_PER_DAY)).toBe('24:00');
    expect(formatMinute(540)).toBe('09:00');
    expect(formatMinute(0)).toBe('00:00');
  });
});

describe('validateWeek', () => {
  it('accepts a week the editor produced', () => {
    const { week } = applyToDays(EMPTY_WEEK, DAY_PRESETS.SUN_THU, NINE_TO_FIVE);
    expect(validateWeek(week)).toEqual([]);
  });

  it('names the day and index of an overlap', () => {
    const bad: Week = [
      [],
      [
        { startMinute: 540, endMinute: 720 },
        { startMinute: 600, endMinute: 900 },
      ],
      [],
      [],
      [],
      [],
      [],
    ];
    expect(validateWeek(bad)).toEqual([{ code: 'OVERLAP', dayOfWeek: 1, index: 1 }]);
  });

  it('rejects an inverted window', () => {
    const bad: Week = [[{ startMinute: 900, endMinute: 540 }], [], [], [], [], [], []];
    expect(validateWeek(bad)).toEqual([{ code: 'END_NOT_AFTER_START', dayOfWeek: 0, index: 0 }]);
  });

  it('rejects minutes outside the day', () => {
    const bad: Week = [[{ startMinute: -1, endMinute: 540 }], [], [], [], [], [], []];
    expect(validateWeek(bad)[0]!.code).toBe('MINUTE_OUT_OF_RANGE');
  });

  it('reports only one issue per malformed window', () => {
    // Two issues saying the same thing send the UI to two places for one fix.
    const bad: Week = [[{ startMinute: 5000, endMinute: 10 }], [], [], [], [], [], []];
    expect(bad.length && validateWeek(bad)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE PROPERTY
//
// No sequence of editor operations, from any reachable starting week, may
// produce a schedule the server would reject. This is the claim the whole
// module is shaped around — "prevent UI states the API cannot persist" — and
// a property test is the only honest way to make it, because the failing case
// is always the combination nobody thought to write down.
//
// The generator is SEEDED. A failure names a seed that reproduces it exactly,
// which is what makes a counterexample debuggable instead of a flake.
// ─────────────────────────────────────────────────────────────────────────────

/** Mulberry32 — small, fast, and deterministic given the seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('property: the editor cannot build a week the server would reject', () => {
  it('holds over 400 random operation sequences', () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const random = rng(seed);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
      const day = () => Math.floor(random() * 7);

      /** A window drawn the way the CONTROLS draw one: a start from the grid,
       *  then an end from the options that start allows. Modelling the
       *  controls is the point — the property is about what the editor can
       *  produce, not about arbitrary numbers. */
      const window = (): Window => {
        const start = pick(startOptions());
        return { startMinute: start, endMinute: pick(endOptions(start)) };
      };

      let week: Week = EMPTY_WEEK;
      const trail: string[] = [];

      for (let step = 0; step < 25; step += 1) {
        const op = Math.floor(random() * 5);
        if (op === 0) {
          const days = [0, 1, 2, 3, 4, 5, 6].filter(() => random() < 0.5);
          const w = window();
          trail.push(`applyToDays [${days}] ${w.startMinute}-${w.endMinute}`);
          week = applyToDays(week, days, w).week;
        } else if (op === 1) {
          const d = day();
          const w = window();
          trail.push(`addWindow ${d} ${w.startMinute}-${w.endMinute}`);
          week = addWindow(week, d, w).week;
        } else if (op === 2) {
          const d = day();
          const index = Math.floor(random() * 3);
          const w = window();
          trail.push(`replaceWindow ${d}[${index}] ${w.startMinute}-${w.endMinute}`);
          week = replaceWindow(week, d, index, w).week;
        } else if (op === 3) {
          const d = day();
          const index = Math.floor(random() * 3);
          trail.push(`removeWindow ${d}[${index}]`);
          week = removeWindow(week, d, index).week;
        } else {
          const d = day();
          trail.push(`clearDay ${d}`);
          week = clearDay(week, d).week;
        }

        const issues = validateWeek(week);
        // The seed and the operation trail travel with the failure, so a
        // counterexample is reproducible rather than a story about randomness.
        expect({ seed, step, trail, issues }).toEqual({ seed, step, trail, issues: [] });
      }
    }
  });

  it('round-trips every generated week through the wire shape unchanged', () => {
    // toIntervals is what the PATCH carries and toWeek is what renders the
    // reload. If they disagree, the summary after a reload is not the schedule
    // that was saved — which is an acceptance criterion.
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = rng(seed);
      let week: Week = EMPTY_WEEK;
      for (let step = 0; step < 10; step += 1) {
        const days = [0, 1, 2, 3, 4, 5, 6].filter(() => random() < 0.4);
        const start = Math.floor(random() * 90) * SLOT_MINUTES;
        const ends = endOptions(start);
        week = applyToDays(week, days, {
          startMinute: start,
          endMinute: ends[Math.floor(random() * ends.length)]!,
        }).week;
      }
      expect({ seed, week: toWeek(toIntervals(week)) }).toEqual({ seed, week });
    }
  });
});
