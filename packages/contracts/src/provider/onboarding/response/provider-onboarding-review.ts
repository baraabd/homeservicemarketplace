import type { ProviderOnboardingStep } from '../enums/provider-onboarding-step';
import { PROVIDER_ONBOARDING_STEPS } from '../enums/provider-onboarding-step';

// Sprint 9B.23 — V2 Task 6: the review and submission read-model.
//
// docs/sprint-09b23/REVIEW_AND_SUBMIT.md
//
// THE RULES LIVE ON THE SERVER, AND ONLY ON THE SERVER.
//
// `evaluateOnboarding()` decides what is missing and `computeProgress()`
// decides which step owns it. This read-model is a PROJECTION of those two —
// it restates no rule, adds no threshold, and infers no completeness. A client
// that re-derived "can I submit?" would be a second policy, and the two would
// disagree the first time either changed.
//
// So the client's whole job is to render what arrives, in the order it
// arrives, and to send the provider to `taskId` when they ask to fix
// something.

/**
 * Why an item is in the group it is in.
 *
 * BLOCKING and WAITING are deliberately separate, the same distinction the hub
 * already draws. Blocking means the PROVIDER has something to do; waiting
 * means the item is with someone else — a reviewer, a scan — and there is no
 * action to offer. Collapsing them produces a screen that shows a red error
 * for something the provider cannot possibly fix.
 *
 * OPTIONAL is neither: it is advice. It never blocks submission and is never
 * rendered as an error.
 */
export const REVIEW_GROUP_KINDS = ['BLOCKING', 'OPTIONAL', 'WAITING', 'COMPLETE'] as const;
export type ReviewGroupKind = (typeof REVIEW_GROUP_KINDS)[number];

/**
 * One line on the review screen.
 *
 * `field` and `code` come STRAIGHT from the completeness policy, so the client
 * keys its localised sentence off them rather than off a server-sent string —
 * the same reason the hub keys task copy off the task id. A server that sent
 * prose would decide the app's language and its tone.
 */
export interface ReviewItem {
  /** Stable within a response, so React can key a list without an index. */
  id: string;
  /** The completeness field, e.g. `bio`. Null for items that are not policy
   *  requirements (a waiting review, an optional suggestion). */
  field: string | null;
  /** The policy's own code, e.g. REQUIRED / TOO_SHORT / UNVERIFIED. */
  code: string | null;
  /** The wizard step that owns the requirement. */
  step: ProviderOnboardingStep | null;
  /** Where "Complete now" should send the provider — a V2 task id. Null when
   *  there is nothing for them to open, which is exactly the WAITING case. */
  taskId: string | null;
  /** For a WAITING item, how many things are waiting (pending specialties,
   *  photos in a queue). Null when a count would be meaningless. */
  count: number | null;
}

export interface ReviewGroup {
  kind: ReviewGroupKind;
  items: ReviewItem[];
}

/**
 * The active terms document, as the review screen must present it.
 *
 * The VERSION is the legal artefact — it is what gets recorded — and the
 * server is the only thing that may name the current one. `accepted` answers
 * "did this provider accept THE CURRENT version", not "did they ever accept
 * something": a provider who agreed to v1 has not agreed to v2, and the screen
 * has to ask again rather than showing a stale tick.
 */
export interface ReviewTerms {
  /** The version a submission must carry. */
  version: string;
  /** Which locale's wording the provider is being shown. */
  locale: 'en' | 'ar';
  /** True only when `acceptedVersion === version`. */
  accepted: boolean;
  /** What they accepted before, which may be an older document. */
  acceptedVersion: string | null;
  acceptedAt: string | null;
}

/**
 * Everything the review screen renders, and the two values a submit must echo.
 *
 * `draftVersion` is the optimistic-concurrency token and `termsVersion` is the
 * consent token. Both are served HERE, immediately before the provider acts,
 * which is what makes "refresh readiness before submit" a real check rather
 * than a ceremony.
 */
export interface ProviderOnboardingReview {
  groups: ReviewGroup[];
  /** Server's verdict. The button is disabled on THIS, never on a client-side
   *  count of anything. */
  canSubmit: boolean;
  /** Present exactly when `canSubmit` is false: the one thing to do next. A
   *  disabled button that cannot say why is the defect this replaces. */
  blockedReason: ReviewItem | null;
  terms: ReviewTerms;
  /** Echo this on submit; a mismatch is a 409. */
  draftVersion: number;
  /** So the screen can say "already submitted" rather than offering a button
   *  that will 409. */
  lifecycleState: string;
}

/**
 * Which V2 task screen fixes a requirement owned by `step`.
 *
 * The wizard's nine steps collapse onto the V2 hub's six tasks, so this map is
 * the join between the two vocabularies. It is TOTAL over the step list and a
 * test asserts that: a step with no task is a blocker the provider can be told
 * about but not sent to, which is the "disabled button that cannot say what to
 * do" failure wearing a different hat.
 */
export const STEP_TO_V2_TASK: Readonly<Record<ProviderOnboardingStep, string>> = Object.freeze({
  PROVIDER_TYPE: 'BASICS_IDENTITY',
  IDENTITY: 'BASICS_IDENTITY',
  LOCATION: 'WORK_AREA',
  SPECIALTIES: 'SERVICES_EXPERIENCE',
  EXPERIENCE: 'SERVICES_EXPERIENCE',
  AVAILABILITY: 'WORKING_HOURS',
  PROFILE: 'PORTFOLIO',
  // Terms are collected ON the review screen in V2, so the deep link for a
  // consent gap is the screen the provider is already looking at.
  CONSENT: 'REVIEW_SUBMISSION',
  REVIEW: 'REVIEW_SUBMISSION',
});

/** Exported for the totality test, so it cannot drift from the step list. */
export const REVIEW_MAPPED_STEPS = PROVIDER_ONBOARDING_STEPS;
