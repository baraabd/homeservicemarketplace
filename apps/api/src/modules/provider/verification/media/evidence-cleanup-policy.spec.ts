import {
  CLEANUP_GRACE_SECONDS,
  cleanupDeletionReason,
  isSweepable,
} from './evidence-cleanup-policy';

// Sprint 9B.3 — which prepared uploads the sweep is allowed to destroy.
//
// docs/adr/0009-restricted-identity-media.md · docs/adr/0012 (retention)
//
// This is a DELETION rule for a bucket that holds passports, so the interesting
// tests are all about what it must refuse to touch. A sweep that is slightly
// too slow costs disk. A sweep that is slightly too eager destroys a provider's
// identity document mid-upload, and there is no undo.

const NOW = new Date('2026-08-25T12:00:00Z');
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000);
const secondsAhead = (s: number) => new Date(NOW.getTime() + s * 1000);

const prepared = (over: Partial<Parameters<typeof isSweepable>[0]['asset']> = {}) => ({
  uploadCompletedAt: null as Date | null,
  deletedAt: null as Date | null,
  uploadExpiresAt: secondsAgo(CLEANUP_GRACE_SECONDS + 60) as Date | null,
  ...over,
});

const sweepable = (over: Partial<Parameters<typeof isSweepable>[0]['asset']> = {}): boolean =>
  isSweepable({ asset: prepared(over), now: NOW });

describe('what the sweep destroys', () => {
  it('destroys a preparation that expired beyond the grace period', () => {
    expect(sweepable()).toBe(true);
  });
});

describe('what the sweep must never touch', () => {
  it('refuses a FINALIZED upload', () => {
    // The document exists and a reviewer may already have judged it. Deleting
    // the bytes here would leave an active document pointing at nothing.
    expect(sweepable({ uploadCompletedAt: secondsAgo(9999) })).toBe(false);
  });

  it('refuses an already-deleted asset', () => {
    // Idempotence: a second sweep over the same row is a no-op, not a second
    // delete attempt that could race a retention job.
    expect(sweepable({ deletedAt: secondsAgo(10) })).toBe(false);
  });

  it('refuses a preparation that has not expired yet', () => {
    expect(sweepable({ uploadExpiresAt: secondsAhead(600) })).toBe(false);
  });

  it('refuses an asset with no expiry recorded at all', () => {
    // Null means "not a prepared upload the sweep understands" — a public
    // asset, or a row written before this column existed. Guessing an expiry
    // for it would be the sweep inventing a deletion mandate.
    expect(sweepable({ uploadExpiresAt: null })).toBe(false);
  });

  it('refuses a finalized upload even when its expiry has passed', () => {
    // The expiry governs the UPLOAD WINDOW, not the finished record. A
    // finalized document whose old window lapsed is an ordinary document.
    expect(
      sweepable({
        uploadCompletedAt: secondsAgo(10),
        uploadExpiresAt: secondsAgo(99999),
      }),
    ).toBe(false);
  });
});

describe('the grace period', () => {
  it('is long enough to outlast a finalize already in flight', () => {
    // finalize() refuses an expired preparation, so the two agree on the
    // boundary — but a finalize that PASSED that check microseconds before
    // expiry is still running. Sweeping at the instant of expiry could delete
    // the object between its head() check and its database write.
    expect(CLEANUP_GRACE_SECONDS).toBeGreaterThanOrEqual(60);
  });

  it('refuses a preparation that expired within the grace period', () => {
    expect(sweepable({ uploadExpiresAt: secondsAgo(CLEANUP_GRACE_SECONDS - 1) })).toBe(false);
  });

  it('accepts one that expired just outside it', () => {
    expect(sweepable({ uploadExpiresAt: secondsAgo(CLEANUP_GRACE_SECONDS + 1) })).toBe(true);
  });
});

describe('the deletion reason', () => {
  it('records why the bytes went, not just that they went', () => {
    // ADR 0012 keeps deletionReason because "we deleted it" and "it was never
    // finished" answer different questions in an audit six months later.
    expect(cleanupDeletionReason()).toBe('ABANDONED_UPLOAD');
  });

  it('is distinguishable from a retention deletion', () => {
    // A retention sweep deletes evidence that WAS verified. Sharing a reason
    // code would make the two indistinguishable in exactly the report where
    // the difference matters.
    expect(cleanupDeletionReason()).not.toBe('RETENTION');
  });
});
