import { ProviderCapability } from '@homeservicemarketplace/contracts';

import { ProviderCapabilityService } from './provider-capability.service';

// Sprint 9B.8 — the WHOLE table, one row per provider state.
//
// docs/sprint-09b8/ROUTE_CAPABILITY_MATRIX.md
//
// provider-capability.service.spec.ts asserts each rule at the point it fires.
// This file asserts something that file cannot: the COMPLETE capability set for
// every state, as one table, with both enforcement flags ON.
//
// The difference matters. Per-rule tests answer "does rank 6 deny work when
// unverified?" — they never notice a capability that leaked into a set it does
// not belong in, because no test was looking at that capability in that state.
// Here every row lists every capability the state holds, so an addition
// anywhere shows up as a diff in one place rather than as silence.
//
// The flags are ON throughout, deliberately. Their default is OFF and the rest
// of the suite describes the shipped default; this table describes the world
// the flags exist to reach, which is the one nobody had a complete picture of.

const ALL = [
  ProviderCapability.ViewOwnProfile,
  ProviderCapability.EditOwnProfile,
  ProviderCapability.CompleteOnboarding,
  ProviderCapability.SubmitForReview,
  ProviderCapability.ViewMarketplace,
  ProviderCapability.SubmitBid,
  ProviderCapability.ManageBookings,
  ProviderCapability.ViewEarnings,
  ProviderCapability.ManageVerification,
  ProviderCapability.AppealDecision,
] as const;

interface Account {
  status: string;
  isActive: boolean;
  deletedAt: Date | null;
}
interface Profile {
  status: string;
  onboardingState: string | null;
  standingState: string | null;
  verificationState: string | null;
}

const ELIGIBLE: Account = { status: 'ACTIVE', isActive: true, deletedAt: null };

function makeService(
  account: Account | null,
  profile: Profile | null,
  liveGrant: boolean,
): ProviderCapabilityService {
  const prisma = {
    client: {
      user: { findUnique: jest.fn(async () => account) },
      providerProfile: {
        findFirst: jest.fn(async () => (profile === null ? null : { id: 'pp-1', ...profile })),
      },
      providerWorkAccessGrant: {
        findFirst: jest.fn(async () => (liveGrant ? { id: 'g-1' } : null)),
      },
    },
  };
  const config = {
    get: (k: string) =>
      k === 'WORK_ACCESS_ENFORCED' || k === 'VERIFICATION_ENFORCED' ? true : undefined,
  };
  return new ProviderCapabilityService(prisma as never, config as never);
}

function profile(over: Partial<Profile> = {}): Profile {
  return {
    status: 'ACTIVE',
    onboardingState: 'ACCEPTED',
    standingState: 'GOOD',
    verificationState: 'UNVERIFIED',
    ...over,
  };
}

const C = ProviderCapability;

/** state label -> [account, profile, liveGrant, exactly these capabilities] */
const MATRIX: Array<[string, Account | null, Profile | null, boolean, readonly string[]]> = [
  // ── rank 0: the account outranks everything the provider row says ──────
  [
    'account pending verification',
    { ...ELIGIBLE, status: 'PENDING_VERIFICATION' },
    profile({ verificationState: 'VERIFIED' }),
    true,
    [],
  ],
  ['account deactivated', { ...ELIGIBLE, isActive: false }, profile(), true, []],
  ['account deleted', { ...ELIGIBLE, deletedAt: new Date() }, profile(), true, []],
  ['account suspended', { ...ELIGIBLE, status: 'SUSPENDED' }, profile(), true, []],
  ['no account row at all', null, profile(), true, []],

  // ── rank 1: eligible account, no provider profile ──────────────────────
  // Nothing at all, deliberately: the upgrade route is NOT capability-gated,
  // which is how a seeker becomes a provider without a chicken-and-egg lock.
  ['eligible account, no provider profile', ELIGIBLE, null, false, []],

  // ── rank 2: terminated. Read-only, terminal, no appeal ─────────────────
  [
    'standing TERMINATED',
    ELIGIBLE,
    profile({ standingState: 'TERMINATED', verificationState: 'VERIFIED' }),
    true,
    [C.ViewOwnProfile],
  ],

  // ── rank 3: suspended, on EITHER axis ──────────────────────────────────
  [
    'standing SUSPENDED',
    ELIGIBLE,
    profile({ standingState: 'SUSPENDED', verificationState: 'VERIFIED' }),
    true,
    [C.ViewOwnProfile, C.AppealDecision],
  ],
  [
    'legacy status SUSPENDED, standing still GOOD',
    ELIGIBLE,
    profile({ status: 'SUSPENDED', verificationState: 'VERIFIED' }),
    true,
    [C.ViewOwnProfile, C.AppealDecision],
  ],

  // ── rank 4: restricted. Existing obligations only ──────────────────────
  [
    'standing RESTRICTED',
    ELIGIBLE,
    profile({ standingState: 'RESTRICTED', verificationState: 'VERIFIED' }),
    true,
    [
      C.ViewOwnProfile,
      C.EditOwnProfile,
      C.ManageBookings,
      C.ViewEarnings,
      C.ManageVerification,
      C.AppealDecision,
    ],
  ],

  // ── rank 5: onboarding ─────────────────────────────────────────────────
  [
    'onboarding DRAFT',
    ELIGIBLE,
    profile({ onboardingState: 'DRAFT', status: 'DRAFT' }),
    false,
    [
      C.ViewOwnProfile,
      C.EditOwnProfile,
      C.ManageVerification,
      C.CompleteOnboarding,
      C.SubmitForReview,
    ],
  ],
  [
    'onboarding RETURNED',
    ELIGIBLE,
    profile({ onboardingState: 'RETURNED', status: 'REJECTED' }),
    false,
    [
      C.ViewOwnProfile,
      C.EditOwnProfile,
      C.ManageVerification,
      C.CompleteOnboarding,
      C.SubmitForReview,
    ],
  ],
  [
    'onboarding SUBMITTED — may still edit and supply evidence, may not re-submit',
    ELIGIBLE,
    profile({ onboardingState: 'SUBMITTED', status: 'PENDING_REVIEW' }),
    false,
    [C.ViewOwnProfile, C.EditOwnProfile, C.ManageVerification, C.CompleteOnboarding],
  ],

  // ── rank 6: verification, flag ON ──────────────────────────────────────
  [
    'accepted but UNVERIFIED — no work of any kind',
    ELIGIBLE,
    profile({ verificationState: 'UNVERIFIED' }),
    true,
    [C.ViewOwnProfile, C.EditOwnProfile, C.ManageVerification, C.CompleteOnboarding],
  ],
  [
    'verification EXPIRED — same denial, and evidence management stays open',
    ELIGIBLE,
    profile({ verificationState: 'EXPIRED' }),
    true,
    [C.ViewOwnProfile, C.EditOwnProfile, C.ManageVerification, C.CompleteOnboarding],
  ],
  [
    'verification REJECTED',
    ELIGIBLE,
    profile({ verificationState: 'REJECTED' }),
    true,
    [C.ViewOwnProfile, C.EditOwnProfile, C.ManageVerification, C.CompleteOnboarding],
  ],

  // ── rank 7: work access, flag ON ───────────────────────────────────────
  [
    'VERIFIED but no live grant — revoked or expired',
    ELIGIBLE,
    profile({ verificationState: 'VERIFIED' }),
    false,
    [C.ViewOwnProfile, C.EditOwnProfile, C.ManageVerification],
  ],

  // ── rank 8: the full working set ───────────────────────────────────────
  [
    'VERIFIED with a live grant — the only state that can take work',
    ELIGIBLE,
    profile({ verificationState: 'VERIFIED' }),
    true,
    [
      C.ViewOwnProfile,
      C.EditOwnProfile,
      C.ManageVerification,
      C.ViewMarketplace,
      C.SubmitBid,
      C.ManageBookings,
      C.ViewEarnings,
    ],
  ],
];

describe('the complete capability matrix, both flags ON', () => {
  it.each(MATRIX)('%s', async (_label, account, prof, grant, expected) => {
    const service = makeService(account, prof, grant);
    const set = await service.for('u-1');

    expect([...set.allowed].sort()).toEqual([...expected].sort());
  });

  it.each(MATRIX)(
    '%s — can() agrees with the set, capability by capability',
    async (_label, account, prof, grant, expected) => {
      // The set is what the UI renders from; can() is what the guard enforces
      // with. Two answers to one question is the drift ADR 0006 exists to
      // prevent, so they are checked against each other for every capability in
      // every state rather than trusted to stay aligned.
      const service = makeService(account, prof, grant);
      const held = new Set(expected);

      for (const capability of ALL) {
        await expect(service.can('u-1', capability)).resolves.toBe(held.has(capability));
      }
    },
  );
});

describe('properties that must hold in every state', () => {
  it('never grants a working capability without a live grant', async () => {
    // The whole point of rank 7. Stated once over the entire table so a new
    // row cannot quietly become an exception.
    const working = [C.ViewMarketplace, C.SubmitBid, C.SubmitBid, C.ManageBookings];
    for (const [label, , , grant, expected] of MATRIX) {
      if (grant) continue;
      for (const c of working) {
        if (expected.includes(c)) {
          throw new Error(`${label} holds ${c} with no live grant`);
        }
      }
    }
    expect(true).toBe(true);
  });

  it('never grants anything at all to an ineligible account', async () => {
    for (const [label, account, , , expected] of MATRIX) {
      const eligible =
        account !== null &&
        account.deletedAt === null &&
        account.isActive &&
        account.status === 'ACTIVE';
      if (!eligible && expected.length > 0) {
        throw new Error(`${label} holds capabilities with an ineligible account`);
      }
    }
    expect(true).toBe(true);
  });

  it('always leaves a locked-out provider able to SEE their own record', async () => {
    // A denial nobody can inspect is a dead end. The only states without
    // VIEW_OWN_PROFILE are the ones with no provider row and the ones where
    // the ACCOUNT itself is gone — where there is nothing to show.
    for (const [label, account, prof, , expected] of MATRIX) {
      const eligible =
        account !== null &&
        account.deletedAt === null &&
        account.isActive &&
        account.status === 'ACTIVE';
      if (eligible && prof !== null && !expected.includes(C.ViewOwnProfile)) {
        throw new Error(`${label} cannot read its own profile`);
      }
    }
    expect(true).toBe(true);
  });

  it('covers every capability in the enum somewhere in the table', async () => {
    // Non-vacuity. A capability held by no row and denied by no row would make
    // its column of this matrix meaningless.
    const everGranted = new Set(MATRIX.flatMap(([, , , , caps]) => caps));
    for (const c of ALL) {
      expect(everGranted.has(c)).toBe(true);
    }
  });
});

describe('VIP, Featured and paid tiers cannot bypass any of it', () => {
  it.each([
    ['subscriptionTier BASIC', { subscriptionTier: 'BASIC' }],
    ['subscriptionTier PREMIUM', { subscriptionTier: 'PREMIUM' }],
    ['topPro', { topPro: true }],
    ['verified flag set independently of the axis', { verified: true }],
    ['a speculative VIP column', { vip: true }],
    ['a speculative Featured column', { featured: true }],
  ])('%s changes nothing for an unverified provider', async (_label, extra) => {
    // ADR 0005 axis 5 is inert BY CONSTRUCTION: a paid tier that needs to
    // unlock an action does so by issuing a work-access grant, so the decision
    // stays auditable. VIP and Featured do not exist in this schema; the last
    // two rows pass columns that are not there precisely to prove the resolver
    // reads none of them, so introducing such a column later cannot silently
    // become a bypass.
    const baseline = await makeService(ELIGIBLE, profile(), false).for('u-1');
    const withExtra = await makeService(
      ELIGIBLE,
      { ...profile(), ...(extra as object) },
      false,
    ).for('u-1');

    expect([...withExtra.allowed].sort()).toEqual([...baseline.allowed].sort());
  });

  it('cannot promote a suspended provider either', async () => {
    const suspended = profile({ standingState: 'SUSPENDED' });
    const bribed = { ...suspended, subscriptionTier: 'PREMIUM', topPro: true, vip: true };

    const a = await makeService(ELIGIBLE, suspended, true).for('u-1');
    const b = await makeService(ELIGIBLE, bribed as Profile, true).for('u-1');

    expect([...b.allowed].sort()).toEqual([...a.allowed].sort());
  });
});
