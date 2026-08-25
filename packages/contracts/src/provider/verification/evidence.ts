// Sprint 9B.3 — the restricted evidence upload lifecycle, over the wire.
//
//   POST /v1/me/provider/verification/evidence/prepare
//   PUT  /v1/me/provider/verification/evidence/:assetId/content
//   POST /v1/me/provider/verification/evidence/:assetId/finalize
//
// docs/adr/0009-restricted-identity-media.md
//
// THREE STEPS, NOT ONE. Prepare does the expensive checks — case state,
// requirement match, per-case limits — before a byte is transferred, so a
// 10 MiB upload is refused before it is sent rather than after. Content is the
// only step that moves bytes. Finalize proves the object is really there before
// anything is marked complete, which is what stops an active document pointing
// at nothing.
//
// WHAT THE SERVER NEVER RETURNS: the storage key, the bucket, any URL, and any
// signed token. A reviewer or owner reads a document by asking the API, which
// authorises against the database and audits the read. A URL would be a bearer
// capability outliving the check that produced it.

import type { VerificationDocumentKindCode } from '../../admin';

export interface PrepareEvidenceUploadRequest {
  kind: VerificationDocumentKindCode;
  /** Required for CATEGORY_LICENSE, and rejected for every other kind: a
   *  licence is meaningless without the trade it covers, and the other kinds
   *  ignore it. */
  serviceCategoryId?: string | null;
  /** What the client BELIEVES it is uploading. Checked against the leading
   *  bytes at the content step; a mismatch is rejected and nothing is stored. */
  declaredMimeType: string;
  /** What the client BELIEVES the length is. Used only for an early refusal —
   *  the stored size is counted server-side from the bytes that arrive. */
  sizeBytes: number;
  /** Display only. Sanitised server-side and never used to build a path. */
  filename?: string | null;
}

export interface PrepareEvidenceUploadResponse {
  /** Address the content PUT to this. It is an opaque id, not a location. */
  assetId: string;
  /** After this instant the preparation is dead and the bytes are refused. */
  expiresAt: string;
  /** The server-enforced ceiling, so a client can fail fast rather than
   *  transferring a file that will be cut off. */
  maxBytes: number;
  /** False when an existing open preparation for the same slot was returned —
   *  the ordinary retry. */
  created: boolean;
}

export interface UploadEvidenceContentResponse {
  assetId: string;
  /** Counted from the bytes received, not from Content-Length. */
  sizeBytes: number;
  /** Determined from the leading bytes, not from the declared type. */
  detectedMimeType: string;
}

export interface FinalizeEvidenceUploadResponse {
  documentId: string;
  assetId: string;
  kind: VerificationDocumentKindCode;
  serviceCategoryId: string | null;
  /**
   * Always `PENDING` immediately after finalize.
   *
   * `CLEAN` is the only readable state, and only the scanner may grant it. A
   * client that renders anything other than "waiting to be checked" here is
   * wrong, and will stay wrong safely: the read route refuses every state
   * except CLEAN.
   */
  scanState: string;
  /** False when an already-finalized upload was returned — the idempotent
   *  replay. */
  created: boolean;
}

/**
 * Stable failure codes, carried in the error `details.reason`.
 *
 * Absent from this list on purpose: anything that distinguishes "not yours"
 * from "does not exist". Both answer a bare 404 with no reason at all, because
 * a finer answer is an enumeration oracle over identity documents.
 */
export type EvidenceUploadReasonCode =
  | 'NOT_REQUIRED'
  | 'DISALLOWED_FORMAT'
  | 'INVALID_SIZE'
  | 'TOO_LARGE'
  | 'TOO_MANY_DOCUMENTS'
  | 'EMPTY_FILE'
  | 'STREAM_FAILED'
  | 'UNRECOGNISED_FORMAT'
  | 'DECLARED_TYPE_MISMATCH'
  | 'ALREADY_FINALIZED'
  | 'UPLOAD_EXPIRED'
  | 'OBJECT_MISMATCH'
  | 'INCONSISTENT_STATE';
