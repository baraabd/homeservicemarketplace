import type { ProviderProfileStatus } from '../../provider/profile/enums/provider-profile-status';

// Sprint 9 — THE admin provider transition table. One definition.
//
// docs/sprint-09/INSPECTION.md D-3.
//
// Before this file the table existed twice, and the copies disagreed. The
// server enforced:
//
//     approve  from: ['PENDING_REVIEW']
//     // "Phase 4: DRAFT is NO LONGER an approvable source state."
//
// while the admin UI decided:
//
//     const canApprove = status === 'DRAFT' || status === 'PENDING_REVIEW';
//
// so the reviewer was shown an enabled Approve button on every DRAFT
// provider, and clicking it produced a 409 they could do nothing about.
//
// The dead click is the smaller half. The real defect is a client holding
// its own copy of an authorization rule — the drift ADR 0006 exists to
// prevent, and the same shape as the DRAFT onboarding loop ADR 0006 opens
// with. Deleting `'DRAFT'` from the UI would have fixed the symptom and left
// the second copy in place to drift again on the next backend change.
//
// So: the table lives here, the service derives its `from` sets from it, and
// the server sends the caller the ACTIONS rather than the raw status. The UI
// renders what it is told and owns no rule at all.

/** What an admin can do to a provider profile. Named for the ACTION, not the
 *  target status, for the same reason capability codes are (ADR 0006). */
export type AdminProviderAction = 'approve' | 'reject' | 'suspend' | 'reactivate';

/** Source states from which each action is legal. This is the authority: the
 *  service scopes its conditional UPDATE to exactly these, so a row that
 *  moved under a reviewer produces a 409 rather than a second decision. */
// Object.freeze, not just `as const`. `as const` is erased at compile time and
// buys nothing at runtime: a caller holding this object could push a status
// onto `approve` and grant itself a transition the server would then enforce.
// A table that IS the authorization boundary should not be writable by anyone
// who can import it. (Caught by its own test, which is the argument for
// asserting properties rather than examples.)
export const ADMIN_PROVIDER_TRANSITIONS: Readonly<
  Record<AdminProviderAction, readonly ProviderProfileStatus[]>
> = Object.freeze({
  // A DRAFT profile has never been checked against the onboarding
  // completeness policy. Approving one activates a provider with no
  // headline, no service area and no categories, and makes the
  // submit-for-review gate optional.
  approve: ['PENDING_REVIEW'],
  // Rejection is reachable from anywhere except REJECTED — including ACTIVE,
  // because a provider approved in error must be stoppable.
  reject: ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'SUSPENDED'],
  suspend: ['ACTIVE'],
  reactivate: ['SUSPENDED'],
  // Each array frozen too — freezing the outer object leaves the arrays
  // writable, which is the interesting half.
} as const);

for (const list of Object.values(ADMIN_PROVIDER_TRANSITIONS)) Object.freeze(list);

/** The actions legal from a given status. Used server-side to populate
 *  `AdminProviderSummary.availableActions`; the client never calls it, because
 *  the client is not allowed to know the rule. */
export function availableAdminProviderActions(
  status: ProviderProfileStatus,
): AdminProviderAction[] {
  return (Object.keys(ADMIN_PROVIDER_TRANSITIONS) as AdminProviderAction[]).filter((action) =>
    ADMIN_PROVIDER_TRANSITIONS[action].includes(status),
  );
}
