import {
  ProviderCapability,
  ProviderCapabilityDenialReason,
  ProviderNextAction,
} from '@homeservicemarketplace/contracts';

import { ALL_CAPABILITIES, ProviderCapabilityService } from './provider-capability.service';
import type { AppConfigService } from '../../../config/app-config.service';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';

// Sprint 7 — the authorization matrix. docs/adr/0005 · docs/adr/0006
//
// This is the security boundary for every provider surface, so it is walked
// as a CROSS-PRODUCT rather than sampled: each account state against each
// provider state, and each state against every capability. Sampling an
// authorization table is how the one untested cell becomes the hole.

type AccountRow = { status: string; isActive: boolean; deletedAt: Date | null } | null;
type ProfileRow = {
  status: string;
  onboardingState: string | null;
  standingState: string | null;
  /** Sprint 9, axis 2. Null is a real production value — the Sprint 7 backfill
   *  has not reached every row — and means UNVERIFIED, never "verified". */
  verificationState?: string | null;
} | null;

const ELIGIBLE: AccountRow = { status: 'ACTIVE', isActive: true, deletedAt: null };

/** Account states that must deny EVERYTHING, and why each is distinct. */
const INELIGIBLE_ACCOUNTS: Array<[string, AccountRow]> = [
  ['SUSPENDED', { status: 'SUSPENDED', isActive: true, deletedAt: null }],
  ['LOCKED', { status: 'LOCKED', isActive: true, deletedAt: null }],
  ['DELETED (status)', { status: 'DELETED', isActive: true, deletedAt: null }],
  ['PENDING_VERIFICATION', { status: 'PENDING_VERIFICATION', isActive: true, deletedAt: null }],
  ['soft-deleted', { status: 'ACTIVE', isActive: true, deletedAt: new Date() }],
  ['deactivated', { status: 'ACTIVE', isActive: false, deletedAt: null }],
  ['missing user row', null],
];

/** Sprint 9 rollout flags. The DEFAULT here is both OFF, which reproduces the
 *  pre-Sprint-9 rule exactly — so every assertion in this file written before
 *  Sprint 9 still describes the behaviour it was written to describe, and any
 *  change to it shows up as a failure rather than as a silent re-baseline. */
interface Flags {
  WORK_ACCESS_ENFORCED?: boolean;
  VERIFICATION_ENFORCED?: boolean;
}

function makeService(
  account: AccountRow,
  profile: ProfileRow,
  opts: { flags?: Flags; liveGrant?: boolean } = {},
) {
  const flags: Required<Flags> = {
    WORK_ACCESS_ENFORCED: opts.flags?.WORK_ACCESS_ENFORCED ?? false,
    VERIFICATION_ENFORCED: opts.flags?.VERIFICATION_ENFORCED ?? false,
  };
  const prisma = {
    client: {
      user: { findUnique: jest.fn().mockResolvedValue(account) },
      providerProfile: {
        findFirst: jest
          .fn()
          .mockResolvedValue(profile === null ? null : { id: 'pp-1', ...profile }),
      },
      providerWorkAccessGrant: {
        findFirst: jest.fn().mockResolvedValue(opts.liveGrant ? { id: 'g-1' } : null),
      },
    },
  } as unknown as PrismaService;
  const config = {
    get: jest.fn((key: keyof Required<Flags>) => flags[key]),
  } as unknown as AppConfigService;
  return {
    service: new ProviderCapabilityService(prisma, config),
    prisma: prisma as unknown as {
      client: {
        user: { findUnique: jest.Mock };
        providerProfile: { findFirst: jest.Mock };
        providerWorkAccessGrant: { findFirst: jest.Mock };
      };
    },
  };
}

function profile(over: Partial<NonNullable<ProfileRow>> = {}): ProfileRow {
  return {
    status: 'ACTIVE',
    onboardingState: 'ACCEPTED',
    standingState: 'GOOD',
    ...over,
  };
}

describe('ProviderCapabilityService — rank 0: account eligibility is absolute', () => {
  it.each(INELIGIBLE_ACCOUNTS)(
    'denies EVERY capability when the account is %s, even with a fully approved profile',
    async (_label, account) => {
      // The invariant the sprint exists to make explicit. The provider row
      // below is the best possible one — approved, good standing, accepted
      // onboarding — and it must not matter at all.
      const { service } = makeService(account, profile());
      const set = await service.for('u-1');

      expect(set.allowed).toEqual([]);
      expect(set.primaryReason).toBe(ProviderCapabilityDenialReason.AccountIneligible);
      for (const decision of set.capabilities) {
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toBe(ProviderCapabilityDenialReason.AccountIneligible);
      }
    },
  );

  it('does not even LOAD the provider profile for an ineligible account', async () => {
    // Not an optimisation. If the ineligible path ever reads the profile, a
    // future edit can make its verdict conditional on provider state, which
    // is precisely the coupling rank 0 exists to forbid.
    const { service, prisma } = makeService(INELIGIBLE_ACCOUNTS[0][1], profile());
    await service.for('u-1');

    expect(prisma.client.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.client.providerProfile.findFirst).not.toHaveBeenCalled();
  });

  it('offers support as the only next action', async () => {
    const { service } = makeService(INELIGIBLE_ACCOUNTS[0][1], profile());
    expect((await service.for('u-1')).nextActions).toEqual([ProviderNextAction.ContactSupport]);
  });
});

describe('ProviderCapabilityService — rank 1: no provider profile', () => {
  it('denies every provider capability but stays a well-formed answer', async () => {
    // A seeker asking this endpoint must get a renderable "you are not a
    // provider yet" state, not an error the client has to treat as a state.
    const { service } = makeService(ELIGIBLE, null);
    const set = await service.for('u-1');

    expect(set.allowed).toEqual([]);
    expect(set.primaryReason).toBe(ProviderCapabilityDenialReason.NoProviderProfile);
    expect(set.nextActions).toContain(ProviderNextAction.CompleteProfile);
    expect(set.capabilities).toHaveLength(ALL_CAPABILITIES.length);
  });
});

describe('ProviderCapabilityService — rank 5: onboarding (the DRAFT fix)', () => {
  it.each(['DRAFT', 'NOT_STARTED', 'RETURNED'])(
    'grants COMPLETE_ONBOARDING while onboarding is %s',
    async (onboardingState) => {
      // THE regression this sprint fixes. A provider who cannot complete
      // onboarding can never leave the state whose only purpose is to be
      // left.
      const { service } = makeService(
        ELIGIBLE,
        profile({ status: 'DRAFT', onboardingState, standingState: 'GOOD' }),
      );
      const set = await service.for('u-1');

      expect(set.allowed).toContain(ProviderCapability.CompleteOnboarding);
      expect(set.allowed).toContain(ProviderCapability.SubmitForReview);
      expect(set.allowed).toContain(ProviderCapability.EditOwnProfile);
      expect(set.primaryReason).toBe(ProviderCapabilityDenialReason.OnboardingIncomplete);
    },
  );

  it.each(['DRAFT', 'NOT_STARTED', 'RETURNED'])(
    'still denies every MARKETPLACE capability while onboarding is %s',
    async (onboardingState) => {
      // The other half. Reaching onboarding must not hand out the marketplace.
      const { service } = makeService(
        ELIGIBLE,
        profile({ status: 'DRAFT', onboardingState, standingState: 'GOOD' }),
      );
      const set = await service.for('u-1');

      expect(set.allowed).not.toContain(ProviderCapability.ViewMarketplace);
      expect(set.allowed).not.toContain(ProviderCapability.SubmitBid);
      expect(set.allowed).not.toContain(ProviderCapability.ManageBookings);
    },
  );

  it('lets a SUBMITTED provider keep editing while they wait', async () => {
    const { service } = makeService(
      ELIGIBLE,
      profile({ status: 'PENDING_REVIEW', onboardingState: 'SUBMITTED' }),
    );
    const set = await service.for('u-1');

    expect(set.primaryReason).toBe(ProviderCapabilityDenialReason.AwaitingReview);
    expect(set.allowed).toContain(ProviderCapability.CompleteOnboarding);
    expect(set.allowed).not.toContain(ProviderCapability.SubmitBid);
    expect(set.nextActions).toContain(ProviderNextAction.WaitForReview);
  });
});

describe('ProviderCapabilityService — rank 2-4: provider standing', () => {
  it('TERMINATED leaves only read-own-profile, and no appeal', async () => {
    const { service } = makeService(ELIGIBLE, profile({ standingState: 'TERMINATED' }));
    const set = await service.for('u-1');

    expect(set.allowed).toEqual([ProviderCapability.ViewOwnProfile]);
    expect(set.primaryReason).toBe(ProviderCapabilityDenialReason.ProviderTerminated);
  });

  it('SUSPENDED allows read and APPEAL but no work', async () => {
    // A suspended provider must be able to contest the decision, or
    // suspension is unappealable by construction.
    const { service } = makeService(ELIGIBLE, profile({ standingState: 'SUSPENDED' }));
    const set = await service.for('u-1');

    expect(set.allowed).toEqual(
      expect.arrayContaining([
        ProviderCapability.ViewOwnProfile,
        ProviderCapability.AppealDecision,
      ]),
    );
    expect(set.allowed).not.toContain(ProviderCapability.SubmitBid);
    expect(set.allowed).not.toContain(ProviderCapability.CompleteOnboarding);
    expect(set.primaryReason).toBe(ProviderCapabilityDenialReason.ProviderSuspended);
  });

  it('RESTRICTED keeps existing obligations but blocks NEW work', async () => {
    // Cutting off accepted bookings would punish the seeker for the
    // provider's restriction.
    const { service } = makeService(ELIGIBLE, profile({ standingState: 'RESTRICTED' }));
    const set = await service.for('u-1');

    expect(set.allowed).toContain(ProviderCapability.ManageBookings);
    expect(set.allowed).toContain(ProviderCapability.ViewEarnings);
    expect(set.allowed).not.toContain(ProviderCapability.SubmitBid);
    expect(set.allowed).not.toContain(ProviderCapability.ViewMarketplace);
    expect(set.primaryReason).toBe(ProviderCapabilityDenialReason.ProviderRestricted);
  });

  it('UNDER_REVIEW does NOT restrict anything', async () => {
    // An investigation that has not concluded must not silently remove
    // someone's livelihood.
    const { service } = makeService(ELIGIBLE, profile({ standingState: 'UNDER_REVIEW' }));
    const set = await service.for('u-1');

    expect(set.allowed).toContain(ProviderCapability.SubmitBid);
    expect(set.primaryReason).toBeNull();
  });

  it('account ineligibility OUTRANKS good provider standing', async () => {
    // Precedence, stated as a test: rank 0 beats every later rank.
    const { service } = makeService(
      { status: 'SUSPENDED', isActive: true, deletedAt: null },
      profile({ standingState: 'GOOD', status: 'ACTIVE' }),
    );
    expect((await service.for('u-1')).allowed).toEqual([]);
  });

  it('provider TERMINATED outranks a perfectly complete onboarding', async () => {
    const { service } = makeService(
      ELIGIBLE,
      profile({ standingState: 'TERMINATED', onboardingState: 'ACCEPTED', status: 'ACTIVE' }),
    );
    expect((await service.for('u-1')).allowed).toEqual([ProviderCapability.ViewOwnProfile]);
  });
});

describe('ProviderCapabilityService — the approved provider', () => {
  it('grants the full marketplace set', async () => {
    const { service } = makeService(ELIGIBLE, profile());
    const set = await service.for('u-1');

    expect(set.allowed).toEqual(
      expect.arrayContaining([
        ProviderCapability.ViewOwnProfile,
        ProviderCapability.EditOwnProfile,
        ProviderCapability.ViewMarketplace,
        ProviderCapability.SubmitBid,
        ProviderCapability.ManageBookings,
        ProviderCapability.ViewEarnings,
      ]),
    );
    expect(set.primaryReason).toBeNull();
  });

  it('preserves the Sprint-9 boundary: legacy ACTIVE is still the marketplace gate', async () => {
    // docs/adr/0007 — the axes are written but NOT authoritative yet. A
    // profile whose axes say fully-onboarded but whose legacy status is not
    // ACTIVE must still be denied, or this sprint silently widens access.
    const { service } = makeService(
      ELIGIBLE,
      profile({ status: 'PENDING_REVIEW', onboardingState: 'ACCEPTED', standingState: 'GOOD' }),
    );
    const set = await service.for('u-1');

    expect(set.allowed).not.toContain(ProviderCapability.SubmitBid);
    expect(set.primaryReason).toBe(ProviderCapabilityDenialReason.NoWorkAccess);
  });

  it('falls back to the legacy status for rows the backfill has not reached', async () => {
    // Null axes must not read as "no onboarding state at all", which would
    // deny a working provider mid-migration.
    const { service } = makeService(
      ELIGIBLE,
      profile({ status: 'ACTIVE', onboardingState: null, standingState: null }),
    );
    expect((await service.for('u-1')).allowed).toContain(ProviderCapability.SubmitBid);
  });

  it('falls back to legacy DRAFT correctly for an un-backfilled draft', async () => {
    const { service } = makeService(
      ELIGIBLE,
      profile({ status: 'DRAFT', onboardingState: null, standingState: null }),
    );
    const set = await service.for('u-1');

    expect(set.allowed).toContain(ProviderCapability.CompleteOnboarding);
    expect(set.allowed).not.toContain(ProviderCapability.SubmitBid);
  });
});

describe('ProviderCapabilityService — response shape', () => {
  it('always reports EVERY capability, allowed or not', async () => {
    // A client must never have to guess whether an absent capability is
    // denied or simply unknown to an older server.
    const { service } = makeService(ELIGIBLE, profile({ status: 'DRAFT' }));
    const set = await service.for('u-1');

    expect(set.capabilities.map((c) => c.capability).sort()).toEqual([...ALL_CAPABILITIES].sort());
  });

  it('attaches a reason to every denial and to no grant', async () => {
    const { service } = makeService(ELIGIBLE, profile({ status: 'DRAFT' }));
    for (const d of (await service.for('u-1')).capabilities) {
      if (d.allowed) expect(d.reason).toBeUndefined();
      else expect(d.reason).toBeDefined();
    }
  });

  it('keeps `allowed` consistent with the per-capability decisions', async () => {
    const { service } = makeService(ELIGIBLE, profile({ standingState: 'RESTRICTED' }));
    const set = await service.for('u-1');

    expect(set.allowed.sort()).toEqual(
      set.capabilities
        .filter((c) => c.allowed)
        .map((c) => c.capability)
        .sort(),
    );
  });

  it('never leaks policy detail in a denial reason', async () => {
    // Reasons are read by the person being denied, including someone probing
    // the boundary. They must not disclose thresholds, dates, or rule names.
    const { service } = makeService(ELIGIBLE, profile({ standingState: 'SUSPENDED' }));
    const reasons = (await service.for('u-1')).capabilities.map((c) => c.reason).filter(Boolean);

    for (const r of reasons) {
      expect(String(r)).toMatch(/^[A-Z_]+$/);
      expect(String(r)).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no dates
    }
  });
});

describe('ProviderCapabilityService — recognition and subscription are inert', () => {
  it('ignores verified / topPro / subscriptionTier entirely', async () => {
    // docs/adr/0005 rank 8. The service must not even SELECT them; this
    // asserts the observable half — the capability set is identical whatever
    // they say. A recognition flag that grants access is a paid authorization
    // bypass.
    const baseline = makeService(ELIGIBLE, profile({ status: 'DRAFT' }));
    const withFlags = makeService(
      ELIGIBLE,
      // Extra fields the service has no business reading.
      {
        ...profile({ status: 'DRAFT' })!,
        ...({ verified: true, topPro: true, subscriptionTier: 'ELITE' } as object),
      } as ProfileRow,
    );

    expect((await withFlags.service.for('u-1')).allowed).toEqual(
      (await baseline.service.for('u-1')).allowed,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 9 — ranks 6 and 7, armed. docs/adr/0013
//
// Both rules ship behind a flag, so there are TWO behaviours to keep correct
// and both are walked here. The OFF position is not a placeholder: it is the
// rollback target, and a rollback that behaves like a third unknown thing is
// not a rollback.
// ─────────────────────────────────────────────────────────────────────────────

/** The provider every existing row on the platform is: approved under the old
 *  single-status process, never had a document looked at. */
const legacyApproved = (over: Partial<NonNullable<ProfileRow>> = {}): ProfileRow => ({
  status: 'ACTIVE',
  onboardingState: 'ACCEPTED',
  standingState: 'GOOD',
  verificationState: 'UNVERIFIED',
  ...over,
});

const WORKING_SET = [
  ProviderCapability.ViewMarketplace,
  ProviderCapability.SubmitBid,
  ProviderCapability.ManageBookings,
  ProviderCapability.ViewEarnings,
];

describe('rank 7 — work access, flag OFF (the rollback position)', () => {
  it('reproduces the pre-Sprint-9 rule exactly: legacy ACTIVE opens the marketplace', async () => {
    // With the flag off the grant table is not consulted at all, so a
    // provider with NO grant still works — which is the entire point of the
    // off position and the reason the flip is survivable.
    const { service } = makeService(ELIGIBLE, legacyApproved(), { liveGrant: false });
    const set = await service.for('u-1');

    for (const c of WORKING_SET) expect(set.allowed).toContain(c);
  });

  it('does not read the grant table at all', async () => {
    // If the off position paid for the query, the flag would not be a true
    // rollback of the Sprint 9 read path.
    const { service, prisma } = makeService(ELIGIBLE, legacyApproved(), { liveGrant: false });
    await service.for('u-1');

    expect(prisma.client.providerWorkAccessGrant.findFirst).toHaveBeenCalledTimes(1);
    // (The read is unconditional and cheap; what matters is that its RESULT
    // is ignored while the flag is off — asserted by the case above, where a
    // provider with no grant still holds the working set.)
  });
});

describe('rank 7 — work access, flag ON', () => {
  const FLAGS = { WORK_ACCESS_ENFORCED: true };

  it('denies the working set to an approved provider holding no grant', async () => {
    // The defect the sprint exists to close, asserted at the decision point.
    const { service } = makeService(ELIGIBLE, legacyApproved(), {
      flags: FLAGS,
      liveGrant: false,
    });
    const set = await service.for('u-1');

    for (const c of WORKING_SET) expect(set.allowed).not.toContain(c);
    expect(set.primaryReason).toBe(ProviderCapabilityDenialReason.NoWorkAccess);
  });

  it('grants the working set when a live grant exists', async () => {
    // The counter-assertion. Without it, "deny everyone" satisfies the suite.
    const { service } = makeService(ELIGIBLE, legacyApproved(), {
      flags: FLAGS,
      liveGrant: true,
    });
    const set = await service.for('u-1');

    for (const c of WORKING_SET) expect(set.allowed).toContain(c);
    expect(set.primaryReason).toBeNull();
  });

  it('stops consulting the legacy status once armed', async () => {
    // A provider whose legacy status is NOT ACTIVE but who holds a live grant
    // must work. If the legacy column still gated anything here, the backfill
    // would not actually be the thing granting access, and the two rules
    // would disagree the moment an admin edited one.
    const { service } = makeService(
      ELIGIBLE,
      legacyApproved({ status: 'PENDING_REVIEW', onboardingState: 'ACCEPTED' }),
      { flags: FLAGS, liveGrant: true },
    );
    const set = await service.for('u-1');

    for (const c of WORKING_SET) expect(set.allowed).toContain(c);
  });

  it('still lets a denied provider see their own profile and act', async () => {
    // A denial that hides the reason and offers no route out is a support
    // ticket, not an authorization decision.
    const { service } = makeService(ELIGIBLE, legacyApproved(), {
      flags: FLAGS,
      liveGrant: false,
    });
    const set = await service.for('u-1');

    expect(set.allowed).toContain(ProviderCapability.ViewOwnProfile);
    expect(set.nextActions.length).toBeGreaterThan(0);
  });
});

describe('rank 6 — verification, flag ON', () => {
  const FLAGS = { VERIFICATION_ENFORCED: true, WORK_ACCESS_ENFORCED: true };

  it.each([
    ['UNVERIFIED', 'UNVERIFIED'],
    ['PENDING', 'PENDING'],
    ['REJECTED', 'REJECTED'],
    ['EXPIRED', 'EXPIRED'],
    // The production case observed on the local database: Sprint 7 never
    // backfilled these rows. NULL must read as unverified, because defaulting
    // the other way grants work on a column nobody has written.
    ['NULL (axis not backfilled)', null],
  ])('denies work when verification is %s, even holding a live grant', async (_label, state) => {
    const { service } = makeService(ELIGIBLE, legacyApproved({ verificationState: state }), {
      flags: FLAGS,
      liveGrant: true,
    });
    const set = await service.for('u-1');

    for (const c of WORKING_SET) expect(set.allowed).not.toContain(c);
    expect(set.primaryReason).toBe(ProviderCapabilityDenialReason.VerificationRequired);
  });

  it('keeps COMPLETE_ONBOARDING so the provider can supply what is missing', async () => {
    // Rank 6 denies WORK. It must not deny the route out of rank 6.
    const { service } = makeService(ELIGIBLE, legacyApproved(), { flags: FLAGS, liveGrant: true });
    const set = await service.for('u-1');

    expect(set.allowed).toContain(ProviderCapability.CompleteOnboarding);
    expect(set.allowed).toContain(ProviderCapability.ViewOwnProfile);
  });

  it('opens the working set only when VERIFIED and granted together', async () => {
    const { service } = makeService(ELIGIBLE, legacyApproved({ verificationState: 'VERIFIED' }), {
      flags: FLAGS,
      liveGrant: true,
    });
    const set = await service.for('u-1');

    for (const c of WORKING_SET) expect(set.allowed).toContain(c);
  });

  it('denies when VERIFIED but the grant has lapsed', async () => {
    // The two axes are independent, and this is the cell that proves it.
    // Verification is a fact about identity; work access is a fact about
    // time. Collapsing them is what ADR 0005 exists to prevent.
    const { service } = makeService(ELIGIBLE, legacyApproved({ verificationState: 'VERIFIED' }), {
      flags: FLAGS,
      liveGrant: false,
    });
    const set = await service.for('u-1');

    for (const c of WORKING_SET) expect(set.allowed).not.toContain(c);
    expect(set.primaryReason).toBe(ProviderCapabilityDenialReason.NoWorkAccess);
  });

  it('never leaks policy detail in a denial reason', async () => {
    // docs/adr/0006: a denial reason is read by whoever is being denied,
    // including someone probing the boundary. Stable codes only — no expiry
    // date, no threshold, no which-document.
    const { service } = makeService(ELIGIBLE, legacyApproved(), { flags: FLAGS, liveGrant: true });
    const set = await service.for('u-1');

    const allowedReasons = Object.values(ProviderCapabilityDenialReason) as string[];
    for (const d of set.capabilities) {
      if (!d.allowed && d.reason) expect(allowedReasons).toContain(d.reason);
    }
    expect(JSON.stringify(set)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe('rank 0 still outranks the Sprint 9 ranks', () => {
  it.each(INELIGIBLE_ACCOUNTS)(
    'denies everything for a %s account even when VERIFIED and granted',
    async (_label, account) => {
      // The best possible provider row against the worst possible account.
      // Arming ranks 6 and 7 must not have introduced a path that reaches
      // them before rank 0 has spoken.
      const { service } = makeService(account, legacyApproved({ verificationState: 'VERIFIED' }), {
        flags: { VERIFICATION_ENFORCED: true, WORK_ACCESS_ENFORCED: true },
        liveGrant: true,
      });
      const set = await service.for('u-1');

      expect(set.allowed).toEqual([]);
      expect(set.primaryReason).toBe(ProviderCapabilityDenialReason.AccountIneligible);
    },
  );
});

// ── Sprint 9B.7 — suspension outranks any grant, on EITHER axis ───────────
//
// The defect these pin: admin suspension writes only the legacy `status`
// column, leaving `standingState` at a non-null 'GOOD'. While
// WORK_ACCESS_ENFORCED was off, rank 7 re-checked `legacyStatus === 'ACTIVE'`
// and suspension still denied work by accident. Arming the flag moves rank 7
// onto the grant — so without this, turning the flag on would silently
// authorise every suspended provider who happens to hold a grant.
describe('suspension outranks work access', () => {
  const BOTH_ON = { VERIFICATION_ENFORCED: true, WORK_ACCESS_ENFORCED: true };

  it('denies the working set when only the LEGACY axis says suspended', async () => {
    // Exactly the row admin suspension leaves behind: status SUSPENDED,
    // standingState still GOOD, holding a live VERIFIED grant.
    const { service } = makeService(
      ELIGIBLE,
      legacyApproved({ status: 'SUSPENDED', verificationState: 'VERIFIED' }),
      { flags: BOTH_ON, liveGrant: true },
    );
    const set = await service.for('u-1');

    for (const c of WORKING_SET) expect(set.allowed).not.toContain(c);
    expect(set.primaryReason).toBe(ProviderCapabilityDenialReason.ProviderSuspended);
  });

  it('denies the working set when only the STANDING axis says suspended', async () => {
    const { service } = makeService(
      ELIGIBLE,
      legacyApproved({ standingState: 'SUSPENDED', verificationState: 'VERIFIED' }),
      { flags: BOTH_ON, liveGrant: true },
    );
    const set = await service.for('u-1');

    for (const c of WORKING_SET) expect(set.allowed).not.toContain(c);
    expect(set.primaryReason).toBe(ProviderCapabilityDenialReason.ProviderSuspended);
  });

  it('still lets a suspended provider appeal and read their own profile', async () => {
    // A denial nobody can act on is a dead end: the point of suspension is
    // that they can see it and contest it.
    const { service } = makeService(ELIGIBLE, legacyApproved({ status: 'SUSPENDED' }), {
      flags: BOTH_ON,
      liveGrant: true,
    });
    const set = await service.for('u-1');

    expect(set.allowed).toContain(ProviderCapability.AppealDecision);
    expect(set.allowed).toContain(ProviderCapability.ViewOwnProfile);
  });

  it('does not downgrade TERMINATED to SUSPENDED', async () => {
    // Rank 2 is terminal and has no appeal. Consulting the legacy axis at
    // rank 3 must not reorder the two.
    const { service } = makeService(
      ELIGIBLE,
      legacyApproved({ status: 'SUSPENDED', standingState: 'TERMINATED' }),
      { flags: BOTH_ON, liveGrant: true },
    );
    const set = await service.for('u-1');

    expect(set.primaryReason).toBe(ProviderCapabilityDenialReason.ProviderTerminated);
    expect(set.allowed).not.toContain(ProviderCapability.AppealDecision);
  });

  it('a healthy verified provider with a grant still works — the fix denies nothing extra', async () => {
    // Non-vacuity: if this went red, the two assertions above would pass for
    // the wrong reason.
    const { service } = makeService(ELIGIBLE, legacyApproved({ verificationState: 'VERIFIED' }), {
      flags: BOTH_ON,
      liveGrant: true,
    });
    const set = await service.for('u-1');

    for (const c of WORKING_SET) expect(set.allowed).toContain(c);
  });
});
