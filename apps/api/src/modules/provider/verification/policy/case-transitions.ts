// Sprint 9B — ONE authoritative transition policy for a verification case.
//
// docs/adr/0013-evidence-to-work-access-capability-transition.md §1
//
// The lesson of D-3 (docs/sprint-09/INSPECTION.md) applies here before the
// second copy can exist: the admin provider-status table had drifted into three
// copies and the UI offered an Approve button the backend answered with 409.
// This table therefore lives in ONE place from the start, the service scopes its
// conditional writes to it, and the client is told the available actions rather
// than deriving them.

import type {
  VerificationCaseState,
  VerificationDecisionOutcome,
} from '@homeservicemarketplace/database';

/** What can be done to a case. Named for the ACTION, like capability codes. */
export type VerificationCaseAction =
  | 'submit'
  | 'assign'
  | 'requestAction'
  | 'approve'
  | 'reject'
  | 'reverify'
  | 'expire'
  | 'revoke';

interface TransitionRule {
  from: readonly VerificationCaseState[];
  to: VerificationCaseState;
  /** Who may drive it. Providers act on their own case; reviewers decide. */
  actor: 'provider' | 'reviewer' | 'system';
  /** The decision outcome recorded, when this action records one. `submit` and
   *  `assign` are not decisions — nobody judged anything. */
  outcome: VerificationDecisionOutcome | null;
  /** Whether a reason code is mandatory. Approval carries one too: "why did we
   *  trust this?" is exactly the question the permanent record must answer. */
  requiresReason: boolean;
}

export const VERIFICATION_CASE_TRANSITIONS: Readonly<
  Record<VerificationCaseAction, TransitionRule>
> = Object.freeze({
  // Provider sends evidence. Reachable from a fresh draft AND from
  // ACTION_REQUIRED — resubmission is the same edge, not a special case, so a
  // returned applicant does not need a second code path.
  submit: {
    from: ['DRAFT', 'ACTION_REQUIRED'],
    to: 'SUBMITTED',
    actor: 'provider',
    outcome: null,
    requiresReason: false,
  },
  // Workflow, not authorization: assignment stops two reviewers doing the same
  // work; it does not stop a permitted reviewer READING the case.
  assign: {
    from: ['SUBMITTED', 'IN_REVIEW'],
    to: 'IN_REVIEW',
    actor: 'reviewer',
    outcome: null,
    requiresReason: false,
  },
  // Not a closure. The provider can act, and the evidence already supplied is
  // retained rather than discarded.
  requestAction: {
    from: ['SUBMITTED', 'IN_REVIEW'],
    to: 'ACTION_REQUIRED',
    actor: 'reviewer',
    outcome: 'ACTION_REQUIRED',
    requiresReason: true,
  },
  approve: {
    from: ['SUBMITTED', 'IN_REVIEW'],
    to: 'VERIFIED',
    actor: 'reviewer',
    outcome: 'APPROVED',
    requiresReason: true,
  },
  reject: {
    from: ['SUBMITTED', 'IN_REVIEW', 'ACTION_REQUIRED'],
    to: 'REJECTED',
    actor: 'reviewer',
    outcome: 'REJECTED',
    requiresReason: true,
  },
  // Ops asks a VERIFIED provider for fresh evidence. Opens a NEW case; this
  // edge only closes the old one, and never edits the decision that verified
  // them — they WERE verified on the date they were verified.
  reverify: {
    from: ['VERIFIED'],
    to: 'EXPIRED',
    actor: 'reviewer',
    outcome: 'REVERIFY_REQUIRED',
    requiresReason: true,
  },
  // Time passed. No judgement, which is why EXPIRED is not REJECTED.
  expire: {
    from: ['VERIFIED'],
    to: 'EXPIRED',
    actor: 'system',
    outcome: 'EXPIRED',
    requiresReason: false,
  },
  // Access withdrawn early. Revokes the GRANT; the case's verified history
  // stands (ADR 0013 §6).
  revoke: {
    from: ['VERIFIED'],
    to: 'EXPIRED',
    actor: 'reviewer',
    outcome: 'REVOKED',
    requiresReason: true,
  },
} as const);

for (const rule of Object.values(VERIFICATION_CASE_TRANSITIONS)) {
  Object.freeze(rule);
  Object.freeze(rule.from);
}

const ALL_ACTIONS = Object.keys(VERIFICATION_CASE_TRANSITIONS) as VerificationCaseAction[];

/** Actions legal from a state for a given actor. Server-computed; the client
 *  renders this and owns no rule (the D-3 lesson). */
export function availableCaseActions(
  state: VerificationCaseState,
  actor: 'provider' | 'reviewer' | 'system',
): VerificationCaseAction[] {
  return ALL_ACTIONS.filter((action) => {
    const rule = VERIFICATION_CASE_TRANSITIONS[action];
    return rule.actor === actor && rule.from.includes(state);
  });
}

export function isLegalCaseTransition(
  action: VerificationCaseAction,
  from: VerificationCaseState,
): boolean {
  return VERIFICATION_CASE_TRANSITIONS[action].from.includes(from);
}

/**
 * Sprint 9B.5 — the actions that have a working command behind them TODAY.
 *
 * LEGAL AND IMPLEMENTED ARE DIFFERENT QUESTIONS, and conflating them is the
 * exact defect this file's header describes: the admin table offered an Approve
 * button and the backend answered 409.
 *
 * The transition table above describes the DOMAIN — approve is legal from
 * SUBMITTED, and it will stay legal, because that is true of verification
 * regardless of what this codebase has finished building. This list describes
 * the BUILD. `approve` is missing from it deliberately: granting work access is
 * an atomic operation across the case, the grant and the provider's status
 * (ADR 0013), and offering half of it is worse than offering none.
 *
 * Withholding, never inventing: everything here must exist in the table, and
 * `offerableCaseActions` can only ever return a subset of the legal set. Both
 * are asserted.
 */
export const IMPLEMENTED_CASE_ACTIONS: readonly VerificationCaseAction[] = Object.freeze([
  'submit',
  'assign',
  'requestAction',
  // Sprint 9B.6. Closing a case is the half of deciding that needs no grant and
  // no atomic write across three tables, so it ships before approval does.
  'reject',
]);

export function isImplementedCaseAction(action: VerificationCaseAction): boolean {
  return IMPLEMENTED_CASE_ACTIONS.includes(action);
}

/**
 * What the server may actually OFFER: legal for this actor in this state, AND
 * backed by a command that works.
 *
 * This is what a client should be given. `availableCaseActions` remains the
 * answer to "what does the domain permit", which is what the policy tests walk.
 */
export function offerableCaseActions(
  state: VerificationCaseState,
  actor: 'provider' | 'reviewer' | 'system',
): VerificationCaseAction[] {
  return availableCaseActions(state, actor).filter(isImplementedCaseAction);
}

/** States from which nothing further can happen without a NEW case. */
export const TERMINAL_CASE_STATES: readonly VerificationCaseState[] = Object.freeze([
  'REJECTED',
  'EXPIRED',
]);
