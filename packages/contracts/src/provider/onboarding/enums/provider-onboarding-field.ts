// Phase 4 — machine-readable completeness codes for provider onboarding.
//
// `POST /v1/me/provider/submit-for-review` returns 422 with a list of these
// when the DRAFT profile is not complete enough to review. They are CODES, not
// prose: the Provider app maps each one to a localised message and can focus
// the offending field, and the set can be asserted in tests without depending
// on copy.
export const PROVIDER_ONBOARDING_FIELDS = [
  /** Trading name shown to seekers. */
  'displayName',
  /** Short professional headline. */
  'headline',
  /** Longer description of the services offered. */
  'bio',
  /** Contact phone number — must be present AND verified. */
  'phoneNumber',
  /** The account's email must be verified before an application is reviewable. */
  'emailVerified',
  'serviceAreaCity',
  'serviceAreaCountry',
  'serviceAreaRadiusKm',
  /** At least one service category the provider intends to work in. */
  'serviceCategories',

  // ── Sprint 8: the rest of the onboarding journey ────────────────────────
  // Additive only. Every value above keeps its meaning, so a client that
  // knows only the Phase-4 set still renders every issue it understands and
  // can fall back to a generic message for the rest.
  /** Individual or business — decides which other fields are required. */
  'providerType',
  /** Registered trading name. Businesses only. */
  'legalBusinessName',
  /** At least one weekly working window. */
  'availability',
  /** Numeric years, or a start date the server derives them from. */
  'yearsOfExperience',
  /** Accepted terms, pinned to a document version. */
  'consent',
  /** At least one selectable LEAF specialty, not just a parent group. */
  'specialties',
] as const;

export type ProviderOnboardingField = (typeof PROVIDER_ONBOARDING_FIELDS)[number];

// Wire shape of a single unmet requirement.
export interface ProviderOnboardingIssue {
  field: ProviderOnboardingField;
  /**
   * Why this field failed, as a stable code:
   *   REQUIRED   — absent or blank
   *   TOO_SHORT  — present but below the minimum useful length
   *   UNVERIFIED — present but not verified (contact details)
   *
   * Sprint 8 adds:
   *   NOT_VERIFIED — present but unproven. Distinct from UNVERIFIED, which is
   *                  the account's email; this is a field the PROVIDER must
   *                  prove (their phone), and the two have different fixes.
   *   OUT_OF_RANGE — present, well-formed, and outside the allowed bounds.
   *
   * Sprint 9B.18 adds:
   *   AWAITING_REVIEW — the provider DID supply this and an admin has not
   *                     decided yet. It still blocks submission, because the
   *                     canonical rule is that submission needs APPROVED
   *                     specialties — but it is not a mistake they made, and
   *                     reporting it as REQUIRED tells someone who chose a
   *                     specialty that they did not choose one. There is
   *                     nothing for them to fix and the copy must not imply
   *                     there is.
   */
  code:
    | 'REQUIRED'
    | 'TOO_SHORT'
    | 'UNVERIFIED'
    | 'NOT_VERIFIED'
    | 'OUT_OF_RANGE'
    | 'AWAITING_REVIEW';
}
