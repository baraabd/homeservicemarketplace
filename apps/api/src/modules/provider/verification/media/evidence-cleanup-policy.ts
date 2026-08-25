// Sprint 9B.3 — which prepared uploads the cleanup sweep may destroy.
//
// docs/adr/0009-restricted-identity-media.md · docs/adr/0012 (retention)
//
// A deletion rule for a bucket that holds passports. The asymmetry is the whole
// design: a sweep that runs slightly late costs disk, while a sweep that runs
// slightly early destroys a provider's identity document mid-upload, and there
// is no undo. Every rule below therefore refuses when unsure.
//
// Pure, so the decision is testable without a disk or a database — the sweep
// itself only does I/O.

/**
 * How long after expiry a preparation is left alone.
 *
 * finalize() refuses an expired preparation, so the two agree on where the
 * window ends. That is not sufficient on its own: a finalize that PASSED that
 * check microseconds before expiry is still running, and it does a head()
 * against storage and then a database write. Sweeping at the instant of expiry
 * could delete the object in between, turning a successful upload into a
 * mysterious failure.
 *
 * Five minutes is far longer than that window and costs nothing but a little
 * disk.
 */
export const CLEANUP_GRACE_SECONDS = 300;

/** Why the bytes went. Distinct from a retention deletion on purpose: that one
 *  removes evidence that WAS verified, and a shared code would make the two
 *  indistinguishable in exactly the report where the difference matters. */
export function cleanupDeletionReason(): string {
  return 'ABANDONED_UPLOAD';
}

/**
 * May the sweep destroy this asset's bytes?
 *
 * Four refusals, each closing a way to delete something that matters:
 *
 *   finalized      a document exists and a reviewer may have judged it;
 *                  deleting the bytes leaves an active document pointing at
 *                  nothing.
 *   already gone   idempotence — a second sweep is a no-op rather than a second
 *                  delete racing a retention job.
 *   no expiry      null means "not a prepared upload this sweep understands"
 *                  (a public asset, or a row predating the column). Guessing an
 *                  expiry would be the sweep inventing a mandate.
 *   still in grace see CLEANUP_GRACE_SECONDS.
 */
export function isSweepable(input: {
  asset: {
    uploadCompletedAt: Date | null;
    deletedAt: Date | null;
    uploadExpiresAt: Date | null;
  };
  now: Date;
}): boolean {
  const { asset, now } = input;

  if (asset.uploadCompletedAt !== null) return false;
  if (asset.deletedAt !== null) return false;
  if (asset.uploadExpiresAt === null) return false;

  const expiredForSeconds = (now.getTime() - asset.uploadExpiresAt.getTime()) / 1000;
  return expiredForSeconds > CLEANUP_GRACE_SECONDS;
}
