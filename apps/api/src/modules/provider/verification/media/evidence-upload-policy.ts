import type { MediaScanState } from '@homeservicemarketplace/database';

import { isEvidenceMimeType } from './file-signature';

// Sprint 9B.3 — what may be prepared, and what a finalize call should do.
//
// docs/adr/0009-restricted-identity-media.md
//
// Pure, following requirement-resolver.ts and case-creation-policy.ts. Bytes,
// storage objects and rows are the service's problem; the DECISIONS live here
// so the cross-product is testable without a disk.

/**
 * The scan state a freshly uploaded piece of evidence starts in.
 *
 * PENDING, not QUARANTINED, and the distinction is not cosmetic. In this schema
 * QUARANTINED means "failed the scan": it is terminal, and ADR 0012 gives it
 * the LONGEST retention window precisely because a malware sample is the
 * evidence of an attack. Marking an unscanned file that way would fabricate a
 * verdict nobody reached and would hold an innocent provider's passport under
 * the malware policy.
 *
 * PENDING already provides everything "quarantine on arrival" is meant to
 * provide: evidence-read.policy.ts denies anything whose state is not exactly
 * CLEAN, so a PENDING object is unreadable by its owner and by every reviewer
 * until 9B.4's scanner moves it. The guarantee is the same; only the audit
 * meaning differs, and it differs in the direction that stays true.
 */
export const INITIAL_EVIDENCE_SCAN_STATE: MediaScanState = 'PENDING';

export interface EvidenceLimits {
  /** Largest single object, in bytes. Enforced against RECEIVED length. */
  maxBytes: number;
  /** Live (non-superseded) documents one case may hold. */
  maxDocumentsPerCase: number;
  /** How long a prepared upload stays usable. */
  uploadTtlSeconds: number;
}

export type EvidenceUploadErrorCode =
  | 'DISALLOWED_FORMAT'
  | 'TOO_LARGE'
  | 'INVALID_SIZE'
  | 'TOO_MANY_DOCUMENTS'
  | 'OBJECT_MISSING'
  | 'UPLOAD_EXPIRED'
  | 'ASSET_DELETED'
  | 'INCONSISTENT_STATE';

export class EvidenceUploadError extends Error {
  constructor(
    message: string,
    readonly code: EvidenceUploadErrorCode,
  ) {
    super(message);
    this.name = 'EvidenceUploadError';
  }
}

/**
 * May this upload be prepared at all?
 *
 * Everything here is checkable BEFORE a byte is accepted, which is the point:
 * the cheapest place to refuse a 400 MB file is before it is transferred.
 *
 * Note what is NOT decided here: whether the bytes really are what the client
 * claimed. That cannot be known until they arrive, and is
 * verifyEvidenceSignature's job at finalize.
 */
export function assertPrepareAllowed(input: {
  declaredMime: string;
  sizeBytes: number;
  /** Live, non-superseded documents already on the case. */
  liveDocumentCount: number;
  limits: EvidenceLimits;
}): void {
  const { declaredMime, sizeBytes, liveDocumentCount, limits } = input;

  // The evidence allowlist is deliberately narrower than the public media one:
  // no SVG (script execution), no HEIC, no video.
  if (!isEvidenceMimeType(declaredMime)) {
    throw new EvidenceUploadError(
      'Identity evidence must be a PDF, JPEG or PNG.',
      'DISALLOWED_FORMAT',
    );
  }

  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw new EvidenceUploadError(
      'Declared size must be a positive whole number of bytes.',
      'INVALID_SIZE',
    );
  }

  if (sizeBytes > limits.maxBytes) {
    throw new EvidenceUploadError(`Evidence may be at most ${limits.maxBytes} bytes.`, 'TOO_LARGE');
  }

  if (liveDocumentCount >= limits.maxDocumentsPerCase) {
    throw new EvidenceUploadError(
      `This case already holds the maximum of ${limits.maxDocumentsPerCase} documents.`,
      'TOO_MANY_DOCUMENTS',
    );
  }
}

export type FinalizeDecision = { action: 'COMPLETE' } | { action: 'ALREADY_FINALIZED' };

/**
 * What should a finalize call actually do?
 *
 * Called after a client PUT that may have succeeded, failed, half-happened or
 * happened twice, so the state space is wider than the happy path suggests.
 * The order of the checks is load-bearing:
 *
 *   1. deleted        — the bytes are gone; nothing can be completed.
 *   2. already done   — the idempotent answer, and it must come BEFORE the TTL
 *                       check: the window governs UPLOADING, not the record
 *                       afterwards, so an hour-late retry still gets its answer.
 *   3. inconsistent   — a half-written pair. Unreachable while the write stays
 *                       one transaction; completing on top would double-write
 *                       rather than repair, so it stops instead.
 *   4. expired        — before the object check, or a slow uploader whose bytes
 *                       did land would silently revive a stale capability.
 *   5. object missing — the PUT never happened. Completing would leave an
 *                       ACTIVE document pointing at nothing.
 */
export function decideFinalize(input: {
  asset: { uploadCompletedAt: Date | null; createdAt: Date; deletedAt: Date | null };
  objectExists: boolean;
  hasDocument: boolean;
  now: Date;
  ttlSeconds: number;
}): FinalizeDecision {
  const { asset, objectExists, hasDocument, now, ttlSeconds } = input;

  if (asset.deletedAt !== null) {
    throw new EvidenceUploadError('This upload is no longer available.', 'ASSET_DELETED');
  }

  const completed = asset.uploadCompletedAt !== null;

  if (completed && hasDocument) return { action: 'ALREADY_FINALIZED' };

  if (completed !== hasDocument) {
    throw new EvidenceUploadError(
      'This upload is in an inconsistent state and cannot be completed.',
      'INCONSISTENT_STATE',
    );
  }

  const ageSeconds = (now.getTime() - asset.createdAt.getTime()) / 1000;
  if (ageSeconds > ttlSeconds) {
    throw new EvidenceUploadError('This upload window has expired. Start again.', 'UPLOAD_EXPIRED');
  }

  if (!objectExists) {
    throw new EvidenceUploadError('No uploaded file was found for this request.', 'OBJECT_MISSING');
  }

  return { action: 'COMPLETE' };
}
