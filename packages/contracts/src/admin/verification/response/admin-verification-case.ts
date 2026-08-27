// Sprint 9B — what a reviewer is shown about a verification case.
//
// docs/adr/0009-restricted-identity-media.md · docs/adr/0013
//
// THIS DTO CARRIES METADATA ONLY. No bytes, no storage key, no signed URL, no
// credential. A reviewer who wants to see a document mints a short-lived,
// single-use read for that one asset through a separate call, and that read is
// audited (ADR 0009 §3).
//
// The distinction matters for caching: this payload is safe to hold in a
// TanStack Query cache, and a signed URL is not. Putting one in the same object
// would mean every list render persists a credential in browser memory long
// after it should have expired.

export type VerificationCaseStateCode =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'ACTION_REQUIRED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED';

export type VerificationDocumentKindCode =
  | 'INDIVIDUAL_IDENTITY'
  | 'BUSINESS_REGISTRATION'
  | 'AUTHORIZED_REPRESENTATIVE_IDENTITY'
  | 'CATEGORY_LICENSE';

/** Mirrors MediaScanState. The client renders `CLEAN` as viewable and every
 *  other value as not-yet-viewable, so a new state added server-side fails
 *  closed in the UI rather than becoming silently viewable. */
export type MediaScanStateCode =
  | 'PENDING'
  | 'CLEAN'
  | 'QUARANTINED'
  | 'SCAN_FAILED'
  /** Sprint 9B.4 — refused at validation (disallowed, malformed, truncated or
   *  dishonestly labelled). Distinct from QUARANTINED, which means malware. */
  | 'REJECTED';

/** One piece of evidence, as a reviewer sees it before opening it. */
export interface AdminVerificationDocument {
  id: string;
  kind: VerificationDocumentKindCode;
  /** Set for CATEGORY_LICENSE only: which trade this licence satisfies. */
  serviceCategoryId: string | null;
  serviceCategoryLabelEn: string | null;
  serviceCategoryLabelAr: string | null;
  /** What the bytes turned out to be — never what the uploader claimed. */
  detectedMimeType: string | null;
  sizeBytes: number;
  /** Sanitised display label. Never used to build a path, and double
   *  extensions are already defused server-side. */
  displayFilename: string | null;
  scanState: MediaScanStateCode;
  /** Only a CLEAN asset can be opened. Computed server-side so the client is
   *  not deriving an authorization rule (the D-3 lesson). */
  viewable: boolean;
  uploadedAt: string;
  /** Present once the bytes have been deleted under the retention schedule.
   *  The row survives the file (ADR 0012), so a reviewer can still see WHAT
   *  was shown and when, without the document existing. */
  evidenceDeletedAt: string | null;
  supersededAt: string | null;
}

/** A requirement the policy demands, and whether it is satisfied. */
export interface AdminVerificationRequirement {
  kind: VerificationDocumentKindCode;
  serviceCategoryId: string | null;
  serviceCategoryLabelEn: string | null;
  serviceCategoryLabelAr: string | null;
  satisfied: boolean;
}

export interface AdminVerificationDecision {
  id: string;
  outcome: string;
  reasonCode: string;
  fromState: VerificationCaseStateCode;
  toState: VerificationCaseStateCode;
  policyVersion: string;
  decidedByUserId: string | null;
  decidedAt: string;
}

/**
 * Whether the provider can take work RIGHT NOW, and on what basis.
 *
 * Sprint 9B.12 — a reviewer about to revoke had no way to see whether there
 * was anything to revoke, and a reviewer looking at a VERIFIED case could not
 * tell an active grant from one that lapsed last week. Those are different
 * decisions, and the difference was not on the surface at all.
 *
 * Deliberately the ACCESS answer, not the row: `active` is computed with the
 * same read-time predicate the capability service uses (ADR 0013), so a grant
 * whose expiry has passed reports inactive even though no sweep has relabelled
 * it. A reviewer must never be shown "ACTIVE" for access that is already gone.
 */
export interface AdminWorkAccessStatus {
  active: boolean;
  /** Why the grant exists: earned, backfilled, or handed out. */
  source: string | null;
  status: string | null;
  grantedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

/** The case as a reviewer sees it. */
export interface AdminVerificationCase {
  id: string;
  providerProfileId: string;
  state: VerificationCaseStateCode;
  /** The version this case is judged under. Stamped at submission, so a policy
   *  published later has no effect on it. */
  policyVersion: string;
  country: string | null;
  providerType: 'INDIVIDUAL' | 'BUSINESS' | null;
  submittedAt: string | null;
  assignedToUserId: string | null;
  assignedAt: string | null;
  decidedAt: string | null;
  requirements: AdminVerificationRequirement[];
  documents: AdminVerificationDocument[];
  decisions: AdminVerificationDecision[];
  /** Server-computed. The client renders these and owns no transition rule —
   *  the whole point of D-3. Includes only what THIS reviewer may do, so a
   *  self-review is already absent rather than rendered-then-refused. */
  availableActions: VerificationCaseActionCode[];
  /** Why an action a reviewer might expect is absent. Stable codes, no policy
   *  detail. */
  blockedReason: 'SELF_REVIEW' | 'TERMINAL_STATE' | 'NOT_SUBMITTED' | null;
  /** Sprint 9B.12 — whether this provider can take work right now. Null when
   *  they have never held a grant. */
  workAccess: AdminWorkAccessStatus | null;
}

export type VerificationCaseActionCode =
  | 'assign'
  | 'requestAction'
  | 'approve'
  | 'reject'
  | 'reverify'
  | 'revoke';

/** A minted read for ONE asset. Short-lived and single-use.
 *
 *  Deliberately NOT part of AdminVerificationCase: this is a credential, and it
 *  must never be cached alongside list metadata. The client fetches it on
 *  demand, uses it once, and revokes the resulting object URL. */
export interface EvidenceReadAuthorization {
  /** Relative API path the client GETs. Carries no storage key. */
  url: string;
  /** ISO timestamp. The client re-mints rather than retrying after this. */
  expiresAt: string;
}
