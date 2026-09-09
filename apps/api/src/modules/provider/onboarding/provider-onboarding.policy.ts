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
  /** Sprint 9B.18 — specialties applied for and not yet decided.
   *
   *  Does not satisfy anything. It changes only what the provider is TOLD:
   *  "waiting for approval" rather than "you must choose one", which is what
   *  they already did. */
  pendingSpecialtyCount?: number;
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
    // Same distinction as `specialties` below: nothing is granted yet, but
    // "you have not chosen" and "nobody has looked" are different sentences.
    issues.push({
      field: 'serviceCategories',
      code: (candidate.pendingSpecialtyCount ?? 0) > 0 ? 'AWAITING_REVIEW' : 'REQUIRED',
    });
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
    // Sprint 9B.18 — still an issue, still blocks submission, but honest
    // about WHY. A provider with an application in the queue has done their
    // part; telling them the field is REQUIRED says they have not.
    issues.push({
      field: 'specialties',
      code: (candidate.pendingSpecialtyCount ?? 0) > 0 ? 'AWAITING_REVIEW' : 'REQUIRED',
    });
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

// ── Sprint 09B.29 — the two axes, separated ────────────────────────────────
//
// `evaluateOnboarding` reports EVERYTHING outstanding, and it keeps doing so:
// it is not weakened here, and `AWAITING_REVIEW` is still raised exactly as
// before. What changes is who each issue is addressed to.
//
// THE DEADLOCK THIS ENDS
//
// 9B.18 introduced `AWAITING_REVIEW` to stop telling a provider that a
// specialty they HAD chosen was "Required". It fixed the wording and left the
// consequence: the issue still counted against completeness, so a provider
// whose only outstanding item was an administrator's approval could not reach
// final review and could not submit. The hub resolver's own comment recorded
// this as correct ("the application genuinely is not submittable yet"), and a
// hub test pinned it. It is not correct, and the sprint mandate is explicit:
// pending specialty moderation may block ACTIVATION and WORK ACCESS, and must
// not block final review or submission.
//
// The provider had done their part. Holding the submission hostage to a queue
// they cannot influence means the application is never handed in, so the
// approval that would unblock it is never prompted for — the deadlock is
// literal, not theoretical.
//
// Activation and work access are unaffected by this split: they are granted by
// `ProviderCapabilityService` from a live work-access grant, which is an
// administrator's decision and reads none of this.

/**
 * WHOSE MOVE IS IT?
 *
 * One canonical mapping, exhaustive over the issue codes the shared contract
 * defines. Everything that needs to know who owns an issue reads this — the
 * hub, the review resolver, the submission-readiness check, the V1 service and
 * the V2 wizard — so the layers cannot drift into disagreeing about it, which
 * is exactly how the deadlock survived five sprints.
 *
 *   PROVIDER  something they can go and correct on a screen.
 *   PLATFORM  something WE owe them a decision on. Never reported as work for
 *             them to do, never a submission blocker, and never a reason to
 *             grant activation or work access either.
 *
 * There is deliberately NO `default:` branch and no `!==` shortcut. The
 * `Record<ProviderOnboardingIssueCode, IssueOwner>` type means adding a code to
 * the shared contract without classifying it here is a TypeScript error at this
 * file, not a silent assumption that it belongs to the provider. An
 * exhaustiveness test pins the same property at runtime for anyone who reaches
 * this through JavaScript.
 */
export type IssueOwner = 'PROVIDER' | 'PLATFORM';

/** The issue codes the shared contract defines, as a value. Kept beside the
 *  map so the two are read together and the exhaustiveness test can iterate. */
export const ONBOARDING_ISSUE_CODES = [
  'REQUIRED',
  'TOO_SHORT',
  'UNVERIFIED',
  'NOT_VERIFIED',
  'OUT_OF_RANGE',
  'AWAITING_REVIEW',
] as const satisfies ReadonlyArray<ProviderOnboardingIssue['code']>;

export const ISSUE_OWNER: Record<ProviderOnboardingIssue['code'], IssueOwner> = {
  /** Absent or blank. They fill it in. */
  REQUIRED: 'PROVIDER',
  /** Present but below the minimum useful length. They lengthen it. */
  TOO_SHORT: 'PROVIDER',
  /** Their account email is unverified. They complete the verification. */
  UNVERIFIED: 'PROVIDER',
  /** A field they must prove, such as their phone. They prove it. */
  NOT_VERIFIED: 'PROVIDER',
  /** Well-formed and outside the allowed bounds. They correct it. */
  OUT_OF_RANGE: 'PROVIDER',
  /**
   * They supplied it and an administrator has not decided yet.
   *
   * The only PLATFORM-owned code today. It must never be reported as provider
   * work, must never block final review or submission, and must never by itself
   * grant activation or work access — those are the verification decision and
   * the work-access grant, which read none of this.
   */
  AWAITING_REVIEW: 'PLATFORM',
};

/** Who owns this issue? The single question every layer asks. */
export function ownerOfIssue(issue: ProviderOnboardingIssue): IssueOwner {
  return ISSUE_OWNER[issue.code];
}

/**
 * Is this issue the PROVIDER's move, as opposed to ours?
 *
 * Delegates to the canonical map. Kept as a named predicate because it reads
 * better at the call sites than `ownerOfIssue(i) === 'PROVIDER'` and because it
 * is the shape `Array.filter` wants.
 */
export function isProviderActionIssue(issue: ProviderOnboardingIssue): boolean {
  return ownerOfIssue(issue) === 'PROVIDER';
}

/** The subset a provider can actually act on. Order is preserved, so "the
 *  first blocker" stays the first blocker in policy order. */
export function providerActionIssues(
  issues: readonly ProviderOnboardingIssue[],
): ProviderOnboardingIssue[] {
  return issues.filter(isProviderActionIssue);
}

/** Issues that are waiting on US. Reported as a separate axis, never as a
 *  reason the provider cannot proceed. */
export function moderationIssues(
  issues: readonly ProviderOnboardingIssue[],
): ProviderOnboardingIssue[] {
  return issues.filter((i) => ownerOfIssue(i) === 'PLATFORM');
}

/**
 * Has the provider completed every provider-controlled required INPUT?
 *
 * True when nothing the provider can act on is outstanding. An approval sitting
 * in an administrator's queue does not make it false, because there is nothing
 * for them to do about it — that is the whole of the Sprint 09B.29 repair.
 *
 * ┌ THIS IS NOT "MAY THEY SUBMIT?" ───────────────────────────────────────────┐
 * │ It answers one input of that decision. The submit command additionally    │
 * │ enforces, and may refuse on, any of:                                      │
 * │   · the lifecycle state (already submitted, accepted, withdrawn)          │
 * │   · the accepted terms VERSION, which can move between view and submit    │
 * │   · the draft version, for optimistic concurrency                         │
 * │   · authorization, ownership and CSRF                                     │
 * │   · idempotency, so a retry is not a second application                    │
 * │ A caller that treats this as the whole answer will enable a button that   │
 * │ then fails — the exact defect the completeness policy was introduced to   │
 * │ prevent.                                                                  │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * The authoritative submission decision is the submit command itself, and the
 * value clients should render is the server's `canSubmit`.
 */
export function isProviderInputComplete(candidate: OnboardingCandidate): boolean {
  return providerActionIssues(evaluateOnboarding(candidate)).length === 0;
}

/**
 * Is there nothing outstanding AT ALL — including our own approvals?
 *
 * Sprint 09B.29 restored this to its original meaning after briefly redefining
 * it. The redefinition was inert (this function had, and has, no production
 * caller) but it was a trap: the name says "complete", and the next caller to
 * reach for it might be gating activation, a work-access grant, a verification
 * decision or a report — none of which may treat a queued approval as done.
 *
 * ┌ WHICH ANSWER DO I WANT? ──────────────────────────────────────────────────┐
 * │ "is their form finished?"               → `isProviderInputComplete`       │
 * │ "is EVERYTHING settled, us included?"   → `isOnboardingComplete`          │
 * │ "MAY THEY SUBMIT?"                      → NEITHER on its own. The submit  │
 * │                                           command is authoritative; the   │
 * │                                           value to render is the server's │
 * │                                           `canSubmit`, which folds in     │
 * │                                           terms, lifecycle, version and   │
 * │                                           authorization as well as input. │
 * │ "may they see jobs / bid / be paid?"    → NEITHER. Ask                    │
 * │                                           `ProviderCapabilityService`,    │
 * │                                           which reads the work-access     │
 * │                                           grant an administrator issued.  │
 * │ "are they activated?"                   → NEITHER. That is the            │
 * │                                           verification case decision.     │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * Neither function grants anything. Both answer questions about the ONBOARDING
 * axis only; account standing, moderation and work access are separate axes and
 * are decided elsewhere.
 */
export function isOnboardingComplete(candidate: OnboardingCandidate): boolean {
  return evaluateOnboarding(candidate).length === 0;
}

function trimmed(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return v.length > 0 ? v : null;
}
