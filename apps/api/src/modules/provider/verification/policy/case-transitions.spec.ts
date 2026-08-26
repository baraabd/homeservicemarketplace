import type { VerificationCaseState } from '@homeservicemarketplace/database';

import {
  TERMINAL_CASE_STATES,
  VERIFICATION_CASE_TRANSITIONS,
  availableCaseActions,
  isLegalCaseTransition,
  IMPLEMENTED_CASE_ACTIONS,
  offerableCaseActions,
  type VerificationCaseAction,
} from './case-transitions';

// Sprint 9B — the case transition table. docs/adr/0013
//
// Walked as a cross-product, not sampled. This is the table that decides
// whether someone gets to work, and the untested cell is the one that becomes
// the hole.

const ALL_STATES: VerificationCaseState[] = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'ACTION_REQUIRED',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
];

const ALL_ACTIONS = Object.keys(VERIFICATION_CASE_TRANSITIONS) as VerificationCaseAction[];

describe('the transition table as a whole', () => {
  it('is frozen, arrays included', () => {
    // It is an authorization boundary. `as const` is erased at runtime, so a
    // caller who can push onto `approve.from` grants themselves a transition.
    expect(Object.isFrozen(VERIFICATION_CASE_TRANSITIONS)).toBe(true);
    for (const action of ALL_ACTIONS) {
      expect(Object.isFrozen(VERIFICATION_CASE_TRANSITIONS[action])).toBe(true);
      expect(Object.isFrozen(VERIFICATION_CASE_TRANSITIONS[action].from)).toBe(true);
    }
  });

  it('never allows a transition out of a terminal state', () => {
    // REJECTED and EXPIRED are closed. Moving out of one without a new case
    // would launder a rejection into an approval with no fresh decision.
    for (const terminal of TERMINAL_CASE_STATES) {
      for (const action of ALL_ACTIONS) {
        expect(isLegalCaseTransition(action, terminal)).toBe(false);
      }
    }
  });

  it('offers nothing at all from a terminal state, to anyone', () => {
    for (const terminal of TERMINAL_CASE_STATES) {
      for (const actor of ['provider', 'reviewer', 'system'] as const) {
        expect(availableCaseActions(terminal, actor)).toEqual([]);
      }
    }
  });

  it('requires a reason code for every action that records a decision', () => {
    // The permanent record is built from reason CODES, because reviewer prose
    // about a passport is personal data and gets deleted with the evidence
    // (ADR 0012). A decision with no code leaves nothing behind.
    for (const action of ALL_ACTIONS) {
      const rule = VERIFICATION_CASE_TRANSITIONS[action];
      if (rule.outcome !== null && rule.outcome !== 'EXPIRED') {
        expect(rule.requiresReason).toBe(true);
      }
    }
  });

  it('records a decision for every reviewer judgement, and none for workflow', () => {
    // assign and submit move a case without anyone judging anything; writing a
    // decision row for them would pollute the audit trail with non-decisions.
    expect(VERIFICATION_CASE_TRANSITIONS.assign.outcome).toBeNull();
    expect(VERIFICATION_CASE_TRANSITIONS.submit.outcome).toBeNull();
    for (const action of ['approve', 'reject', 'requestAction', 'reverify', 'revoke'] as const) {
      expect(VERIFICATION_CASE_TRANSITIONS[action].outcome).not.toBeNull();
    }
  });
});

describe('approval is evidence-gated by state', () => {
  it('can only approve a case that was actually submitted', () => {
    expect(VERIFICATION_CASE_TRANSITIONS.approve.from).toEqual(['SUBMITTED', 'IN_REVIEW']);
  });

  it.each([
    'DRAFT',
    'ACTION_REQUIRED',
    'VERIFIED',
    'REJECTED',
    'EXPIRED',
  ] as VerificationCaseState[])('refuses to approve from %s', (state) => {
    // DRAFT is the important one, and it is the same defect as D-3 one level
    // down: a draft case has had no evidence submitted, so approving it
    // verifies an identity nobody looked at.
    expect(isLegalCaseTransition('approve', state)).toBe(false);
  });

  it('never offers approve to a provider', () => {
    // Self-approval by state machine. The service also blocks self-review by
    // actor identity; this is the structural half.
    for (const state of ALL_STATES) {
      expect(availableCaseActions(state, 'provider')).not.toContain('approve');
    }
  });
});

describe('resubmission is the same edge as submission', () => {
  it('lets a provider submit from DRAFT and from ACTION_REQUIRED', () => {
    expect(availableCaseActions('DRAFT', 'provider')).toEqual(['submit']);
    expect(availableCaseActions('ACTION_REQUIRED', 'provider')).toEqual(['submit']);
  });

  it('does not let a provider submit an already-submitted case', () => {
    // Otherwise a provider can churn the queue, and a reviewer's in-flight
    // decision races a re-submission.
    expect(isLegalCaseTransition('submit', 'SUBMITTED')).toBe(false);
    expect(isLegalCaseTransition('submit', 'IN_REVIEW')).toBe(false);
  });

  it('does not let a provider submit a VERIFIED case', () => {
    expect(isLegalCaseTransition('submit', 'VERIFIED')).toBe(false);
  });
});

describe('what a reviewer is offered, per state', () => {
  it.each([
    ['SUBMITTED', ['assign', 'requestAction', 'approve', 'reject']],
    ['IN_REVIEW', ['assign', 'requestAction', 'approve', 'reject']],
    ['ACTION_REQUIRED', ['reject']],
    ['VERIFIED', ['reverify', 'revoke']],
    ['DRAFT', []],
    ['REJECTED', []],
    ['EXPIRED', []],
  ] as Array<[VerificationCaseState, VerificationCaseAction[]]>)(
    'offers %s → %s',
    (state, expected) => {
      expect(availableCaseActions(state, 'reviewer').sort()).toEqual([...expected].sort());
    },
  );

  it('offers a reviewer nothing on a DRAFT case', () => {
    // A draft is the provider's private workspace. A reviewer acting on one
    // would be deciding on evidence that was never submitted.
    expect(availableCaseActions('DRAFT', 'reviewer')).toEqual([]);
  });
});

describe('expiry and revocation preserve history', () => {
  it('expires only from VERIFIED', () => {
    // Nothing else has a grant to lapse.
    expect(VERIFICATION_CASE_TRANSITIONS.expire.from).toEqual(['VERIFIED']);
  });

  it('is driven by the system, not a reviewer', () => {
    expect(VERIFICATION_CASE_TRANSITIONS.expire.actor).toBe('system');
    expect(availableCaseActions('VERIFIED', 'reviewer')).not.toContain('expire');
  });

  it('records revocation as its own outcome, distinct from rejection', () => {
    // A revoked grant does not make a VERIFIED case untrue. Collapsing the two
    // would rewrite history as "we never trusted them".
    expect(VERIFICATION_CASE_TRANSITIONS.revoke.outcome).toBe('REVOKED');
    expect(VERIFICATION_CASE_TRANSITIONS.reject.outcome).toBe('REJECTED');
  });

  it('routes re-verification through a fresh case rather than reopening', () => {
    // reverify CLOSES the old case (to EXPIRED). It must not transition back to
    // SUBMITTED, which would let a second decision overwrite the first on the
    // same row.
    expect(VERIFICATION_CASE_TRANSITIONS.reverify.to).toBe('EXPIRED');
    expect(VERIFICATION_CASE_TRANSITIONS.reverify.outcome).toBe('REVERIFY_REQUIRED');
  });
});

describe('full cross-product', () => {
  it('every (state, action) pair has a defined, deterministic answer', () => {
    // Enumerated rather than sampled: 7 states x 8 actions = 56 cells, and the
    // one nobody thought to check is the one that matters.
    for (const state of ALL_STATES) {
      for (const action of ALL_ACTIONS) {
        expect(typeof isLegalCaseTransition(action, state)).toBe('boolean');
      }
    }
  });

  it('availableCaseActions agrees with isLegalCaseTransition for every cell', () => {
    // The round-trip that makes the served action list safe to render: an
    // action is offered iff the table admits it for that actor.
    for (const state of ALL_STATES) {
      for (const actor of ['provider', 'reviewer', 'system'] as const) {
        const offered = availableCaseActions(state, actor);
        for (const action of ALL_ACTIONS) {
          const rule = VERIFICATION_CASE_TRANSITIONS[action];
          expect(offered.includes(action)).toBe(
            rule.actor === actor && isLegalCaseTransition(action, state),
          );
        }
      }
    }
  });
});

// ── Sprint 9B.5: legal is not the same as implemented ──────────────────────

describe('the server only offers actions it can actually perform', () => {
  it('lists only actions that exist in the transition table', () => {
    for (const action of IMPLEMENTED_CASE_ACTIONS) {
      expect(VERIFICATION_CASE_TRANSITIONS[action]).toBeDefined();
    }
  });

  it('offers approve only now that it has an atomic transaction behind it', () => {
    // Until Sprint 9B.7 this test asserted the opposite, and it was right to:
    // approve was legal from SUBMITTED and had no command, so offering it
    // would have recreated D-3 exactly. It is offered now because the
    // transaction exists — case, decision, provider state, grant, audit,
    // notification and event, together or not at all.
    expect(offerableCaseActions('SUBMITTED', 'reviewer')).toContain('approve');
    expect(offerableCaseActions('IN_REVIEW', 'reviewer')).toContain('approve');

    // Still never to a provider, and never on a case nobody submitted.
    for (const state of ALL_STATES) {
      expect(offerableCaseActions(state, 'provider')).not.toContain('approve');
    }
    expect(offerableCaseActions('DRAFT', 'reviewer')).not.toContain('approve');
  });

  it('still withholds expire, which has no scheduler', () => {
    // The SYSTEM actor has no caller yet. Offering it to a reviewer would be
    // offering an action nobody can perform.
    for (const state of ALL_STATES) {
      expect(offerableCaseActions(state, 'reviewer')).not.toContain('expire');
    }
  });
  it('offers a provider submission from a draft and from a returned case', () => {
    expect(offerableCaseActions('DRAFT', 'provider')).toEqual(['submit']);
    expect(offerableCaseActions('ACTION_REQUIRED', 'provider')).toEqual(['submit']);
  });

  it('offers a reviewer rejection once a case is live', () => {
    // Sprint 9B.6. Closing a case is the half of deciding that needs no grant
    // and no atomic write across three tables, so it ships before approval.
    for (const state of ['SUBMITTED', 'IN_REVIEW', 'ACTION_REQUIRED'] as const) {
      expect(offerableCaseActions(state, 'reviewer')).toContain('reject');
    }
  });

  it('offers a reviewer assignment and request-action on live cases', () => {
    for (const state of ['SUBMITTED', 'IN_REVIEW'] as const) {
      const offered = offerableCaseActions(state, 'reviewer');
      expect(offered).toContain('assign');
      expect(offered).toContain('requestAction');
    }
  });

  it('offers nothing from a terminal state, to anyone', () => {
    for (const state of ['REJECTED', 'EXPIRED'] as const) {
      expect(offerableCaseActions(state, 'provider')).toEqual([]);
      expect(offerableCaseActions(state, 'reviewer')).toEqual([]);
      expect(offerableCaseActions(state, 'system')).toEqual([]);
    }
  });

  it('offers a provider nothing while a reviewer holds the case', () => {
    // The provider waits. Offering "submit" here would let them overwrite a
    // case someone is mid-way through reading.
    for (const state of ['SUBMITTED', 'IN_REVIEW'] as const) {
      expect(offerableCaseActions(state, 'provider')).toEqual([]);
    }
  });

  it('is always a SUBSET of what the transition table allows', () => {
    // The guard cannot invent an action, only withhold one. If these ever
    // disagree the offer is a lie in the other direction.
    for (const state of ALL_STATES) {
      for (const actor of ['provider', 'reviewer', 'system'] as const) {
        const legal = availableCaseActions(state, actor);
        for (const offered of offerableCaseActions(state, actor)) {
          expect(legal).toContain(offered);
        }
      }
    }
  });

  it('withholds exactly the unimplemented actions and nothing else', () => {
    // Pins WHICH actions are still missing, so finishing one in a later sprint
    // fails this test until the list is updated — the list cannot silently
    // drift away from reality.
    const notYet = (Object.keys(VERIFICATION_CASE_TRANSITIONS) as VerificationCaseAction[]).filter(
      (a) => !IMPLEMENTED_CASE_ACTIONS.includes(a),
    );
    // Only `expire` remains: it is the SYSTEM actor's edge and needs a
    // scheduler, which no deployment wires yet. Everything a reviewer can do
    // now has a command behind it.
    expect([...notYet].sort()).toEqual(['expire']);
  });
});
