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
   */
  code: 'REQUIRED' | 'TOO_SHORT' | 'UNVERIFIED';
}
