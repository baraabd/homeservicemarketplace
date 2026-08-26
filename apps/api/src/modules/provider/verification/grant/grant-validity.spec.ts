import { GRANT_VALIDITY_DAYS_KEY, GrantValidityError, computeGrantWindow } from './grant-validity';
import { authorizesWork } from './work-access-grant.policy';

// Sprint 9B.7 — the grant window, asserted at every boundary.
//
// These are the cases that decide whether a provider can work, so they are
// checked exactly rather than approximately: an off-by-one day here is a day of
// unauthorised work, or a day of a verified provider being told they are not.

const DECIDED = new Date('2026-06-01T12:00:00.000Z');
const MS_PER_DAY = 86_400_000;

describe('computeGrantWindow — start and expiry', () => {
  it('starts at the decision instant, exactly', () => {
    // Not "about now". The same instant the decision was recorded with, so the
    // decision and the access it created cannot disagree about when it began.
    const w = computeGrantWindow({ decidedAt: DECIDED, validityDays: 365 });
    expect(w.grantedAt.toISOString()).toBe(DECIDED.toISOString());
  });

  it('expires exactly validityDays after the decision', () => {
    const w = computeGrantWindow({ decidedAt: DECIDED, validityDays: 365 });
    expect(w.expiresAt.getTime() - DECIDED.getTime()).toBe(365 * MS_PER_DAY);
    expect(w.expiresAt.toISOString()).toBe('2027-06-01T12:00:00.000Z');
  });

  it.each([1, 7, 30, 365, 3650])('honours a validity of %i days', (days) => {
    const w = computeGrantWindow({ decidedAt: DECIDED, validityDays: days });
    expect(w.expiresAt.getTime() - DECIDED.getTime()).toBe(days * MS_PER_DAY);
  });

  it('does not mutate the date it was handed', () => {
    // The caller reuses `decidedAt` for the decision row and the audit row. A
    // module that mutated it would silently re-date both.
    const before = DECIDED.getTime();
    computeGrantWindow({ decidedAt: DECIDED, validityDays: 30 });
    expect(DECIDED.getTime()).toBe(before);
  });
});

describe('computeGrantWindow — the boundary', () => {
  it('authorizes work right up to the instant before expiry', () => {
    const w = computeGrantWindow({ decidedAt: DECIDED, validityDays: 1 });
    const oneMsEarly = new Date(w.expiresAt.getTime() - 1);
    expect(
      authorizesWork({ status: 'ACTIVE', expiresAt: w.expiresAt, revokedAt: null }, oneMsEarly),
    ).toBe(true);
  });

  it('authorizes nothing AT the expiry instant', () => {
    // The half-open window [grantedAt, expiresAt). Agreeing with
    // authorizesWork() here is the point: two definitions of "live" that
    // disagree by one millisecond is a bug nobody would ever reproduce.
    const w = computeGrantWindow({ decidedAt: DECIDED, validityDays: 1 });
    expect(
      authorizesWork({ status: 'ACTIVE', expiresAt: w.expiresAt, revokedAt: null }, w.expiresAt),
    ).toBe(false);
  });

  it('authorizes work at the very instant it was granted', () => {
    const w = computeGrantWindow({ decidedAt: DECIDED, validityDays: 1 });
    expect(
      authorizesWork({ status: 'ACTIVE', expiresAt: w.expiresAt, revokedAt: null }, w.grantedAt),
    ).toBe(true);
  });
});

describe('computeGrantWindow — refusals', () => {
  it.each([0, -1, -365])(
    'refuses a validity of %i days rather than issuing a dead grant',
    (days) => {
      // An approval that reports success while authorising nothing is worse than
      // a refusal: the provider is told they may work and then cannot, and no
      // error was ever raised for anyone to act on.
      expect(() => computeGrantWindow({ decidedAt: DECIDED, validityDays: days })).toThrow(
        GrantValidityError,
      );
    },
  );

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a non-integer validity (%p)',
    (days) => {
      expect(() => computeGrantWindow({ decidedAt: DECIDED, validityDays: days })).toThrow(
        GrantValidityError,
      );
    },
  );

  it('reports INVALID_VALIDITY_DAYS as the code, not a bare Error', () => {
    // The caller maps this to a safe client-facing failure; it needs to
    // discriminate it from a genuine internal fault.
    try {
      computeGrantWindow({ decidedAt: DECIDED, validityDays: 0 });
      fail('expected a throw');
    } catch (err) {
      expect((err as GrantValidityError).code).toBe('INVALID_VALIDITY_DAYS');
    }
  });

  it('refuses a validity so large the window is not a real date', () => {
    expect(() =>
      computeGrantWindow({ decidedAt: DECIDED, validityDays: Number.MAX_SAFE_INTEGER }),
    ).toThrow(GrantValidityError);
  });
});

describe('clock movement between reads cannot corrupt the window', () => {
  it('is a pure function of the instant it is given', () => {
    // The defence: ONE clock read enters, one window leaves. If the module
    // read the clock itself, an NTP correction landing between the start and
    // end reads could produce a grant that expires before it begins — and the
    // approval would report success.
    const a = computeGrantWindow({ decidedAt: DECIDED, validityDays: 365 });
    const b = computeGrantWindow({ decidedAt: DECIDED, validityDays: 365 });
    expect(a).toEqual(b);
  });

  it('still produces a forward window when the decision instant is in the past', () => {
    // A retried approval carrying an older decision instant must still yield a
    // window measured from THAT decision, not from now.
    const old = new Date('2020-01-01T00:00:00.000Z');
    const w = computeGrantWindow({ decidedAt: old, validityDays: 365 });
    expect(w.expiresAt.getTime()).toBeGreaterThan(w.grantedAt.getTime());
    expect(w.expiresAt.toISOString()).toBe('2020-12-31T00:00:00.000Z');
  });
});

describe('the settings key', () => {
  it('is the whitelisted admin key, so the number enforced is the number shown', () => {
    expect(GRANT_VALIDITY_DAYS_KEY).toBe('verification_work_grant_validity_days');
  });
});
