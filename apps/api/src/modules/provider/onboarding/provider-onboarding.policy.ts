import type { ProviderOnboardingIssue } from '@homeservicemarketplace/contracts';

// Phase 4 — the provider onboarding COMPLETENESS POLICY.
//
// One definition, used by three call sites so they cannot drift:
//   - GET  /v1/me/provider/onboarding      — tells the app what is missing
//   - POST /v1/me/provider/submit-for-review — refuses an incomplete submission
//   - the Provider app's Submit button      — enabled from the same answer
//
// Duplicating the rules in the client is what produces a Submit button that is
// enabled and then 422s, so the client is given the server's answer instead of
// re-deriving it.
//
// Every failure is a machine-readable {field, code} pair rather than prose:
// the app maps each to a localised message and can focus the offending input,
// and tests can assert on the set without depending on copy.

// Minimum useful lengths. A one-character headline technically satisfies
// "present" while telling a seeker nothing, so PRESENT and USEFUL are checked
// separately and reported with different codes.
export const MIN_HEADLINE_LENGTH = 10;
export const MIN_BIO_LENGTH = 40;
export const MIN_DISPLAY_NAME_LENGTH = 2;

export interface OnboardingCandidate {
  displayName: string | null;
  headline: string | null;
  bio: string | null;
  phoneNumber: string | null;
  serviceAreaCity: string | null;
  serviceAreaCountry: string | null;
  serviceAreaRadiusKm: number | null;
  serviceCategoryCount: number;
  /**
   * The OWNING ACCOUNT's email verification. A provider application is
   * reviewable only from an identity we can actually contact — otherwise the
   * review queue fills with addresses nobody controls.
   */
  emailVerified: boolean;
}

export function evaluateOnboarding(candidate: OnboardingCandidate): ProviderOnboardingIssue[] {
  const issues: ProviderOnboardingIssue[] = [];

  const displayName = trimmed(candidate.displayName);
  if (!displayName) {
    issues.push({ field: 'displayName', code: 'REQUIRED' });
  } else if (displayName.length < MIN_DISPLAY_NAME_LENGTH) {
    issues.push({ field: 'displayName', code: 'TOO_SHORT' });
  }

  const headline = trimmed(candidate.headline);
  if (!headline) {
    issues.push({ field: 'headline', code: 'REQUIRED' });
  } else if (headline.length < MIN_HEADLINE_LENGTH) {
    issues.push({ field: 'headline', code: 'TOO_SHORT' });
  }

  const bio = trimmed(candidate.bio);
  if (!bio) {
    issues.push({ field: 'bio', code: 'REQUIRED' });
  } else if (bio.length < MIN_BIO_LENGTH) {
    issues.push({ field: 'bio', code: 'TOO_SHORT' });
  }

  if (!trimmed(candidate.phoneNumber)) {
    issues.push({ field: 'phoneNumber', code: 'REQUIRED' });
  }

  // Contact verification is its own axis: a present-but-unverified email is a
  // different problem from a missing one, and the app should say so.
  if (!candidate.emailVerified) {
    issues.push({ field: 'emailVerified', code: 'UNVERIFIED' });
  }

  if (!trimmed(candidate.serviceAreaCity)) {
    issues.push({ field: 'serviceAreaCity', code: 'REQUIRED' });
  }
  if (!trimmed(candidate.serviceAreaCountry)) {
    issues.push({ field: 'serviceAreaCountry', code: 'REQUIRED' });
  }
  // A null OR non-positive radius means "no service area", which makes the
  // provider unmatched by every request — reviewing that is pointless.
  if (candidate.serviceAreaRadiusKm === null || candidate.serviceAreaRadiusKm <= 0) {
    issues.push({ field: 'serviceAreaRadiusKm', code: 'REQUIRED' });
  }

  if (candidate.serviceCategoryCount < 1) {
    issues.push({ field: 'serviceCategories', code: 'REQUIRED' });
  }

  return issues;
}

export function isOnboardingComplete(candidate: OnboardingCandidate): boolean {
  return evaluateOnboarding(candidate).length === 0;
}

function trimmed(value: string | null): string | null {
  const v = (value ?? '').trim();
  return v.length > 0 ? v : null;
}
