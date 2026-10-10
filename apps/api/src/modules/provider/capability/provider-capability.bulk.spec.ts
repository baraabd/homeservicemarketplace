import { ProviderCapability } from '@homeservicemarketplace/contracts';

import {
  ProviderCapabilityService,
  marketplaceCandidateAdmits,
  marketplaceCandidateRule,
  type CapabilityContext,
} from './provider-capability.service';

// R17-E closure (E-13) — the request-available fan-out decides recipients in
// bulk. Two properties keep it the SAME decision as the provider routes:
//
//   1. holdersAmong(ids) answers exactly what for(id) answers for each id,
//      in a fixed number of reads.
//   2. The candidate rule the fan-out turns into SQL only drops providers the
//      precedence table would deny: over every context and both flags,
//      decide() granting VIEW_MARKETPLACE implies the rule admits it. If a
//      rank is relaxed and the rule is not, this fails before a provider
//      silently stops being notified.

const STANDING = [null, 'GOOD', 'UNDER_REVIEW', 'RESTRICTED', 'SUSPENDED', 'TERMINATED'];
// ProviderProfile.status is NOT NULL (@default(DRAFT)): a profile always has
// one. The axis columns are nullable (backfill) and keep their null.
const LEGACY = ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'REJECTED'];
const ONBOARDING = [
  null,
  'NOT_STARTED',
  'DRAFT',
  'SUBMITTED',
  'DOCUMENTS_REQUIRED',
  'RETURNED',
  'ACCEPTED',
];
const VERIFICATION = [null, 'UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED'];

function* contexts(): Generator<CapabilityContext> {
  yield {
    accountEligible: false,
    hasProfile: false,
    onboardingState: null,
    standingState: null,
    legacyStatus: null,
    verificationState: null,
    hasLiveWorkAccessGrant: false,
  };
  yield {
    accountEligible: true,
    hasProfile: false,
    onboardingState: null,
    standingState: null,
    legacyStatus: null,
    verificationState: null,
    hasLiveWorkAccessGrant: false,
  };
  for (const standingState of STANDING)
    for (const legacyStatus of LEGACY)
      for (const onboardingState of ONBOARDING)
        for (const verificationState of VERIFICATION)
          for (const hasLiveWorkAccessGrant of [false, true])
            yield {
              accountEligible: true,
              hasProfile: true,
              standingState,
              legacyStatus,
              onboardingState,
              verificationState,
              hasLiveWorkAccessGrant,
            };
}

const service = (flags: { work: boolean; verification: boolean }, client: unknown = {}) =>
  new ProviderCapabilityService(
    { client } as never,
    {
      get: (key: string) =>
        key === 'WORK_ACCESS_ENFORCED'
          ? flags.work
          : key === 'VERIFICATION_ENFORCED'
            ? flags.verification
            : undefined,
    } as never,
  );

const FLAGS = [
  { work: false, verification: false },
  { work: true, verification: false },
  { work: false, verification: true },
  { work: true, verification: true },
];

describe('ProviderCapabilityService — bulk decision for the fan-out (R17-E closure)', () => {
  it.each(FLAGS)(
    'the candidate rule never drops a provider decide() lets view the marketplace %o',
    (flags) => {
      const svc = service(flags);
      const rule = marketplaceCandidateRule({
        workAccessEnforced: flags.work,
        verificationEnforced: flags.verification,
      });
      let granted = 0;
      let narrowed = 0;
      for (const ctx of contexts()) {
        const allowed = svc.forContext(ctx).allowed.includes(ProviderCapability.ViewMarketplace);
        const admitted = marketplaceCandidateAdmits(rule, ctx);
        if (allowed) {
          granted += 1;
          expect({ ctx, admitted }).toEqual({ ctx, admitted: true });
        } else if (!admitted) narrowed += 1;
      }
      // The rule is not vacuous: it admits real providers and drops real
      // non-holders, so the SQL narrowing does work.
      expect(granted).toBeGreaterThan(0);
      expect(narrowed).toBeGreaterThan(0);
    },
  );

  it('marketplaceCandidateWhere mirrors the rule under the flags in force', () => {
    const where = service({ work: true, verification: true }).marketplaceCandidateWhere(
      new Date('2026-10-10T00:00:00Z'),
    );
    expect(where).toMatchObject({
      deletedAt: null,
      userId: { not: null },
      status: { in: ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED'] },
      user: { status: 'ACTIVE', isActive: true, deletedAt: null },
    });
    expect(JSON.stringify(where.AND)).toContain('"verificationState":"VERIFIED"');
    expect(JSON.stringify(where.AND)).toContain('workAccessGrants');
    const legacy = service({ work: false, verification: false }).marketplaceCandidateWhere();
    expect(legacy.status).toEqual({ in: ['ACTIVE'] });
    expect(JSON.stringify(legacy.AND)).not.toContain('workAccessGrants');
    expect(JSON.stringify(legacy.AND)).not.toContain('verificationState');
  });

  describe('holdersAmong', () => {
    // Five providers, one per way of losing the marketplace, plus one holder.
    const accounts = [
      { id: 'u-ok', status: 'ACTIVE', isActive: true, deletedAt: null },
      { id: 'u-acct', status: 'SUSPENDED', isActive: true, deletedAt: null },
      { id: 'u-restricted', status: 'ACTIVE', isActive: true, deletedAt: null },
      { id: 'u-nogrant', status: 'ACTIVE', isActive: true, deletedAt: null },
      { id: 'u-unverified', status: 'ACTIVE', isActive: true, deletedAt: null },
      { id: 'u-noprofile', status: 'ACTIVE', isActive: true, deletedAt: null },
    ];
    const profile = (userId: string, over: Record<string, unknown> = {}) => ({
      id: `pp-${userId}`,
      userId,
      status: 'ACTIVE',
      onboardingState: 'ACCEPTED',
      standingState: 'GOOD',
      verificationState: 'VERIFIED',
      ...over,
    });
    const profiles = [
      profile('u-ok'),
      profile('u-acct'),
      profile('u-restricted', { standingState: 'RESTRICTED' }),
      profile('u-nogrant'),
      profile('u-unverified', { verificationState: 'PENDING' }),
    ];
    const grants = ['pp-u-ok', 'pp-u-acct', 'pp-u-restricted', 'pp-u-unverified'];

    function client() {
      return {
        user: {
          findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
            accounts.filter((a) => where.id.in.includes(a.id)),
          ),
        },
        providerProfile: {
          findMany: jest.fn(async ({ where }: { where: { userId: { in: string[] } } }) =>
            profiles.filter((p) => where.userId.in.includes(p.userId)),
          ),
        },
        providerWorkAccessGrant: {
          findMany: jest.fn(async ({ where }: { where: { providerProfileId: { in: string[] } } }) =>
            grants
              .filter((g) => where.providerProfileId.in.includes(g))
              .map((providerProfileId) => ({ providerProfileId })),
          ),
        },
      };
    }

    it('answers what the single decision answers, in three reads for the whole page', async () => {
      const db = client();
      const svc = service({ work: true, verification: true }, db);
      const ids = accounts.map((a) => a.id);
      const holders = await svc.holdersAmong(
        [...ids, 'u-ok', 'u-missing'],
        ProviderCapability.ViewMarketplace,
      );
      expect([...holders]).toEqual(['u-ok']);
      expect(db.user.findMany).toHaveBeenCalledTimes(1);
      expect(db.providerProfile.findMany).toHaveBeenCalledTimes(1);
      expect(db.providerWorkAccessGrant.findMany).toHaveBeenCalledTimes(1);
      // The ineligible account's profile is never read (rank 0 first).
      expect(db.providerProfile.findMany.mock.calls[0][0].where.userId.in).not.toContain('u-acct');

      // Row by row, through for(), the same answer.
      for (const id of ids) {
        const single = service(
          { work: true, verification: true },
          {
            user: { findUnique: async () => accounts.find((a) => a.id === id) ?? null },
            providerProfile: {
              findFirst: async () => profiles.find((p) => p.userId === id) ?? null,
            },
            providerWorkAccessGrant: {
              findFirst: async ({ where }: { where: { providerProfileId: string } }) =>
                grants.includes(where.providerProfileId) ? { id: 'g' } : null,
            },
          },
        );
        expect(await single.can(id, ProviderCapability.ViewMarketplace)).toBe(holders.has(id));
      }
    });

    it('with the work-access flag off, the legacy status decides rank 7, as for()', async () => {
      const holders = await service({ work: false, verification: false }, client()).holdersAmong(
        accounts.map((a) => a.id),
        ProviderCapability.ViewMarketplace,
      );
      // No grant needed, verification not enforced; account and standing still are.
      expect([...holders].sort()).toEqual(['u-nogrant', 'u-ok', 'u-unverified']);
    });

    it('reads nothing for an empty page', async () => {
      const db = client();
      expect(
        await service({ work: true, verification: true }, db).holdersAmong(
          [],
          ProviderCapability.ViewMarketplace,
        ),
      ).toEqual(new Set());
      expect(db.user.findMany).not.toHaveBeenCalled();
    });
  });
});
