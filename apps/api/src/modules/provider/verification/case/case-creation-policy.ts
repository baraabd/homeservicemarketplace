import type { VerificationCaseState } from '@homeservicemarketplace/database';

// Sprint 9B.2 — "the provider asked to start verification". What happens?
//
// docs/adr/0010 · docs/adr/0013 · ../policy/case-transitions.ts
//
// Almost every call is a RETRY: a double tap, a replayed POST, a resumed
// session re-entering the flow. So the question is not "may we create a case"
// but "which existing case is this really asking about", and the default answer
// must never be a second one. Two open cases for a provider means two
// reviewers, two decisions, and no defined answer about which governs access.
//
// Pure — no I/O — so the state cross-product is testable without a database.
// The database enforces the same rule independently with a partial unique
// index: this DECIDES, that GUARANTEES. Neither is redundant, because the
// decision has to produce a useful answer and the index has to hold under a
// race this code cannot see.

/**
 * The states in which a case is still open: somebody can still act on it.
 *
 * VERIFIED is deliberately absent. It is finished, not open — which is why a
 * provider asking to start again while verified is refused rather than resumed.
 * REJECTED and EXPIRED are terminal (TERMINAL_CASE_STATES) and do not block a
 * fresh attempt.
 */
export const ACTIVE_CASE_STATES: readonly VerificationCaseState[] = Object.freeze([
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'ACTION_REQUIRED',
]);

export interface ExistingCase {
  id: string;
  state: VerificationCaseState;
  createdAt: Date;
  /** The key supplied when this case was created, if any. */
  idempotencyKey: string | null;
}

export type CaseCreationRefusalCode = 'ALREADY_VERIFIED' | 'MULTIPLE_ACTIVE_CASES';

export type CaseCreationDecision =
  | { action: 'CREATE' }
  | { action: 'RESUME'; caseId: string }
  | {
      action: 'REFUSE';
      code: CaseCreationRefusalCode;
      caseId?: string;
      conflictingCaseIds?: string[];
    };

/**
 * Decide what a create-case request should actually do.
 *
 * Order matters and is not arbitrary:
 *
 *   1. idempotency key — a replay returns what the first call returned, no
 *      matter what state that case reached afterwards. Anything else would let
 *      a retried request start a second attempt the caller never asked for.
 *   2. multiple active cases — fail closed. Unreachable while the index holds;
 *      if it is reached the data decides who reviews this provider, so picking
 *      one would hide it.
 *   3. one active case — resume it.
 *   4. verified — refuse. Re-verification is a reviewer action.
 *   5. otherwise — create.
 */
export function decideCaseCreation(input: {
  cases: readonly ExistingCase[];
  idempotencyKey: string | null;
  now: Date;
}): CaseCreationDecision {
  const { cases, idempotencyKey } = input;

  // 1. A replayed request. Matched only on a non-empty key: two calls that both
  //    omitted one are two calls, not the same call twice.
  if (idempotencyKey) {
    const replayed = cases.find((c) => c.idempotencyKey === idempotencyKey);
    if (replayed) return { action: 'RESUME', caseId: replayed.id };
  }

  const active = cases.filter((c) => ACTIVE_CASE_STATES.includes(c.state));

  // 2. Fail closed rather than choosing.
  if (active.length > 1) {
    return {
      action: 'REFUSE',
      code: 'MULTIPLE_ACTIVE_CASES',
      conflictingCaseIds: active.map((c) => c.id),
    };
  }

  // 3. The ordinary path.
  if (active.length === 1) return { action: 'RESUME', caseId: active[0].id };

  // 4. Verified providers do not re-open their own verification. `reverify` is
  //    reviewer-driven and opens a fresh case; letting a provider do it here
  //    would let anyone drop their verified status by starting over.
  const verified = cases
    .filter((c) => c.state === 'VERIFIED')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (verified) {
    return { action: 'REFUSE', code: 'ALREADY_VERIFIED', caseId: verified.id };
  }

  // 5. No history, or every past case is terminal.
  return { action: 'CREATE' };
}
