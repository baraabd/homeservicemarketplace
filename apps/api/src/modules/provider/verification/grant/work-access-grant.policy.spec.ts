import {
  authorizesWork,
  grantClosureFor,
  GRANT_SOURCE_FOR_APPROVAL,
  type WorkAccessGrantSnapshot,
} from './work-access-grant.policy';

// Sprint 9B.7 — does this grant authorize work RIGHT NOW?
//
// docs/adr/0013-evidence-to-work-access-capability-transition.md
//
// The single question every enforcement point will ask, and the one place it is
// answered. It is pure so the answer can be asserted exhaustively without a
// database, and it fails CLOSED in every ambiguous case: a grant authorizes
// work only when it positively says so.
//
// The failure this guards against is subtle. A grant row is not a boolean —
// it can be ACTIVE and expired, ACTIVE and revoked-a-microsecond-ago, or
// carrying an expiry that has passed while the sweep that should have marked it
// EXPIRED has not run yet. Trusting `status === 'ACTIVE'` alone means a lapsed
// grant keeps authorizing work until a background job catches up.

const NOW = new Date('2026-06-01T12:00:00Z');

function grant(over: Partial<WorkAccessGrantSnapshot> = {}): WorkAccessGrantSnapshot {
  return {
    status: 'ACTIVE',
    expiresAt: null,
    revokedAt: null,
    ...over,
  };
}

describe('authorizesWork', () => {
  it('authorizes an active grant with no expiry', () => {
    expect(authorizesWork(grant(), NOW)).toBe(true);
  });

  it('authorizes an active grant whose expiry is still ahead', () => {
    expect(authorizesWork(grant({ expiresAt: new Date('2026-07-01T00:00:00Z') }), NOW)).toBe(true);
  });

  it('refuses a grant that has no row at all', () => {
    expect(authorizesWork(null, NOW)).toBe(false);
  });

  it.each(['REVOKED', 'EXPIRED'] as const)('refuses a %s grant', (status) => {
    expect(authorizesWork(grant({ status }), NOW)).toBe(false);
  });

  it('refuses an ACTIVE grant whose expiry has passed', () => {
    // The important one. A grant lapses at its expiry, not when a background
    // sweep gets round to relabelling it — otherwise the window between those
    // two moments is unauthorised work that the system believes is authorised.
    expect(authorizesWork(grant({ expiresAt: new Date('2026-05-31T23:59:59Z') }), NOW)).toBe(false);
  });

  it('refuses an ACTIVE grant that carries a revocation timestamp', () => {
    // Belt and braces against a half-written revocation: if revokedAt is set,
    // somebody revoked it, whatever the status column says.
    expect(authorizesWork(grant({ revokedAt: new Date('2026-05-01T00:00:00Z') }), NOW)).toBe(false);
  });

  it('treats the expiry instant itself as expired', () => {
    // A grant valid "until 12:00" is not valid AT 12:00. Off by one here is an
    // hour of unauthorised work at renewal time.
    expect(authorizesWork(grant({ expiresAt: NOW }), NOW)).toBe(false);
  });

  it('refuses a status it does not recognise', () => {
    // Fails closed: a status added later authorizes nothing until someone
    // deliberately makes it authorize something.
    expect(authorizesWork(grant({ status: 'SOMETHING_NEW' as never }), NOW)).toBe(false);
  });
});

describe('grantClosureFor', () => {
  it('revocation closes the grant as REVOKED', () => {
    expect(grantClosureFor('revoke')).toBe('REVOKED');
  });

  it('expiry closes it as EXPIRED — nobody judged them badly', () => {
    expect(grantClosureFor('expire')).toBe('EXPIRED');
  });

  it('re-verification closes it as EXPIRED, not REVOKED', () => {
    // Asking for fresh evidence is not a sanction. Recording it as a revocation
    // would put a mark against a provider who did nothing wrong, in the table a
    // future reviewer reads to judge them.
    expect(grantClosureFor('reverify')).toBe('EXPIRED');
  });

  it('rejection closes nothing, because rejection never granted anything', () => {
    expect(grantClosureFor('reject')).toBeNull();
  });
});

describe('the only source of an approval grant', () => {
  it('is VERIFIED_DOCUMENTS', () => {
    // Named so a grant's origin survives in the record. MANUAL_OVERRIDE and
    // LEGACY_BACKFILL exist precisely so they stay DISTINGUISHABLE from a grant
    // somebody actually earned by having their documents checked.
    expect(GRANT_SOURCE_FOR_APPROVAL).toBe('VERIFIED_DOCUMENTS');
  });
});
