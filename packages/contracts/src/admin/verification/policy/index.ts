// Sprint 9B.2 — versioned verification requirement policies.
//
//   GET  /v1/admin/verification/policies                  — every version
//   POST /v1/admin/verification/policies                  — publish a version
//   POST /v1/admin/verification/policies/:version/retire  — retire a version
//
// docs/adr/0010-policy-versioned-verification.md
//
// There is deliberately NO update route. Policies are append-only: correcting
// one means publishing a new version and retiring the old, so "what were they
// judged against?" always has an answer that did not change after the fact.
//
// The requirements payload is JSON so a new document kind needs no migration.
// It is validated at publish time and never re-validated afterwards — a rule
// added today must not invalidate a decision made honestly last month.

import type { VerificationDocumentKindCode } from '../response/admin-verification-case';
// Re-used, not redeclared. A second `ProviderTypeCode` would compile until the
// day the two definitions disagree, and then disagree silently.
import type { ProviderTypeCode } from '../../../provider/onboarding/response/provider-onboarding-draft';

export type { ProviderTypeCode };

/** The shape stored in `VerificationRequirementPolicy.requirements`. */
export interface VerificationPolicyRequirements {
  documents: VerificationDocumentKindCode[];
  /**
   * When false, this scope needs no identity verification at all. Explicit
   * rather than inferred from an empty list, because "not required here" and
   * "nobody has configured this yet" are different facts and only one of them
   * is safe to act on.
   */
  verificationRequired: boolean;
}

export interface VerificationPolicySummary {
  /** `YYYY.MM-scope-vN`. Opaque, sortable, readable in a log line. */
  version: string;
  /** ISO 3166-1 alpha-2, or null for the global default. */
  country: string | null;
  /** Null applies to both individual and business providers. */
  providerType: ProviderTypeCode | null;
  /** Null is a base policy. Set makes it a category licence rule, which ADDS
   *  to the base rather than replacing it. */
  categoryId: string | null;
  requirements: VerificationPolicyRequirements;
  publishedAt: string;
  retiredAt: string | null;
  publishedByUserId: string | null;
  /** Server-computed: published, and not yet retired. The client never derives
   *  this from the dates, for the same reason it never derives availableActions. */
  isLive: boolean;
}

export interface PublishVerificationPolicyRequest {
  version: string;
  country?: string | null;
  providerType?: ProviderTypeCode | null;
  categoryId?: string | null;
  requirements: VerificationPolicyRequirements;
  /** Defaults to now. May be scheduled forward, never back-dated. */
  publishedAt?: string;
}

export interface ListVerificationPoliciesResponse {
  policies: VerificationPolicySummary[];
}

export interface VerificationPolicyMutationResponse {
  policy: VerificationPolicySummary;
}
