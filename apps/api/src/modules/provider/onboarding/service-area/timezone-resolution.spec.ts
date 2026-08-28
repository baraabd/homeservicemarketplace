import { isValidTimezone } from '../availability-intervals';
import { describeTimezone, resolveTimezone } from './timezone-resolution';

// Sprint 9B.19 — resolving the timezone so the provider is never shown one.
//
// The requirement is that raw `Asia/...` identifiers stay out of ordinary UI.
// These tests protect the two halves of that: the server can answer without
// asking, and when it genuinely cannot, it says so instead of guessing.

describe('resolveTimezone', () => {
  it.each([
    ['SY', 'Asia/Damascus'],
    ['SE', 'Europe/Stockholm'],
    ['AE', 'Asia/Dubai'],
    ['EG', 'Africa/Cairo'],
  ])('resolves %s without asking anyone', (code, zone) => {
    expect(resolveTimezone(code)).toEqual({ kind: 'RESOLVED', timezone: zone });
  });

  it('is case- and whitespace-insensitive', () => {
    // The code arrives from a client picker; being strict about its casing
    // would fail for a reason nobody could see.
    expect(resolveTimezone(' sy ')).toEqual({ kind: 'RESOLVED', timezone: 'Asia/Damascus' });
  });

  it('REFUSES TO GUESS for a country spanning several zones', () => {
    // A guess here is indistinguishable from an answer and would be wrong for
    // half of Russia — and every window the provider enters would be shifted.
    expect(resolveTimezone('US')).toEqual({ kind: 'AMBIGUOUS', reason: 'MULTI_ZONE' });
    expect(resolveTimezone('RU')).toEqual({ kind: 'AMBIGUOUS', reason: 'MULTI_ZONE' });
  });

  it('says UNKNOWN_COUNTRY rather than pretending, for a code it has no mapping for', () => {
    expect(resolveTimezone('ZZ')).toEqual({ kind: 'AMBIGUOUS', reason: 'UNKNOWN_COUNTRY' });
  });

  it('treats a missing country as "not asked yet", not as a failure', () => {
    // The provider simply has not reached that field. Reporting a problem
    // would put an error on a form they have not filled in.
    expect(resolveTimezone(null)).toEqual({ kind: 'UNKNOWN' });
    expect(resolveTimezone('')).toEqual({ kind: 'UNKNOWN' });
    expect(resolveTimezone('   ')).toEqual({ kind: 'UNKNOWN' });
  });

  it('only ever returns zones this runtime can actually use', () => {
    // A resolved identifier is written onto availability intervals, and one
    // the runtime rejects would fail at the write with an error the provider
    // cannot act on. Checked against the SAME validator that step uses.
    for (const code of ['SY', 'LB', 'JO', 'IQ', 'SA', 'AE', 'EG', 'TR', 'SE', 'GB', 'IN', 'MA']) {
      const result = resolveTimezone(code);
      expect({ code, kind: result.kind }).toEqual({ code, kind: 'RESOLVED' });
      if (result.kind === 'RESOLVED') {
        expect({ code, valid: isValidTimezone(result.timezone) }).toEqual({ code, valid: true });
      }
    }
  });
});

describe('describeTimezone — what the provider is actually shown', () => {
  const winter = new Date('2026-01-15T12:00:00Z');
  const summer = new Date('2026-07-15T12:00:00Z');

  it('shows a CITY and an offset, never the identifier', () => {
    const shown = describeTimezone('Asia/Damascus', winter);
    expect(shown.city).toBe('Damascus');
    expect(shown.offset).toMatch(/^UTC[+-]?\d*/);
    // The thing that must not reach the screen.
    expect(`${shown.city} ${shown.offset}`).not.toContain('Asia/');
  });

  it('turns an underscored identifier into readable words', () => {
    expect(describeTimezone('America/New_York', winter).city).toBe('New York');
  });

  it('says UTC rather than GMT, like the rest of the platform', () => {
    expect(describeTimezone('Europe/Stockholm', winter).offset.startsWith('UTC')).toBe(true);
  });

  it('follows daylight saving rather than caching an offset', () => {
    // A stored offset is wrong for half the year. Stockholm is +1 in January
    // and +2 in July.
    const w = describeTimezone('Europe/Stockholm', winter).offset;
    const s = describeTimezone('Europe/Stockholm', summer).offset;
    expect(w).not.toBe(s);
  });

  it('is stable for a zone that does not observe daylight saving', () => {
    const w = describeTimezone('Asia/Dubai', winter).offset;
    const s = describeTimezone('Asia/Dubai', summer).offset;
    expect(w).toBe(s);
  });
});
