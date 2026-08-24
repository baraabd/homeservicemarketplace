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
/** Upper bound on claimed experience. Matches the database CHECK constraint;
 *  a century in the trade is a typo, not a career. */
export const MAX_YEARS_OF_EXPERIENCE = 80;

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

  // ── Sprint 8 ────────────────────────────────────────────────────────────
  // OPTIONAL on purpose. The same policy judges profiles created before the
  // wizard existed; `undefined` means "not asked" and is not an issue, while
  // `null` means "asked and empty" and is. Making these required would strand
  // every legacy applicant on data nobody ever collected from them.
  providerType?: 'INDIVIDUAL' | 'BUSINESS' | null;
  legalBusinessName?: string | null;
  phoneVerified?: boolean;
  availabilityIntervalCount?: number;
  yearsOfExperience?: number | null;
  professionSince?: Date | null;
  acceptedConsentVersion?: string | null;
  /** Selectable LEAF specialties, distinct from serviceCategoryCount which
   *  counts every granted category including legacy roots. */
  leafSpecialtyCount?: number;
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

  // ── Sprint 8: the rest of the onboarding journey ────────────────────────
  //
  // Every rule below is BACKWARD COMPATIBLE by omission: each field is
  // optional on the candidate, and a candidate that does not carry it is not
  // judged on it. That matters because the same policy is evaluated for
  // profiles created long before the wizard existed — failing them on data
  // nobody ever asked for would strand every legacy applicant in the review
  // queue with issues they cannot clear.
  //
  // The wizard always supplies the full candidate, so it is always judged in
  // full. `undefined` means "not asked"; `null` means "asked and empty".

  if (candidate.providerType !== undefined && !candidate.providerType) {
    issues.push({ field: 'providerType', code: 'REQUIRED' });
  }

  // A business trading under a name we never captured cannot be displayed or
  // invoiced correctly. Only asked of businesses.
  if (candidate.providerType === 'BUSINESS' && !trimmed(candidate.legalBusinessName)) {
    issues.push({ field: 'legalBusinessName', code: 'REQUIRED' });
  }

  // Presence is not proof. A number nobody demonstrated control of is a
  // contact method that does not work, and it is the channel a seeker uses
  // when a provider is late.
  if (candidate.phoneVerified !== undefined && !candidate.phoneVerified) {
    issues.push({ field: 'phoneNumber', code: 'NOT_VERIFIED' });
  }

  // "When can they work" is the question the marketplace exists to answer.
  if (
    candidate.availabilityIntervalCount !== undefined &&
    candidate.availabilityIntervalCount < 1
  ) {
    issues.push({ field: 'availability', code: 'REQUIRED' });
  }

  // Experience as a NUMERIC fact. Either an explicit count or a start date the
  // server can derive one from — a display bucket cannot be compared, filtered
  // or aged.
  if (candidate.yearsOfExperience !== undefined || candidate.professionSince !== undefined) {
    const derived =
      candidate.yearsOfExperience ??
      (candidate.professionSince ? yearsSince(candidate.professionSince) : null);
    if (derived === null) {
      issues.push({ field: 'yearsOfExperience', code: 'REQUIRED' });
    } else if (derived < 0 || derived > MAX_YEARS_OF_EXPERIENCE) {
      issues.push({ field: 'yearsOfExperience', code: 'OUT_OF_RANGE' });
    }
  }

  // Consent pinned to a VERSION. "They agreed" is unfalsifiable the moment the
  // terms change.
  if (
    candidate.acceptedConsentVersion !== undefined &&
    !trimmed(candidate.acceptedConsentVersion)
  ) {
    issues.push({ field: 'consent', code: 'REQUIRED' });
  }

  // Root categories organise the catalogue; LEAVES are the competencies
  // matching actually uses. A provider who ticked only a group has told us
  // nothing a seeker can be matched against.
  if (candidate.leafSpecialtyCount !== undefined && candidate.leafSpecialtyCount < 1) {
    issues.push({ field: 'specialties', code: 'REQUIRED' });
  }

  return issues;
}

/** Whole years elapsed, floored. Used to derive experience from a start date
 *  so the stored fact stays a fact instead of a number that silently ages. */
export function yearsSince(since: Date, now: Date = new Date()): number {
  const ms = now.getTime() - since.getTime();
  if (ms < 0) return -1;
  return Math.floor(ms / (365.2425 * 24 * 60 * 60 * 1000));
}

export function isOnboardingComplete(candidate: OnboardingCandidate): boolean {
  return evaluateOnboarding(candidate).length === 0;
}

function trimmed(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return v.length > 0 ? v : null;
}
