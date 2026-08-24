import { Prisma } from '@homeservicemarketplace/database';
import {
  ProviderCapability,
  ProviderCapabilityDenialReason,
} from '@homeservicemarketplace/contracts';

import { ProviderCapabilityService } from '../capability/provider-capability.service';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 9 — FAILING REGRESSION TESTS, written before any implementation.
//
// These encode the three claims the sprint is predicated on. Every one of them
// FAILS against the pre-Sprint-9 tree, and that is the point: they are the
// executable statement of the defect, not a description of it.
//
//   1. There is no verification-evidence data model at all.
//   2. An approved provider holds full work capabilities having shown NO
//      evidence — approval and identity verification are the same fact today,
//      which is precisely the conflation ADR 0005 exists to undo.
//   3. Restricted-visibility media has nowhere to live, so identity documents
//      could only be stored on the PUBLIC request-media path.
//
// docs/sprint-09/INSPECTION.md records how each was confirmed.
// ─────────────────────────────────────────────────────────────────────────────

const MODELS = new Set(Prisma.dmmf.datamodel.models.map((m) => m.name));
const ENUMS = new Map(
  Prisma.dmmf.datamodel.enums.map((e) => [e.name, e.values.map((v) => v.name)] as const),
);

describe('Sprint 9 regression — the verification evidence model does not exist', () => {
  // The reviewer-facing case, the restricted evidence attached to it, and the
  // decision recorded against it are three different lifetimes: a case
  // outlives its documents (retention), and a decision must outlive both
  // (audit). One table cannot express that, so all three must exist.
  it.each([
    ['VerificationCase', 'the per-provider review case'],
    ['VerificationDocument', 'restricted identity evidence attached to a case'],
    ['VerificationDecision', 'an immutable reviewer decision on a case'],
  ])('defines %s — %s', (model) => {
    expect(MODELS.has(model)).toBe(true);
  });

  it('defines a generic MediaAsset so evidence is not stored as a bare URL', () => {
    // Today request media is a string in ServiceRequest.mediaUrls[]. A URL
    // cannot carry a scan state, a hash, a retention date, or a visibility —
    // and without those, "restricted" has no representation.
    expect(MODELS.has('MediaAsset')).toBe(true);
  });

  it('gives MediaAsset a RESTRICTED visibility distinct from PUBLIC and PRIVATE', () => {
    // PRIVATE is "not listed publicly". RESTRICTED is "identity evidence:
    // reviewer-permission gated, short-lived reads, access-audited". Folding
    // the two loses the distinction the whole threat model rests on.
    const visibility = ENUMS.get('MediaVisibility');
    expect(visibility).toBeDefined();
    expect(visibility).toEqual(expect.arrayContaining(['PUBLIC', 'PRIVATE', 'RESTRICTED']));
  });

  it('records a scan state so an unscanned document cannot be served', () => {
    const scan = ENUMS.get('MediaScanState');
    expect(scan).toBeDefined();
    // QUARANTINED is the one that matters: a file that failed a scan must be
    // representable as "held, not deleted", or the evidence of an attack is
    // destroyed by the response to it.
    expect(scan).toEqual(expect.arrayContaining(['PENDING', 'CLEAN', 'QUARANTINED']));
  });

  it('versions verification requirements rather than hardcoding production rules', () => {
    // Requirements differ by country, provider type and category, and they
    // change. A pending case must be judged under the policy in force when it
    // was submitted — the same guarantee ProviderOnboardingSubmission already
    // makes for onboarding.
    expect(MODELS.has('VerificationRequirementPolicy')).toBe(true);
  });

  it('stamps a case with the policy version it was submitted under', () => {
    const fields = Prisma.dmmf.datamodel.models
      .find((m) => m.name === 'VerificationCase')
      ?.fields.map((f) => f.name);
    expect(fields ?? []).toContain('policyVersion');
  });
});

describe('Sprint 9 regression — approval grants work access with no evidence', () => {
  /** An eligible account. Rank 0 must pass so the later ranks are reachable. */
  const ELIGIBLE = { status: 'ACTIVE', isActive: true, deletedAt: null };

  /** A provider approved under the legacy process: accepted onboarding, good
   *  standing, and — truthfully — never verified. This is every existing row
   *  on the platform (ADR 0007: the backfill writes UNVERIFIED for all of
   *  them, approved ones included). */
  const LEGACY_APPROVED = {
    status: 'ACTIVE',
    onboardingState: 'ACCEPTED',
    standingState: 'GOOD',
    verificationState: 'UNVERIFIED',
    verified: false,
  };

  function makeService(profile: Record<string, unknown> | null, grant: unknown = null) {
    const prisma = {
      client: {
        user: { findUnique: jest.fn().mockResolvedValue(ELIGIBLE) },
        providerProfile: { findFirst: jest.fn().mockResolvedValue(profile) },
        // The grant read Sprint 9 introduces. Returning null models the true
        // state of the platform today: the table exists and is empty.
        providerWorkAccessGrant: { findFirst: jest.fn().mockResolvedValue(grant) },
      },
    } as unknown as PrismaService;
    return new ProviderCapabilityService(prisma);
  }

  it('denies SUBMIT_BID to an approved provider holding no work-access grant', async () => {
    const set = await makeService(LEGACY_APPROVED).for('u-1');

    // Rank 7 is inert pre-Sprint-9, so today this provider is granted the full
    // working set on the strength of status === 'ACTIVE' alone.
    expect(set.allowed).not.toContain(ProviderCapability.SubmitBid);
    expect(set.primaryReason).toBe(ProviderCapabilityDenialReason.NoWorkAccess);
  });

  it.each([
    ProviderCapability.SubmitBid,
    ProviderCapability.ManageBookings,
    ProviderCapability.ViewEarnings,
  ])('denies %s without a grant', async (capability) => {
    const set = await makeService(LEGACY_APPROVED).for('u-1');
    expect(set.allowed).not.toContain(capability);
  });

  it('never derives work access from the verified display flag', async () => {
    // `verified` is a badge. ADR 0005 forbids it being an authorization input,
    // and the badge itself must be earned by a decision, not by a column
    // someone can set from an admin form.
    const set = await makeService({ ...LEGACY_APPROVED, verified: true }).for('u-1');
    expect(set.allowed).not.toContain(ProviderCapability.SubmitBid);
  });

  it('grants the working set once a live grant exists', async () => {
    // The other half of the contract: arming rank 7 must not lock out a
    // provider who HAS been granted access. A test that only proves denial
    // would be satisfied by a service that denies everyone.
    const live = {
      id: 'g-1',
      status: 'ACTIVE',
      revokedAt: null,
      grantedAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: null,
    };
    const set = await makeService({ ...LEGACY_APPROVED, verificationState: 'VERIFIED' }, live).for(
      'u-1',
    );

    expect(set.allowed).toContain(ProviderCapability.SubmitBid);
    expect(set.allowed).toContain(ProviderCapability.ViewMarketplace);
  });
});
