import {
  ADMIN_PROVIDER_TRANSITIONS,
  availableAdminProviderActions,
  type AdminProviderAction,
} from '@homeservicemarketplace/contracts';
import type { ProviderProfileStatus } from '@homeservicemarketplace/database';

// Sprint 9 — the admin transition table, now that there is exactly one.
//
// docs/sprint-09/INSPECTION.md D-3. The table previously existed three times:
// the service's inline `from:` arrays, the admin UI's `canApprove` chain, and
// a prose restatement in the contracts barrel. They had already drifted — the
// UI offered Approve on DRAFT, which the service refused with a 409.
//
// These tests pin the properties that make ONE table worth having.

const ALL_STATUSES: ProviderProfileStatus[] = [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'SUSPENDED',
  'REJECTED',
];

const ALL_ACTIONS: AdminProviderAction[] = ['approve', 'reject', 'suspend', 'reactivate'];

describe('ADMIN_PROVIDER_TRANSITIONS', () => {
  it('does NOT admit DRAFT as an approvable source state', () => {
    // The defect, asserted at its source. A DRAFT profile has never been
    // checked against the onboarding completeness policy, so approving one
    // activates a provider with no headline, no service area and no
    // categories — and makes submit-for-review optional.
    expect(ADMIN_PROVIDER_TRANSITIONS.approve).not.toContain('DRAFT');
    expect(ADMIN_PROVIDER_TRANSITIONS.approve).toEqual(['PENDING_REVIEW']);
  });

  it('never offers an action from a state it cannot be applied to', () => {
    // The round-trip property that makes availableActions safe to render: an
    // action appears for a status if and only if the table admits it. If these
    // could disagree, the server would be offering the client a button its own
    // conditional UPDATE will refuse.
    for (const status of ALL_STATUSES) {
      const offered = availableAdminProviderActions(status);
      for (const action of ALL_ACTIONS) {
        expect(offered.includes(action)).toBe(ADMIN_PROVIDER_TRANSITIONS[action].includes(status));
      }
    }
  });

  it('offers nothing at all from REJECTED', () => {
    // REJECTED is where a decision has already been made. Reactivating from
    // it would launder a rejection into an approval with no new decision
    // recorded.
    expect(availableAdminProviderActions('REJECTED')).toEqual([]);
  });

  it.each([
    ['PENDING_REVIEW', ['approve', 'reject']],
    ['ACTIVE', ['reject', 'suspend']],
    ['SUSPENDED', ['reject', 'reactivate']],
    ['DRAFT', ['reject']],
    ['REJECTED', []],
  ] as Array<[ProviderProfileStatus, AdminProviderAction[]]>)(
    'offers exactly %s → %s',
    (status, expected) => {
      // The whole table, enumerated. An authorization table that is sampled is
      // an authorization table with one untested cell.
      expect(availableAdminProviderActions(status).sort()).toEqual([...expected].sort());
    },
  );

  it('lets an ACTIVE provider still be rejected', () => {
    // A provider approved in error must be stoppable without first suspending
    // them. Dropping ACTIVE from `reject` would make the mistake unfixable in
    // one step.
    expect(ADMIN_PROVIDER_TRANSITIONS.reject).toContain('ACTIVE');
  });

  it('cannot be mutated at runtime', () => {
    // The table is the authorization boundary. A caller that can push onto it
    // can grant itself a transition, and `as const` is erased at compile time
    // — it stops a TypeScript author, not a runtime caller.
    //
    // This assertion FAILED when first written, which is why it is here.
    expect(Object.isFrozen(ADMIN_PROVIDER_TRANSITIONS)).toBe(true);
    // The arrays too: freezing the outer object leaves them writable, and the
    // arrays are the part that decides anything.
    for (const action of ALL_ACTIONS) {
      expect(Object.isFrozen(ADMIN_PROVIDER_TRANSITIONS[action])).toBe(true);
    }
  });
});
