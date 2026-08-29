import type {
  ProviderOnboardingReview,
  ReviewGroup,
  ReviewItem,
  ReviewTerms,
} from '@homeservicemarketplace/contracts';
import { STEP_TO_V2_TASK } from '@homeservicemarketplace/contracts';
import type { ProviderOnboardingIssue } from '@homeservicemarketplace/contracts';

import { computeProgress, stepForField } from '../onboarding-steps';

// Sprint 9B.23 — the review read-model, as a PURE function.
//
// docs/sprint-09b23/REVIEW_AND_SUBMIT.md
//
// WHAT THIS IS NOT
//
// It is not a second completeness policy. Every blocker here is an issue
// `evaluateOnboarding()` already produced, routed to a step `stepForField()`
// already chose. This file adds no rule and no threshold; if it did, there
// would be two answers to "may I submit" and they would diverge the first time
// either moved.
//
// `canSubmit` is therefore defined the only way it safely can be: the policy
// returned no issues AND the current terms version has been accepted. Not "the
// blocking group is empty" — that is the same statement one refactor away from
// being computed from a list the UI can influence.

export interface ReviewSource {
  /** Straight from `evaluateOnboarding(candidate)`. */
  issues: readonly ProviderOnboardingIssue[];
  /** The Sprint 7 lifecycle axis, for the already-submitted cases. */
  lifecycleState: string;
  /** Optimistic-concurrency token for the submit that follows. */
  draftVersion: number;
  terms: ReviewTerms;
  /** Specialties the provider applied for that a human has not decided yet.
   *  WAITING, never BLOCKING — there is no action to offer. */
  pendingSpecialtyCount: number;
  /** Portfolio images uploaded but not reviewed. Also WAITING, and also not a
   *  reason to refuse a submission (9B.22: nothing approves one yet). */
  awaitingPortfolioReviewCount: number;
  /** True when the provider has published nothing. Advice, not a requirement:
   *  a portfolio is not in the completeness policy and must not read as one. */
  portfolioEmpty: boolean;
}

/**
 * Project the policy's verdict into the four groups the screen renders.
 *
 * Order within a group is the policy's own issue order, which is stable and
 * already reads top-to-bottom in wizard order.
 */
/**
 * The lifecycle states a submitted application can be pulled back from.
 *
 * Mirrors the WHERE clause in `ProviderOnboardingWizardService.withdraw`.
 * ACCEPTED is absent on purpose: once a reviewer has accepted an application,
 * un-submitting it would silently undo their decision.
 */
export const WITHDRAWABLE_STATES: readonly string[] = Object.freeze([
  'SUBMITTED',
  'DOCUMENTS_REQUIRED',
]);

export function buildReview(source: ReviewSource): ProviderOnboardingReview {
  const progress = computeProgress(source.issues, source.lifecycleState);

  const blocking: ReviewItem[] = source.issues.map((issue) => {
    const step = stepForField(issue.field);
    return {
      id: `blocking:${issue.field}:${issue.code}`,
      field: issue.field,
      code: issue.code,
      step,
      // A requirement with no owning step is attached to REVIEW by
      // computeProgress precisely so it stays visible; the deep link follows
      // it there rather than being null, so "Complete now" always goes
      // somewhere.
      taskId: STEP_TO_V2_TASK[step ?? 'REVIEW'],
      count: null,
    };
  });

  // Consent is a submission requirement but not a completeness FIELD, so it
  // would otherwise be invisible here. Appended rather than woven in, so the
  // policy's own list stays recognisable.
  if (!source.terms.accepted) {
    blocking.push({
      id: 'blocking:terms',
      field: 'acceptedConsentVersion',
      code: source.terms.acceptedVersion === null ? 'REQUIRED' : 'STALE_VERSION',
      step: 'CONSENT',
      taskId: STEP_TO_V2_TASK.CONSENT,
      count: null,
    });
  }

  const waiting: ReviewItem[] = [];
  if (source.pendingSpecialtyCount > 0) {
    waiting.push(waitingItem('SPECIALTY_REVIEW', source.pendingSpecialtyCount));
  }
  if (source.awaitingPortfolioReviewCount > 0) {
    waiting.push(waitingItem('PORTFOLIO_REVIEW', source.awaitingPortfolioReviewCount));
  }

  const optional: ReviewItem[] = [];
  if (source.portfolioEmpty) {
    optional.push({
      id: 'optional:PORTFOLIO_EMPTY',
      field: null,
      code: 'PORTFOLIO_EMPTY',
      step: 'PROFILE',
      taskId: STEP_TO_V2_TASK.PROFILE,
      count: null,
    });
  }

  // Completed steps, so the screen can show what is DONE rather than only what
  // is wrong. A review surface that lists nine problems and no progress reads
  // as a rejection.
  const complete: ReviewItem[] = progress.steps
    .filter((s) => s.complete && s.step !== 'REVIEW')
    .map((s) => ({
      id: `complete:${s.step}`,
      field: null,
      code: null,
      step: s.step,
      taskId: STEP_TO_V2_TASK[s.step],
      count: null,
    }));

  // The policy is the authority, not the group we just built.
  const canSubmit = source.issues.length === 0 && source.terms.accepted;

  const groups: ReviewGroup[] = [
    { kind: 'BLOCKING', items: blocking },
    { kind: 'WAITING', items: waiting },
    { kind: 'OPTIONAL', items: optional },
    { kind: 'COMPLETE', items: complete },
  ];

  return {
    groups,
    canSubmit,
    // The FIRST blocker, in policy order — "the exact next action", singular.
    // A screen that says "8 things are wrong" has told the provider nothing
    // they can act on this minute.
    blockedReason: canSubmit ? null : (blocking[0] ?? null),
    terms: source.terms,
    draftVersion: source.draftVersion,
    lifecycleState: source.lifecycleState,
    // The states withdraw() scopes its updateMany to, and nothing else. Kept
    // beside the states themselves rather than in the client so the offer and
    // the command cannot drift apart.
    canWithdraw: WITHDRAWABLE_STATES.includes(source.lifecycleState),
  };
}

function waitingItem(code: string, count: number): ReviewItem {
  return {
    id: `waiting:${code}`,
    field: null,
    code,
    step: null,
    // Deliberately null. There is nothing for the provider to open, and a
    // "Complete now" button on someone else's queue is a lie.
    taskId: null,
    count,
  };
}
