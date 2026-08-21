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
