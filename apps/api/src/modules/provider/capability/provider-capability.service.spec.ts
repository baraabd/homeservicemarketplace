import {
  ProviderCapability,
  ProviderCapabilityDenialReason,
  ProviderNextAction,
} from '@homeservicemarketplace/contracts';

import { ALL_CAPABILITIES, ProviderCapabilityService } from './provider-capability.service';
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

function makeService(account: AccountRow, profile: ProfileRow) {
  const prisma = {
    client: {
      user: { findUnique: jest.fn().mockResolvedValue(account) },
      providerProfile: { findFirst: jest.fn().mockResolvedValue(profile) },
    },
  } as unknown as PrismaService;
  return {
    service: new ProviderCapabilityService(prisma),
    prisma: prisma as unknown as {
      client: {
        user: { findUnique: jest.Mock };
        providerProfile: { findFirst: jest.Mock };
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
