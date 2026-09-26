import { validateAvailability, type AvailabilityIntervalInput } from './availability-intervals';

const interval = (startMinute: number, endMinute: number, dayOfWeek = 1): AvailabilityIntervalInput => ({
  dayOfWeek, startMinute, endMinute,
});

function overlapOracle(values: readonly AvailabilityIntervalInput[]): Set<number> {
  const sorted = values.map((value, index) => ({ value, index }))
    .sort((a, b) => a.value.dayOfWeek - b.value.dayOfWeek || a.value.startMinute - b.value.startMinute || a.index - b.index);
  const colliding = new Set<number>();
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const earlier = sorted[j];
      const current = sorted[i];
      if (earlier.value.dayOfWeek === current.value.dayOfWeek &&
          current.value.startMinute < earlier.value.endMinute) colliding.add(current.index);
    }
  }
  return colliding;
}

describe('S08 authoritative availability diagnostics', () => {
  it('reports all later rows contained by an earlier long interval', () => {
    expect(validateAvailability([interval(0, 900), interval(60, 120), interval(300, 360)]))
      .toEqual([
        { code: 'OVERLAP', index: 1, conflictsWith: 0 },
        { code: 'OVERLAP', index: 2, conflictsWith: 0 },
      ]);
  });

  it('keeps submitted indices after sorting and never mutates input', () => {
    const values = [interval(300, 360), interval(0, 900), interval(60, 120)];
    const before = JSON.stringify(values);
    expect(validateAvailability(values)).toEqual([
      { code: 'OVERLAP', index: 2, conflictsWith: 1 },
      { code: 'OVERLAP', index: 0, conflictsWith: 1 },
    ]);
    expect(JSON.stringify(values)).toBe(before);
  });

  it.each([interval(1441, 1440), interval(0, -1), interval(Number.NaN, 60), interval(0, Number.POSITIVE_INFINITY)])('classifies invalid minute bounds before interval order: %p', (value) => {
    expect(validateAvailability([value])).toEqual([{ code: 'MINUTE_OUT_OF_RANGE', index: 0 }]);
  });

  it('preserves touching boundaries, split midnight and independent days', () => {
    expect(validateAvailability([
      interval(0, 60, 0), interval(60, 1440, 0), interval(0, 60, 1), interval(1380, 1440, 6),
    ])).toEqual([]);
  });

  it('agrees with an independent quadratic oracle for 3000 deterministic weeks', () => {
    let state = 0x5a08;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    for (let trial = 0; trial < 3000; trial += 1) {
      const values = Array.from({ length: next() % 31 }, () => {
        const start = next() % 1440;
        return interval(start, start + 1 + next() % (1440 - start), next() % 7);
      });
      const issues = validateAvailability(values);
      expect(new Set(issues.map((issue) => issue.index))).toEqual(overlapOracle(values));
      for (const issue of issues) {
        expect(issue.code).toBe('OVERLAP');
        const current = values[issue.index];
        const witness = values[issue.conflictsWith!];
        expect(witness.dayOfWeek).toBe(current.dayOfWeek);
        expect(witness.startMinute).toBeLessThan(current.endMinute);
        expect(current.startMinute).toBeLessThan(witness.endMinute);
      }
    }
  });
});
