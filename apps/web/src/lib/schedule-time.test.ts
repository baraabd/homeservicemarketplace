import { describe, it, expect } from 'vitest';

import { combineLocalDateTimeToIso, todayLocalDateString } from './schedule-time';
import { formatBookingTime } from '../app/components/provider/bookings/booking-copy';

// K02 — the request wizard converts a Riyadh wall time, not a browser one.
// These assertions are independent of the test host's TZ because the
// conversion names its zone explicitly.
describe('K02 request schedule conversion', () => {
  it('converts Riyadh wall times across midnight to the right instant', () => {
    expect(combineLocalDateTimeToIso('2026-11-04', '00:30')).toBe('2026-11-03T21:30:00.000Z');
    expect(combineLocalDateTimeToIso('2026-11-03', '23:59')).toBe('2026-11-03T20:59:00.000Z');
    expect(combineLocalDateTimeToIso('', '10:00')).toBeNull();
    expect(combineLocalDateTimeToIso('2026-02-30', '10:00')).toBeNull();
  });

  it('uses the Riyadh date for the picker minimum', () => {
    expect(todayLocalDateString(new Date('2026-11-03T21:30:00Z'))).toBe('2026-11-04');
  });

  it('shows a stored instant back in Riyadh time for every role', () => {
    const text = formatBookingTime('2026-11-03T21:30:00.000Z', 'en');
    expect(text).toMatch(/4 Nov 2026/);
    expect(text).toMatch(/00:30/);
  });
});
