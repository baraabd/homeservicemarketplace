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

/** States from which nothing further can happen without a NEW case. */
export const TERMINAL_CASE_STATES: readonly VerificationCaseState[] = Object.freeze([
  'REJECTED',
  'EXPIRED',
]);
