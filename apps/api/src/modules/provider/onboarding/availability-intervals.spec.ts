import {
  MAX_INTERVALS_PER_PROVIDER,
  MINUTES_PER_DAY,
  formatMinute,
  isValidTimezone,
  validateAvailability,
} from './availability-intervals';

// Sprint 8 — the full overlap matrix.
//
// This is the rule that is NOT enforced by the database (an EXCLUDE over
// int4range would need btree_gist; ADR 0008 declined to add an extension
// without evidence), so it is the rule that most needs exhaustive tests. Every
// geometric relationship two intervals can have is enumerated below, plus the
// boundary cases that are easy to get backwards.

const AT = (dayOfWeek: number, startMinute: number, endMinute: number) => ({
  dayOfWeek,
  startMinute,
  endMinute,
});

/** 09:00-12:00 on Monday, the fixture every case is compared against. */
const MONDAY_MORNING = AT(1, 540, 720);

describe('validateAvailability — shape', () => {
  it('accepts an empty week', () => {
    // An empty set is INCOMPLETE (the completeness policy says so) but not
    // INVALID. The two are different answers with different UI: "you still
    // need to add hours" versus "these hours are wrong".
    expect(validateAvailability([])).toEqual([]);
  });

  it.each([-1, 7, 1.5, Number.NaN])('rejects dayOfWeek %p', (dayOfWeek) => {
    const issues = validateAvailability([AT(dayOfWeek, 540, 720)]);
    expect(issues).toContainEqual({ code: 'DAY_OUT_OF_RANGE', index: 0 });
  });

  it('accepts both ends of the week', () => {
    expect(validateAvailability([AT(0, 0, 60), AT(6, 0, 60)])).toEqual([]);
  });

  it('accepts a window running to exactly midnight', () => {
    // 1440 is legal precisely BECAUSE the end is exclusive: [0, 1440) is the
    // whole day and touches nothing on the next one.
    expect(validateAvailability([AT(1, 0, MINUTES_PER_DAY)])).toEqual([]);
  });

  it('rejects a window past midnight', () => {
    const issues = validateAvailability([AT(1, 0, MINUTES_PER_DAY + 1)]);
    expect(issues).toContainEqual({ code: 'MINUTE_OUT_OF_RANGE', index: 0 });
  });

  it('rejects a negative start', () => {
    expect(validateAvailability([AT(1, -1, 60)])).toContainEqual({
      code: 'MINUTE_OUT_OF_RANGE',
      index: 0,
    });
  });

  it('rejects a zero-length window', () => {
    // Reads as availability in a list, matches no booking ever. The most
    // confusing possible state, so it is rejected outright.
    expect(validateAvailability([AT(1, 540, 540)])).toContainEqual({
      code: 'END_NOT_AFTER_START',
      index: 0,
    });
  });

  it('rejects a window that ends before it starts', () => {
    expect(validateAvailability([AT(1, 720, 540)])).toContainEqual({
      code: 'END_NOT_AFTER_START',
      index: 0,
    });
  });

  it('rejects a window WRAPPING past midnight rather than silently splitting it', () => {
    // 22:00 to 02:00 is two intervals on two days. Accepting it as one would
    // force every downstream comparison to special-case the wrap; the wizard
    // splits it before sending.
    expect(validateAvailability([AT(1, 1320, 120)])).toContainEqual({
      code: 'END_NOT_AFTER_START',
      index: 0,
    });
  });

  it('reports ONE issue per malformed row, not two', () => {
    // A row whose minutes are out of range is not also reported as
    // end-not-after-start; saying the same thing twice makes the UI show two
    // errors for one mistake.
    const issues = validateAvailability([AT(1, -5, -10)]);
    expect(issues).toEqual([{ code: 'MINUTE_OUT_OF_RANGE', index: 0 }]);
  });

  it('does not sweep a malformed row for overlap', () => {
    // A window with no valid position on the timeline cannot meaningfully
    // collide with anything, and reporting that it does sends the provider
    // chasing the wrong row.
    const issues = validateAvailability([MONDAY_MORNING, AT(1, 600, 400)]);
    expect(issues).toEqual([{ code: 'END_NOT_AFTER_START', index: 1 }]);
  });
});

describe('validateAvailability — the overlap matrix', () => {
  it.each([
    ['identical', AT(1, 540, 720)],
    ['contained', AT(1, 600, 660)],
    ['containing', AT(1, 480, 780)],
    ['straddling the start', AT(1, 480, 600)],
    ['straddling the end', AT(1, 660, 780)],
    ['overlapping by one minute at the end', AT(1, 719, 780)],
  ])('rejects a %s window', (_label, second) => {
    const issues = validateAvailability([MONDAY_MORNING, second]);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'OVERLAP', index: expect.any(Number) }),
    );
  });

  it.each([
    ['touching at the end', AT(1, 720, 780)],
    ['touching at the start', AT(1, 480, 540)],
    ['separated by a gap', AT(1, 900, 1020)],
    ['the same hours on a different day', AT(2, 540, 720)],
  ])('accepts a %s window', (_label, second) => {
    expect(validateAvailability([MONDAY_MORNING, second])).toEqual([]);
  });

  it('names BOTH sides of a collision', () => {
    // "Something overlaps" is not actionable. The provider has to be told
    // which two rows to reconcile.
    const issues = validateAvailability([MONDAY_MORNING, AT(1, 600, 780)]);
    expect(issues).toEqual([{ code: 'OVERLAP', index: 1, conflictsWith: 0 }]);
  });

  it('reports the collision against the LATER-STARTING interval regardless of submission order', () => {
    // The later-starting one is the one the provider just dragged into place,
    // so it is the one to highlight — and the answer must not depend on array
    // order, or the same week reports different rows on a re-save.
    const forwards = validateAvailability([AT(1, 540, 720), AT(1, 600, 780)]);
    const backwards = validateAvailability([AT(1, 600, 780), AT(1, 540, 720)]);

    expect(forwards).toEqual([{ code: 'OVERLAP', index: 1, conflictsWith: 0 }]);
    expect(backwards).toEqual([{ code: 'OVERLAP', index: 0, conflictsWith: 1 }]);
  });

  it('finds a collision between NON-ADJACENT entries in the array', () => {
    // A naive neighbour-only comparison passes this. The sweep sorts first.
    const issues = validateAvailability([AT(1, 540, 720), AT(3, 0, 60), AT(1, 700, 800)]);
    expect(issues).toEqual([{ code: 'OVERLAP', index: 2, conflictsWith: 0 }]);
  });

  it('finds every collision in a three-way pile-up', () => {
    const issues = validateAvailability([AT(1, 540, 900), AT(1, 600, 660), AT(1, 620, 700)]);
    expect(issues.filter((i) => i.code === 'OVERLAP')).toHaveLength(2);
  });

  it('validates the whole SET rather than one interval at a time', () => {
    // The reason the function takes an array: validating incrementally lets a
    // client add two conflicting windows in either order and have each pass on
    // its own, because neither is wrong without the other.
    expect(validateAvailability([AT(1, 540, 720)])).toEqual([]);
    expect(validateAvailability([AT(1, 600, 780)])).toEqual([]);
    expect(validateAvailability([AT(1, 540, 720), AT(1, 600, 780)])).not.toEqual([]);
  });
});

describe('validateAvailability — volume', () => {
  it('accepts a full, dense but legal week', () => {
    // Seven days times four windows = 28, comfortably legal and a realistic
    // schedule for someone who breaks for lunch and prayers.
    const week = [0, 1, 2, 3, 4, 5, 6].flatMap((day) => [
      AT(day, 480, 720),
      AT(day, 780, 900),
      AT(day, 960, 1080),
      AT(day, 1140, 1260),
    ]);
    expect(validateAvailability(week)).toEqual([]);
  });

  it('rejects an unbounded set before doing any other work', () => {
    // An unbounded array is row-count amplification through one PATCH. The
    // cap is checked FIRST and returns immediately, so a 10,000-element
    // payload does not get an O(n log n) sweep run over it.
    const tooMany = Array.from({ length: MAX_INTERVALS_PER_PROVIDER + 1 }, (_, i) =>
      AT(i % 7, i, i + 1),
    );
    expect(validateAvailability(tooMany)).toEqual([
      { code: 'TOO_MANY_INTERVALS', index: MAX_INTERVALS_PER_PROVIDER },
    ]);
  });
});

describe('isValidTimezone', () => {
  it.each(['Asia/Damascus', 'Europe/London', 'UTC', 'America/New_York'])(
    'accepts %s',
    (timezone) => {
      expect(isValidTimezone(timezone)).toBe(true);
    },
  );

  it.each(['', '   ', 'Asia/Damascusx', 'Not/A/Zone'])('rejects %p', (timezone) => {
    // Shape cannot distinguish Asia/Damascus from Asia/Damascusx, so the
    // runtime is asked instead. Storing an unresolvable zone turns every
    // future time calculation into a throw, a long way from here.
    expect(isValidTimezone(timezone)).toBe(false);
  });
});

describe('formatMinute', () => {
  it.each([
    [0, '00:00'],
    [540, '09:00'],
    [629, '10:29'],
    [1439, '23:59'],
    [1440, '24:00'],
  ])('renders %i as %s', (minute, expected) => {
    // 1440 renders as 24:00 rather than 00:00 because the end is exclusive:
    // "until 00:00" reads as the start of the day it is actually the end of.
    expect(formatMinute(minute)).toBe(expected);
  });
});
