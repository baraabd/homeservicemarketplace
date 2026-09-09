import type { ProviderProfileStatus } from '@homeservicemarketplace/database';

import type {
  ProviderProfileRepository,
  ProviderProfileWithCategories,
} from '../../../infrastructure/persistence/bids/provider-profile.repository';
import type { UserRepository } from '../../../infrastructure/persistence/iam/user.repository';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { AuditService } from '../../iam/audit/audit.service';
import { ProviderOnboardingService } from './provider-onboarding.service';

// Phase 4 — the provider-initiated half of the onboarding state machine.
//
//   DRAFT ──submit──▶ PENDING_REVIEW ──withdraw──▶ DRAFT
//
// The defects this pins:
//   - /upgrade used to stamp PENDING_REVIEW directly, so an EMPTY profile
//     entered the admin review queue the instant someone clicked "become a
//     provider" and PENDING_REVIEW stopped meaning "a complete application was
//     submitted".
//   - There was no completeness gate at all, so an application with no
//     headline, no service area, and no categories was reviewable.

const tx: TransactionRunner = {
  run: <T>(fn: (t: undefined) => Promise<T>) => fn(undefined),
} as unknown as TransactionRunner;

function makeProfile(over: Partial<ProviderProfileWithCategories> = {}) {
  return {
    id: 'pp-1',
    userId: 'u-1',
    displayName: 'Ada Lovelace Services',
    initials: 'AL',
    avatarUrl: null,
    ratingAvg: 0,
    reviewCount: 0,
    completedJobs: 0,
    verified: false,
    topPro: false,
    bio: 'I handle residential and light commercial electrical work, including fault finding.',
    headline: 'Certified electrician, 10 years experience',
    phoneNumber: '+46701234567',
    serviceAreaCity: 'Gothenburg',
    serviceAreaCountry: 'Sweden',
    serviceAreaLat: null,
    serviceAreaLng: null,
    serviceAreaRadiusKm: 25,
    availability: 'OFFLINE',
    status: 'DRAFT' as ProviderProfileStatus,
    reviewNotes: null,
    submittedForReviewAt: null,
    reviewedAt: null,
    reviewedByUserId: null,
    rejectionReason: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    deletedAt: null,
    serviceCategories: [
      {
        serviceCategory: {
          id: 'cat-1',
          slug: 'electrical',
          labelEn: 'Electrical',
          labelAr: 'كهرباء',
          icon: 'zap',
        },
      },
    ],
    // Sprint 2 — part of the shared profile include, so it is part of the
    // read-model every provider-profile response is mapped from. The `as
    // unknown as` below casts past the type, which is why omitting it failed
    // at runtime rather than at typecheck.
    categoryApplications: [],
    ...over,
  } as unknown as ProviderProfileWithCategories;
}

function build(
  over: {
    profile?: ProviderProfileWithCategories | null;
    emailVerified?: boolean;
    submitCount?: number;
    withdrawCount?: number;
  } = {},
) {
  const profile = over.profile === undefined ? makeProfile() : over.profile;
  const providers = {
    findByUserIdWithCategories: jest.fn().mockResolvedValue(profile),
    // Reloaded after the transition — reflect the new status so the mapper
    // returns what the client would actually receive.
    findByIdWithCategories: jest
      .fn()
      .mockResolvedValue(profile ? makeProfile({ ...profile, status: 'PENDING_REVIEW' }) : null),
    submitForReviewIfDraft: jest.fn().mockResolvedValue(over.submitCount ?? 1),
    withdrawFromReviewIfPending: jest.fn().mockResolvedValue(over.withdrawCount ?? 1),
  } as unknown as ProviderProfileRepository;

  const users = {
    findById: jest.fn().mockResolvedValue({
      id: 'u-1',
      emailVerifiedAt: (over.emailVerified ?? true) ? new Date('2026-08-01T00:00:00Z') : null,
    }),
  } as unknown as UserRepository;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return {
    providers,
    users,
    audit,
    service: new ProviderOnboardingService(providers, users, audit, tx),
  };
}

describe('ProviderOnboardingService', () => {
  describe('getStatus', () => {
    it('reports a complete DRAFT profile as submittable and editable', async () => {
      const { service } = build();
      const status = await service.getStatus('u-1');
      expect(status.complete).toBe(true);
      expect(status.missing).toEqual([]);
      expect(status.editable).toBe(true);
      expect(status.submittedForReviewAt).toBeNull();
    });

    it('reports what is missing so the app never re-derives the policy', async () => {
      const { service } = build({
        profile: makeProfile({ headline: null, serviceCategories: [] }),
      });
      const status = await service.getStatus('u-1');
      expect(status.complete).toBe(false);
      expect(status.missing.map((m) => m.field).sort()).toEqual(['headline', 'serviceCategories']);
    });

    it('marks a PENDING_REVIEW profile as NOT editable', async () => {
      const { service } = build({ profile: makeProfile({ status: 'PENDING_REVIEW' }) });
      expect((await service.getStatus('u-1')).editable).toBe(false);
    });

    it('surfaces the rejection reason so the provider is told what to fix', async () => {
      // Provider standing is a different axis from account standing; a
      // REJECTED provider must not be shown a generic account-problem message.
      const { service } = build({
        profile: makeProfile({
          status: 'REJECTED',
          rejectionReason: 'Service area is outside our coverage.',
          reviewedAt: new Date('2026-08-10T00:00:00Z'),
        }),
      });
      const status = await service.getStatus('u-1');
      expect(status.rejectionReason).toBe('Service area is outside our coverage.');
      expect(status.reviewedAt).toBe('2026-08-10T00:00:00.000Z');
    });

    it('404s when the user has no provider profile at all', async () => {
      const { service } = build({ profile: null });
      await expect(service.getStatus('u-1')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('submitForReview', () => {
    it('moves a complete DRAFT to PENDING_REVIEW and audits it', async () => {
      const { service, providers, audit } = build();
      const res = await service.submitForReview('u-1');

      expect(providers.submitForReviewIfDraft).toHaveBeenCalledWith('pp-1', undefined);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PROVIDER_ONBOARDING_SUBMITTED',
          userId: 'u-1',
          metadata: { previousStatus: 'DRAFT', newStatus: 'PENDING_REVIEW' },
        }),
        undefined,
      );
      expect(res.profile.status).toBe('PENDING_REVIEW');
    });

    it('refuses an INCOMPLETE application with 422 + machine-readable codes', async () => {
      const { service, providers } = build({
        profile: makeProfile({ headline: null, serviceAreaCity: null, serviceCategories: [] }),
      });

      await expect(service.submitForReview('u-1')).rejects.toMatchObject({
        status: 422,
        code: 'VALIDATION_ERROR',
        details: {
          missing: expect.arrayContaining([
            { field: 'headline', code: 'REQUIRED' },
            { field: 'serviceAreaCity', code: 'REQUIRED' },
            { field: 'serviceCategories', code: 'REQUIRED' },
          ]),
        },
      });
      // Nothing was written — an incomplete application never reaches the queue.
      expect(providers.submitForReviewIfDraft).not.toHaveBeenCalled();
    });

    it('refuses to submit when the account email is unverified', async () => {
      const { service } = build({ emailVerified: false });
      await expect(service.submitForReview('u-1')).rejects.toMatchObject({
        status: 422,
        details: {
          missing: expect.arrayContaining([{ field: 'emailVerified', code: 'UNVERIFIED' }]),
        },
      });
    });

    it.each([
      ['PENDING_REVIEW', /already being reviewed/i],
      ['ACTIVE', /already approved/i],
      ['SUSPENDED', /suspended/i],
      ['REJECTED', /rejected/i],
    ] as Array<[ProviderProfileStatus, RegExp]>)(
      'refuses to submit from %s with an ACTIONABLE message',
      async (status, message) => {
        // "Not submittable" tells the provider nothing; the message has to say
        // which state they are actually in.
        const { service, providers } = build({ profile: makeProfile({ status }) });
        await expect(service.submitForReview('u-1')).rejects.toMatchObject({
          status: 409,
          message: expect.stringMatching(message),
        });
        expect(providers.submitForReviewIfDraft).not.toHaveBeenCalled();
      },
    );

    it('409s when a concurrent write moved the profile out of DRAFT first', async () => {
      // The status-scoped UPDATE reports 0 rows moved — someone else won.
      const { service } = build({ submitCount: 0 });
      await expect(service.submitForReview('u-1')).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('withdrawFromReview', () => {
    it('returns a queued application to DRAFT', async () => {
      const { service, providers } = build({ profile: makeProfile({ status: 'PENDING_REVIEW' }) });
      await service.withdrawFromReview('u-1');
      expect(providers.withdrawFromReviewIfPending).toHaveBeenCalledWith('pp-1', undefined);
    });

    it.each(['DRAFT', 'ACTIVE', 'SUSPENDED', 'REJECTED'] as ProviderProfileStatus[])(
      'refuses to withdraw from %s',
      async (status) => {
        const { service, providers } = build({ profile: makeProfile({ status }) });
        await expect(service.withdrawFromReview('u-1')).rejects.toMatchObject({ status: 409 });
        expect(providers.withdrawFromReviewIfPending).not.toHaveBeenCalled();
      },
    );

    it('409s when a reviewer decided the application first', async () => {
      const { service } = build({
        profile: makeProfile({ status: 'PENDING_REVIEW' }),
        withdrawCount: 0,
      });
      await expect(service.withdrawFromReview('u-1')).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('assertEditable', () => {
    it('blocks editing a queued application so a reviewer sees a stable snapshot', () => {
      expect(() => build().service.assertEditable('PENDING_REVIEW')).toThrow();
    });

    it.each(['DRAFT', 'ACTIVE', 'SUSPENDED', 'REJECTED'])('allows editing in %s', (status) => {
      expect(() => build().service.assertEditable(status)).not.toThrow();
    });
  });
});

// ── Sprint 09B.29, Phase 3 — the legacy V1 path had the deadlock too ────────
//
// V2 was given the PENDING/REQUIRED distinction in 9B.18. V1 never was: its
// `toCandidate` supplied no `pendingSpecialtyCount`, so the policy could not
// tell "has not chosen a service" from "chose one and is waiting on us" and
// raised `serviceCategories: REQUIRED` for both. The legacy surface therefore
// told a provider who HAD chosen a specialty to go and choose one, and refused
// a submission they could do nothing to unblock.
//
// This matters because the committed deployment configuration still defaults
// the V2 flag OFF, so V1 is what a production provider actually meets.
//
// A pending application is modelled the way the shared profile include loads
// it: live PENDING rows on `categoryApplications`, with no granted
// `serviceCategories` row until an administrator approves.
describe('V1 — pending specialty moderation does not deadlock the legacy path', () => {
  /** Chose a service; nobody has approved it. */
  const pendingOnly = () =>
    makeProfile({
      serviceCategories: [],
      categoryApplications: [{ serviceCategory: { id: 'cat-1' } }],
    } as unknown as Partial<ProviderProfileWithCategories>);

  /** Chose nothing at all. */
  const nothingChosen = () =>
    makeProfile({
      serviceCategories: [],
      categoryApplications: [],
    } as unknown as Partial<ProviderProfileWithCategories>);

  // 1 — pending specialty permits completion and submission
  it('reports complete and allows submission when the only gap is our approval', async () => {
    const h = build({ profile: pendingOnly() });

    const status = await h.service.getStatus('u-1');
    expect(status.complete).toBe(true);
    expect(status.missing).toEqual([]);

    await expect(h.service.submitForReview('u-1')).resolves.toBeDefined();
    expect(h.providers.submitForReviewIfDraft).toHaveBeenCalledTimes(1);
  });

  it('keeps the moderation visible on its own axis rather than dropping it', async () => {
    // The item is not hidden to make `complete` true — it moves to the
    // additive `awaitingReview` field, so a legacy client can still say "your
    // services are with us".
    const status = await build({ profile: pendingOnly() }).service.getStatus('u-1');
    expect(status.awaitingReview).toEqual([
      { field: 'serviceCategories', code: 'AWAITING_REVIEW' },
    ]);
  });

  it('preserves the contract invariant that missing is empty when complete', async () => {
    const status = await build({ profile: pendingOnly() }).service.getStatus('u-1');
    expect(status.complete).toBe(true);
    expect(status.missing).toHaveLength(0);
  });

  // 2 — missing specialty still blocks
  it('still blocks when the provider has chosen nothing', async () => {
    const h = build({ profile: nothingChosen() });

    const status = await h.service.getStatus('u-1');
    expect(status.complete).toBe(false);
    expect(status.missing).toContainEqual({ field: 'serviceCategories', code: 'REQUIRED' });
    // ...and says REQUIRED, not AWAITING_REVIEW: nobody is holding anything.
    expect(status.awaitingReview).toEqual([]);

    await expect(h.service.submitForReview('u-1')).rejects.toMatchObject({ status: 422 });
    expect(h.providers.submitForReviewIfDraft).not.toHaveBeenCalled();
  });

  // 3 — a rejected/returned active selection is provider work again
  it('treats a rejected selection as the provider’s move, not as waiting', async () => {
    // A REJECTED application is neither granted nor live-pending, so the shared
    // include drops it and the provider is back to having chosen nothing. That
    // is provider work, and it must read as REQUIRED.
    const h = build({ profile: nothingChosen() });
    const status = await h.service.getStatus('u-1');
    expect(status.missing).toContainEqual({ field: 'serviceCategories', code: 'REQUIRED' });
    expect(status.complete).toBe(false);
  });

  // 4 — a historical rejection alongside a granted category does not block
  it('does not let a historical rejection block a provider who holds a category', async () => {
    // The granted row is what counts. The rejected application is history and
    // is not loaded as pending, so it contributes nothing.
    const status = await build({ profile: makeProfile() }).service.getStatus('u-1');
    expect(status.complete).toBe(true);
    expect(status.missing).toEqual([]);
    expect(status.awaitingReview).toEqual([]);
  });

  // 5 — pending moderation grants nothing
  it('grants no category and no activation by allowing the submission', async () => {
    const h = build({ profile: pendingOnly() });
    await h.service.submitForReview('u-1');

    // The only write is the DRAFT → PENDING_REVIEW transition and its audit
    // row. Nothing here approves a category, sets `verified`, or issues a
    // work-access grant — those are the admin review path's to make.
    expect(h.providers.submitForReviewIfDraft).toHaveBeenCalledTimes(1);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PROVIDER_ONBOARDING_SUBMITTED',
        metadata: { previousStatus: 'DRAFT', newStatus: 'PENDING_REVIEW' },
      }),
      undefined,
    );
  });

  // 6 — submission remains idempotent / concurrency-safe
  it('keeps the conditional transition, so a lost race is a 409 not a second application', async () => {
    // `submitForReviewIfDraft` is scoped to DRAFT in its WHERE clause; a second
    // caller sees 0 rows moved. Allowing the submission must not weaken that.
    const h = build({ profile: pendingOnly(), submitCount: 0 });
    await expect(h.service.submitForReview('u-1')).rejects.toMatchObject({ status: 409 });
  });

  it('still refuses from a non-DRAFT state', async () => {
    const h = build({
      profile: makeProfile({
        status: 'PENDING_REVIEW' as never,
        serviceCategories: [],
        categoryApplications: [{ serviceCategory: { id: 'cat-1' } }],
      } as unknown as Partial<ProviderProfileWithCategories>),
    });
    await expect(h.service.submitForReview('u-1')).rejects.toMatchObject({ status: 409 });
  });

  // 7 — legacy response fields remain compatible
  it('keeps every pre-existing response field, adding one rather than changing shape', async () => {
    const status = await build({ profile: pendingOnly() }).service.getStatus('u-1');
    expect(Object.keys(status).sort()).toEqual(
      [
        'awaitingReview',
        'complete',
        'editable',
        'missing',
        'reviewedAt',
        'rejectionReason',
        'submittedForReviewAt',
      ].sort(),
    );
    expect(typeof status.complete).toBe('boolean');
    expect(Array.isArray(status.missing)).toBe(true);
    expect(Array.isArray(status.awaitingReview)).toBe(true);
    expect(status.editable).toBe(true);
  });

  it('still blocks on a provider-actionable field while moderation is pending', async () => {
    // The guard: allowing the submission above must not let a genuine gap
    // through, and the refusal must name the field rather than the queue.
    const h = build({
      profile: makeProfile({
        bio: null,
        serviceCategories: [],
        categoryApplications: [{ serviceCategory: { id: 'cat-1' } }],
      } as unknown as Partial<ProviderProfileWithCategories>),
    });

    const status = await h.service.getStatus('u-1');
    expect(status.complete).toBe(false);
    expect(status.missing.map((m) => m.field)).toContain('bio');
    expect(status.missing.map((m) => m.code)).not.toContain('AWAITING_REVIEW');

    await expect(h.service.submitForReview('u-1')).rejects.toMatchObject({
      status: 422,
      details: { missing: expect.arrayContaining([{ field: 'bio', code: 'REQUIRED' }]) },
    });
  });
});
