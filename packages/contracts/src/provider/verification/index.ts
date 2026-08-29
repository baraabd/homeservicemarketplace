// Sprint 9B.2 — the provider's own view of their verification case.
//
//   POST /v1/me/provider/verification/case   — create, or resume the open one
//   GET  /v1/me/provider/verification/case   — the current case, or null
//
// The provider is not told which policy row matched or why. They are told what
// they must produce, which is the only part they can act on; the reasoning is a
// reviewer and audit concern.
//
// NOTE ON THE POST. It is not idempotent in the HTTP sense, but it IS idempotent
// in effect: with a case already open it resumes rather than creating a second
// one, and `created` says which happened. A client that retries after a timeout
// gets the same case back, not a duplicate.

import type {
  MediaScanStateCode,
  VerificationCaseStateCode,
  VerificationDocumentKindCode,
} from '../../admin';

/** One thing the provider still has to produce. Mirrors the resolver's
 *  ResolvedRequirement, minus the policy version that demanded it — which
 *  matters to a reviewer, not to the person uploading a passport. */
export interface ProviderVerificationRequirement {
  kind: VerificationDocumentKindCode;
  /** Set for CATEGORY_LICENSE only: which trade this licence satisfies. */
  serviceCategoryId: string | null;
}

/**
 * What a PROVIDER may do to their own case.
 *
 * A deliberately separate vocabulary from the reviewer's
 * `VerificationCaseActionCode`, which names `approve`, `reject`, `revoke` and
 * the rest. Reusing that type here would make a reviewer's decision
 * type-reachable from the provider surface — the compiler would stop
 * complaining about exactly the confusion this contract exists to prevent.
 *
 * One member today, and that is the honest size of it: the transition table
 * gives a provider `submit` (from DRAFT and from ACTION_REQUIRED, which is why
 * resubmission needs no second code path) and nothing else.
 */
export type ProviderVerificationCaseActionCode = 'submit';

export interface ProviderVerificationCase {
  id: string;
  state: VerificationCaseStateCode;
  /** The policy version this case was opened under. Stamped once and never
   *  changed: a policy published tomorrow does not move the goalposts for a
   *  case opened today. */
  policyVersion: string;
  createdAt: string;
  submittedAt: string | null;
  /** Whether identity verification applies at all under the resolved policy. */
  verificationRequired: boolean;
  /** The full requirement set, snapshotted onto the case at creation. */
  requirements: ProviderVerificationRequirement[];
  /** Sprint 9B.11 — what has actually been supplied, and its scan verdict. */
  documents: ProviderVerificationDocument[];
  /** Sprint 9B.11 — the latest reviewer decision, or null before any. */
  latestDecision: ProviderVerificationDecisionSummary | null;
  /**
   * Sprint 9B.24 — what the PROVIDER may do to this case right now.
   *
   * Server-computed from the one transition table (`offerableCaseActions`
   * with actor 'provider'), exactly as the reviewer surface already receives
   * its own list. The client renders these and derives nothing — which is the
   * D-3 lesson written into case-transitions.ts: the admin table once offered
   * an Approve button the backend answered with 409, because two copies of a
   * rule had drifted.
   *
   * Offerable, not merely legal: an action appears here only if a command
   * behind it actually works today. Withholding is safe; inventing is not.
   */
  availableActions: ProviderVerificationCaseActionCode[];
  /**
   * When the case last changed, for "last updated" on the status screen.
   *
   * Distinct from `submittedAt`, which is when the provider handed it in and
   * never moves again. A provider watching a case wants both: what they did,
   * and whether anything has happened since.
   */
  updatedAt: string;
}

/**
 * One document the provider has already uploaded, and where it stands.
 *
 * Sprint 9B.11 — the provider surface could previously say WHAT was required
 * but never what had happened to what was supplied. Without this a provider
 * whose passport is being scanned, was quarantined, or was rejected sees the
 * same screen as one who uploaded nothing, which is the difference between
 * "wait" and "act".
 *
 * `scanState` is the media pipeline's own verdict (Sprint 9B.4):
 *
 *   PENDING      still being checked
 *   CLEAN        accepted
 *   QUARANTINED  malware found — the file is withheld, not deleted
 *   SCAN_FAILED  the scanner could not reach a verdict; fail closed
 *   REJECTED     refused before scanning (format, size, truncation)
 */
export interface ProviderVerificationDocument {
  id: string;
  kind: VerificationDocumentKindCode;
  serviceCategoryId: string | null;
  scanState: MediaScanStateCode;
  uploadedAt: string;
  /** True once a replacement has been accepted for the same requirement. A
   *  superseded document stays visible so a provider can see what changed. */
  superseded: boolean;
}

/**
 * The most recent reviewer decision, as a CODE.
 *
 * Deliberately the code and never `reviewerNotes`. The reason code is a
 * stable, translatable fact the provider can act on; the reviewer's prose is
 * internal writing about a person, and Sprint 9B.5 already keeps it off the
 * notification for the same reason. The provider sees WHY in their own
 * language, not what a stranger typed about them.
 */
export interface ProviderVerificationDecisionSummary {
  outcome:
    | 'ACTION_REQUIRED'
    | 'REJECTED'
    | 'APPROVED'
    | 'REVERIFY_REQUIRED'
    | 'REVOKED'
    | 'EXPIRED';
  reasonCode: string;
  decidedAt: string;
}

export interface CreateVerificationCaseRequest {
  /**
   * Optional client-generated replay key, unique per provider.
   *
   * Resuming the open case already covers the ordinary retry. This covers the
   * one it cannot: a first attempt that has since been REJECTED, where a naive
   * retry would start a second attempt nobody asked for.
   */
  idempotencyKey?: string;
}

export interface CreateVerificationCaseResponse {
  case: ProviderVerificationCase;
  /** False when an existing case was resumed. */
  created: boolean;
}

export interface CurrentVerificationCaseResponse {
  /** Null when the provider has never started verification. */
  case: ProviderVerificationCase | null;
}

// Sprint 9B.3 — the restricted evidence upload lifecycle.
export * from './evidence';
