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

import type { VerificationCaseStateCode, VerificationDocumentKindCode } from '../../admin';

/** One thing the provider still has to produce. Mirrors the resolver's
 *  ResolvedRequirement, minus the policy version that demanded it — which
 *  matters to a reviewer, not to the person uploading a passport. */
export interface ProviderVerificationRequirement {
  kind: VerificationDocumentKindCode;
  /** Set for CATEGORY_LICENSE only: which trade this licence satisfies. */
  serviceCategoryId: string | null;
}

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
