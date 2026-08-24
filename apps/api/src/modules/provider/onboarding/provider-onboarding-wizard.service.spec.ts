import { ValidationPipe } from '@nestjs/common';
import type { PatchOnboardingStepRequest } from '@homeservicemarketplace/contracts';

import { PatchOnboardingStepDto } from './dto/patch-onboarding-step.dto';
import type {
  ProviderProfileRepository,
  ProviderProfileWithCategories,
} from '../../../infrastructure/persistence/bids/provider-profile.repository';
import type { ProviderCategoryApplicationRepository } from '../../../infrastructure/persistence/services/provider-category-application.repository';
import type { ServiceCategoryRepository } from '../../../infrastructure/persistence/services/service-category.repository';
import type { PlatformSettingRepository } from '../../../infrastructure/persistence/settings/platform-setting.repository';
import type { UserRepository } from '../../../infrastructure/persistence/iam/user.repository';
import type { ProviderOnboardingDraftRepository } from '../../../infrastructure/persistence/provider/provider-onboarding-draft.repository';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { AuditService } from '../../iam/audit/audit.service';
import { AppError } from '../../../shared/errors/app-error';
import { ProviderOnboardingWizardService } from './provider-onboarding-wizard.service';

// Sprint 8 — the onboarding wizard.
//
// THE INVARIANT THIS FILE EXISTS FOR
//
// A valid submission moves the application to DOCUMENTS_REQUIRED and grants
// NOTHING. Five separate things must stay false, and they are asserted
// separately on purpose: one "submission does not activate the provider" test
// would keep passing while any single one of them broke.
//
// Everything else here is the machinery that makes the wizard honest —
// server-computed progress, optimistic concurrency, per-step field isolation,
// and the category-approval boundary the hierarchy could have eroded.

const LIVE_CONSENT_VERSION = 'v3';

/** A profile that satisfies every completeness rule, so a test can break
 *  exactly one thing and know that is what failed. */
function makeCompleteProfile(
  over: Partial<ProviderProfileWithCategories> = {},
): ProviderProfileWithCategories {
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
    serviceAreaCityKey: 'gothenburg',
    serviceAreaLat: null,
    serviceAreaLng: null,
    serviceAreaRadiusKm: 25,
    availability: 'OFFLINE',
    status: 'DRAFT',
    reviewNotes: null,
    submittedForReviewAt: null,
    reviewedAt: null,
    reviewedByUserId: null,
    rejectionReason: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    deletedAt: null,

    onboardingState: 'DRAFT',
    verificationState: null,
    standingState: null,
    subscriptionTier: null,
    lifecycleSource: null,
    lifecycleSyncedAt: null,

    providerType: 'INDIVIDUAL',
    legalBusinessName: null,
    phoneVerifiedAt: new Date('2026-08-02T00:00:00Z'),
    profileImageUrl: 'https://cdn.example.test/ada.jpg',
    yearsOfExperience: 10,
    professionSince: null,
    transportMode: 'VAN',
    workshopAddressLine: null,
    workshopLat: null,
    workshopLng: null,
    additionalInformation: null,
    acceptedConsentVersion: LIVE_CONSENT_VERSION,
    consentAcceptedAt: new Date('2026-08-03T00:00:00Z'),

    serviceCategories: [
      {
        serviceCategoryId: 'cat-leaf-1',
        serviceCategory: {
          id: 'cat-leaf-1',
          slug: 'electrical-faults',
          labelEn: 'Fault finding',
          labelAr: 'كشف الأعطال',
          icon: 'zap',
          parentId: 'cat-root-1',
          isLeaf: true,
          isActive: true,
        },
      },
    ],
    categoryApplications: [],
    ...over,
  } as unknown as ProviderProfileWithCategories;
}

interface Harness {
  service: ProviderOnboardingWizardService;
  providers: jest.Mocked<Pick<ProviderProfileRepository, 'findByUserIdWithCategories'>>;
  drafts: Record<string, jest.Mock>;
  categories: Record<string, jest.Mock>;
  audit: { record: jest.Mock };
  trx: {
    providerProfile: { update: jest.Mock; updateMany: jest.Mock };
    providerOnboardingSubmission: { create: jest.Mock };
    providerCategoryApplication: { create: jest.Mock };
    providerWorkAccessGrant: { create: jest.Mock };
  };
}

function build(
  over: {
    profile?: ProviderProfileWithCategories | null;
    emailVerified?: boolean;
    draft?: { version: number; policyVersion: string; lastSavedAt: Date; data: unknown } | null;
    intervals?: {
      id: string;
      dayOfWeek: number;
      startMinute: number;
      endMinute: number;
      timezone: string;
    }[];
    advanceCount?: number;
    categories?: { id: string; isLeaf: boolean; isActive: boolean }[];
  } = {},
): Harness {
  const profile = over.profile === undefined ? makeCompleteProfile() : over.profile;
  const intervals = over.intervals ?? [
    { id: 'iv-1', dayOfWeek: 1, startMinute: 540, endMinute: 1020, timezone: 'Europe/Stockholm' },
  ];
  const draft =
    over.draft === undefined
      ? {
          version: 3,
          policyVersion: 'sprint-08',
          lastSavedAt: new Date('2026-08-20T12:00:00Z'),
          data: {},
        }
      : over.draft;

  const trx = {
    providerProfile: {
      update: jest.fn().mockResolvedValue(profile),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    providerOnboardingSubmission: { create: jest.fn().mockResolvedValue({ id: 'sub-1' }) },
    providerCategoryApplication: { create: jest.fn().mockResolvedValue({ id: 'app-1' }) },
    // Present but never expected to be called. Sprint 9 issues grants; a
    // Sprint 8 submission that wrote one would be the exact bug this file
    // exists to prevent, so the mock is here so the test can PROVE it stayed
    // untouched rather than merely not crashing.
    providerWorkAccessGrant: { create: jest.fn() },
  };

  const providers = {
    findByUserIdWithCategories: jest.fn().mockResolvedValue(profile),
  } as unknown as jest.Mocked<Pick<ProviderProfileRepository, 'findByUserIdWithCategories'>>;

  const drafts = {
    ensure: jest.fn().mockResolvedValue(draft),
    findByProfileId: jest.fn().mockResolvedValue(draft),
    advanceIfVersion: jest.fn().mockResolvedValue(over.advanceCount ?? 1),
    loadRelations: jest.fn().mockResolvedValue({
      availabilityIntervals: intervals,
      equipment: [],
      serviceAreas: [],
      onboardingDraft: draft,
    }),
    replaceAvailability: jest.fn().mockResolvedValue(undefined),
    replaceEquipment: jest.fn().mockResolvedValue(undefined),
    replaceServiceAreas: jest.fn().mockResolvedValue(undefined),
    findEquipmentByCodes: jest.fn().mockResolvedValue([]),
    findPlaces: jest.fn().mockResolvedValue({ cityIds: [], districtIds: [], neighborhoodIds: [] }),
  };

  const categories = {
    findManyActiveByIds: jest
      .fn()
      .mockImplementation((ids: string[]) =>
        Promise.resolve(
          (over.categories ?? [{ id: 'cat-leaf-2', isLeaf: true, isActive: true }]).filter((c) =>
            ids.includes(c.id),
          ),
        ),
      ),
    listRoots: jest.fn().mockResolvedValue([]),
    listLeavesByParents: jest.fn().mockResolvedValue([]),
  };

  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new ProviderOnboardingWizardService(
    providers as unknown as ProviderProfileRepository,
    drafts as unknown as ProviderOnboardingDraftRepository,
    categories as unknown as ServiceCategoryRepository,
    {} as unknown as ProviderCategoryApplicationRepository,
    {
      findById: jest
        .fn()
        .mockResolvedValue({ emailVerifiedAt: over.emailVerified === false ? null : new Date() }),
    } as unknown as UserRepository,
    {
      findByKey: jest.fn().mockImplementation((key: string) => {
        if (key === 'provider_consent_policy_version') {
          return Promise.resolve({ key, value: LIVE_CONSENT_VERSION });
        }
        return Promise.resolve(null);
      }),
    } as unknown as PlatformSettingRepository,
    audit as unknown as AuditService,
    { run: <T>(fn: (t: unknown) => Promise<T>) => fn(trx) } as unknown as TransactionRunner,
  );

  return { service, providers, drafts, categories, audit, trx };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBMISSION GRANTS NOTHING
//
// Five assertions, five tests. One combined test would keep passing while any
// single one of them broke.
// ─────────────────────────────────────────────────────────────────────────────
describe('submit — the transition, and what it must not do', () => {
  it('moves a complete application to DOCUMENTS_REQUIRED', async () => {
    const h = build();
    await h.service.submit('u-1', { version: 3 });

    expect(h.trx.providerProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ onboardingState: 'DOCUMENTS_REQUIRED' }),
      }),
    );
  });

  it('does NOT set the legacy status to ACTIVE', async () => {
    // PENDING_REVIEW so the existing admin queue still sees the application.
    // ACTIVE would activate the provider, which is the whole thing this
    // transition must not do.
    const h = build();
    await h.service.submit('u-1', { version: 3 });

    const data = h.trx.providerProfile.update.mock.calls[0][0].data;
    expect(data.status).toBe('PENDING_REVIEW');
    expect(data.status).not.toBe('ACTIVE');
  });

  it('does NOT set the verified badge', async () => {
    const h = build();
    await h.service.submit('u-1', { version: 3 });

    expect(h.trx.providerProfile.update.mock.calls[0][0].data).not.toHaveProperty('verified');
  });

  it('does NOT touch the verification axis', async () => {
    // Identity is still unchecked. Recording otherwise invents an audit trail.
    const h = build();
    await h.service.submit('u-1', { version: 3 });

    expect(h.trx.providerProfile.update.mock.calls[0][0].data).not.toHaveProperty(
      'verificationState',
    );
  });

  it('does NOT write a work-access grant', async () => {
    // Sprint 9 issues grants. A grant written here would give a provider whose
    // documents have not been seen the right to work.
    const h = build();
    await h.service.submit('u-1', { version: 3 });

    expect(h.trx.providerWorkAccessGrant.create).not.toHaveBeenCalled();
  });

  it('records in the audit trail, explicitly, that it granted nothing', async () => {
    // Written out rather than left as an absence: a reader six months from now
    // should not have to infer what the transition did not do.
    const h = build();
    await h.service.submit('u-1', { version: 3 });

    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PROVIDER_ONBOARDING_SUBMITTED',
        metadata: expect.objectContaining({
          newState: 'DOCUMENTS_REQUIRED',
          grantsWorkAccess: false,
          grantsVerifiedBadge: false,
        }),
      }),
      expect.anything(),
    );
  });
});

describe('submit — completeness and idempotency', () => {
  it('refuses an incomplete application with 422 and machine-readable codes', async () => {
    const h = build({ profile: makeCompleteProfile({ bio: null }) });

    await expect(h.service.submit('u-1', { version: 3 })).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
      details: { missing: expect.arrayContaining([{ field: 'bio', code: 'REQUIRED' }]) },
    });
    expect(h.trx.providerProfile.update).not.toHaveBeenCalled();
  });

  it('refuses when the phone is present but UNVERIFIED', async () => {
    // A number nobody proved they control is a contact method that does not
    // work, and it is the channel a seeker uses when a provider is late.
    const h = build({ profile: makeCompleteProfile({ phoneVerifiedAt: null }) });

    await expect(h.service.submit('u-1', { version: 3 })).rejects.toMatchObject({
      status: 422,
      details: {
        missing: expect.arrayContaining([{ field: 'phoneNumber', code: 'NOT_VERIFIED' }]),
      },
    });
  });

  it('refuses when no weekly availability has been recorded', async () => {
    const h = build({ intervals: [] });

    await expect(h.service.submit('u-1', { version: 3 })).rejects.toMatchObject({
      status: 422,
      details: { missing: expect.arrayContaining([{ field: 'availability', code: 'REQUIRED' }]) },
    });
  });

  it('refuses when only a PENDING specialty application exists', async () => {
    // A pending application is a request, not a competency. Counting it would
    // let a provider submit a complete application built on skills nobody has
    // agreed they have.
    const h = build({
      profile: makeCompleteProfile({
        serviceCategories: [],
        categoryApplications: [{ serviceCategory: { id: 'cat-leaf-9' } }],
      } as unknown as Partial<ProviderProfileWithCategories>),
    });

    await expect(h.service.submit('u-1', { version: 3 })).rejects.toMatchObject({
      status: 422,
      details: { missing: expect.arrayContaining([{ field: 'specialties', code: 'REQUIRED' }]) },
    });
  });

  it('is idempotent: re-submitting does not transition twice', async () => {
    // The ordinary cause of a double submit is a dropped response, not a
    // double click. A second application would put the provider in the queue
    // twice and give a reviewer two rows to reconcile.
    const h = build({
      profile: makeCompleteProfile({ onboardingState: 'DOCUMENTS_REQUIRED' }),
    });

    await h.service.submit('u-1', { version: 3 });

    expect(h.trx.providerProfile.update).not.toHaveBeenCalled();
    expect(h.trx.providerOnboardingSubmission.create).not.toHaveBeenCalled();
  });

  it('is idempotent from SUBMITTED as well', async () => {
    const h = build({ profile: makeCompleteProfile({ onboardingState: 'SUBMITTED' }) });
    await h.service.submit('u-1', { version: 3 });
    expect(h.trx.providerProfile.update).not.toHaveBeenCalled();
  });

  it('refuses to re-submit an ACCEPTED application', async () => {
    const h = build({ profile: makeCompleteProfile({ onboardingState: 'ACCEPTED' }) });
    await expect(h.service.submit('u-1', { version: 3 })).rejects.toMatchObject({ status: 409 });
  });

  it('refuses a submission raised against a stale version', async () => {
    const h = build();
    await expect(h.service.submit('u-1', { version: 1 })).rejects.toMatchObject({ status: 409 });
    expect(h.trx.providerProfile.update).not.toHaveBeenCalled();
  });

  it('snapshots what the policy evaluated, pinned to the policy version', async () => {
    // Without it, a rule added next month makes it impossible to reconstruct
    // why this application was accepted.
    const h = build();
    await h.service.submit('u-1', { version: 3 });

    expect(h.trx.providerOnboardingSubmission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          policyVersion: 'sprint-08',
          snapshot: expect.objectContaining({ displayName: 'Ada Lovelace Services' }),
        }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OPTIMISTIC CONCURRENCY
// ─────────────────────────────────────────────────────────────────────────────
describe('patchStep — concurrency', () => {
  it('accepts a patch at the current version', async () => {
    const h = build();
    await h.service.patchStep('u-1', 'PROFILE', { version: 3, bio: 'A new bio, long enough.' });

    expect(h.drafts.advanceIfVersion).toHaveBeenCalledWith(
      'pp-1',
      3,
      expect.anything(),
      expect.anything(),
    );
  });

  it('rejects a stale version with 409 rather than overwriting', async () => {
    // Two tabs on one wizard is the ordinary case. Without this the failure
    // mode is a provider watching half their answers disappear with no error.
    const h = build();

    await expect(
      h.service.patchStep('u-1', 'PROFILE', { version: 1, bio: 'Overwrite attempt.' }),
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(h.drafts.advanceIfVersion).not.toHaveBeenCalled();
  });

  it('attaches the server current state to the conflict', async () => {
    // A bare "conflict" leaves the client with a stale form and no way to
    // reconcile.
    const h = build();

    const error = await h.service
      .patchStep('u-1', 'PROFILE', { version: 1, bio: 'x' })
      .catch((e: AppError) => e);

    expect((error as AppError).details).toMatchObject({
      expectedVersion: 3,
      receivedVersion: 1,
      current: expect.objectContaining({ version: 3 }),
    });
  });

  it('rejects when the write loses a race it passed the pre-check for', async () => {
    // The pre-check is for a fast, informative failure. THIS is the one that
    // is actually correct: the version lives in the UPDATE's WHERE clause, so
    // two concurrent patches cannot both pass a read-then-compare.
    const h = build({ advanceCount: 0 });

    await expect(
      h.service.patchStep('u-1', 'PROFILE', { version: 3, bio: 'Racing write.' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PER-STEP FIELD ISOLATION
// ─────────────────────────────────────────────────────────────────────────────
describe('patchStep — a step may only write its own fields', () => {
  it('rejects a field belonging to another step', async () => {
    // Without this the per-step surface is decorative: the autosave of a
    // half-finished LOCATION step could clear a completed CONSENT.
    const h = build();

    await expect(
      h.service.patchStep('u-1', 'LOCATION', {
        version: 3,
        acceptedConsentVersion: LIVE_CONSENT_VERSION,
      }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('names the offending fields', async () => {
    const h = build();
    const error = await h.service
      .patchStep('u-1', 'PROFILE', { version: 3, providerType: 'BUSINESS' })
      .catch((e: AppError) => e);

    expect((error as AppError).message).toContain('providerType');
  });

  it('rejects any write to REVIEW, which collects nothing', async () => {
    const h = build();
    await expect(
      h.service.patchStep('u-1', 'REVIEW', { version: 3, bio: 'sneaking a write in' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses to open a transaction for a mis-addressed patch', async () => {
    // A wrong field on the wrong step is a client bug, and a transaction is a
    // lock. Rejecting before opening one keeps a buggy client from holding
    // row locks on every autosave.
    const h = build();
    await h.service
      .patchStep('u-1', 'PROFILE', { version: 3, providerType: 'BUSINESS' })
      .catch(() => undefined);

    expect(h.providers.findByUserIdWithCategories).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE CATEGORY-APPROVAL BOUNDARY
// ─────────────────────────────────────────────────────────────────────────────
describe('patchStep — SPECIALTIES never grants a category', () => {
  it('turns a requested leaf into a PENDING application, not a grant', async () => {
    const h = build({ categories: [{ id: 'cat-leaf-2', isLeaf: true, isActive: true }] });

    await h.service.patchStep('u-1', 'SPECIALTIES', {
      version: 3,
      specialtyLeafIds: ['cat-leaf-2'],
    });

    expect(h.trx.providerCategoryApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ serviceCategoryId: 'cat-leaf-2', status: 'PENDING' }),
      }),
    );
  });

  it('rejects a PARENT group selected as a specialty', async () => {
    // The bypass the hierarchy could have created. Selectability is read from
    // the stored isLeaf flag, never inferred from having no children.
    const h = build({ categories: [{ id: 'cat-root-1', isLeaf: false, isActive: true }] });

    await expect(
      h.service.patchStep('u-1', 'SPECIALTIES', { version: 3, specialtyLeafIds: ['cat-root-1'] }),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.trx.providerCategoryApplication.create).not.toHaveBeenCalled();
  });

  it('rejects an inactive or unknown category', async () => {
    const h = build({ categories: [] });

    await expect(
      h.service.patchStep('u-1', 'SPECIALTIES', { version: 3, specialtyLeafIds: ['cat-gone'] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('does not re-apply for a leaf the provider already holds', async () => {
    // A duplicate application is a second admin decision on a question already
    // answered, and it puts two identical chips on the provider's screen.
    const h = build({ categories: [{ id: 'cat-leaf-1', isLeaf: true, isActive: true }] });

    await h.service.patchStep('u-1', 'SPECIALTIES', {
      version: 3,
      specialtyLeafIds: ['cat-leaf-1'],
    });

    expect(h.trx.providerCategoryApplication.create).not.toHaveBeenCalled();
  });

  it('does not re-apply for a leaf already awaiting a decision', async () => {
    const h = build({
      profile: makeCompleteProfile({
        categoryApplications: [{ serviceCategory: { id: 'cat-leaf-2' } }],
      } as unknown as Partial<ProviderProfileWithCategories>),
      categories: [{ id: 'cat-leaf-2', isLeaf: true, isActive: true }],
    });

    await h.service.patchStep('u-1', 'SPECIALTIES', {
      version: 3,
      specialtyLeafIds: ['cat-leaf-2'],
    });

    expect(h.trx.providerCategoryApplication.create).not.toHaveBeenCalled();
  });

  it('stores ticked parent GROUPS as intent, granting nothing', async () => {
    // Ticking "Plumbing" says "I work in plumbing". It has no authorization
    // consequence, which is why it has no grant table row to live in.
    const h = build({ categories: [{ id: 'cat-root-1', isLeaf: false, isActive: true }] });

    await h.service.patchStep('u-1', 'SPECIALTIES', {
      version: 3,
      primaryGroupIds: ['cat-root-1'],
    });

    expect(h.trx.providerCategoryApplication.create).not.toHaveBeenCalled();
    expect(h.drafts.advanceIfVersion).toHaveBeenCalledWith(
      'pp-1',
      3,
      expect.objectContaining({
        data: expect.objectContaining({ primaryGroupIds: ['cat-root-1'] }),
      }),
      expect.anything(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IDENTITY, AVAILABILITY, CONSENT
// ─────────────────────────────────────────────────────────────────────────────
describe('patchStep — IDENTITY', () => {
  it('invalidates phone verification when the number changes', async () => {
    // Keeping the old proof against a new number is how an unverifiable number
    // ends up marked verified. The single most valuable thing to get wrong on
    // this screen.
    const h = build();
    await h.service.patchStep('u-1', 'IDENTITY', { version: 3, phoneNumber: '+46709999999' });

    expect(h.trx.providerProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phoneNumber: '+46709999999', phoneVerifiedAt: null }),
      }),
    );
  });

  it('keeps verification when the number is re-sent unchanged', async () => {
    // Autosave re-sends the whole screen. Clearing verification on every
    // keystroke elsewhere would make the phone permanently unverifiable.
    const h = build();
    await h.service.patchStep('u-1', 'IDENTITY', { version: 3, phoneNumber: '+46701234567' });

    const data = h.trx.providerProfile.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('phoneVerifiedAt');
  });

  it('refuses to clear the display name', async () => {
    // The column is NOT NULL, so a cleared value would surface as a Prisma
    // error the client cannot act on.
    const h = build();
    await expect(
      h.service.patchStep('u-1', 'IDENTITY', { version: 3, displayName: '   ' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('patchStep — AVAILABILITY', () => {
  it('rejects overlapping windows with indexed detail', async () => {
    const h = build();

    const error = await h.service
      .patchStep('u-1', 'AVAILABILITY', {
        version: 3,
        timezone: 'Europe/Stockholm',
        availability: [
          { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
          { dayOfWeek: 1, startMinute: 600, endMinute: 780 },
        ],
      })
      .catch((e: AppError) => e);

    expect((error as AppError).status).toBe(422);
    expect((error as AppError).details).toMatchObject({
      availability: [{ code: 'OVERLAP', index: 1, conflictsWith: 0 }],
    });
  });

  it('rejects an unresolvable timezone', async () => {
    // Shape cannot distinguish Asia/Damascus from Asia/Damascusx. Storing the
    // latter turns every future time calculation into a throw.
    const h = build();
    await expect(
      h.service.patchStep('u-1', 'AVAILABILITY', {
        version: 3,
        timezone: 'Europe/Nowhere',
        availability: [{ dayOfWeek: 1, startMinute: 540, endMinute: 720 }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses hours with no timezone to record them in', async () => {
    const h = build({ intervals: [] });
    await expect(
      h.service.patchStep('u-1', 'AVAILABILITY', {
        version: 3,
        availability: [{ dayOfWeek: 1, startMinute: 540, endMinute: 720 }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('re-stamps the existing week when only the timezone changes', async () => {
    // Leaving old intervals on the old zone would silently split one schedule
    // across two, which nothing downstream expects.
    const h = build();
    await h.service.patchStep('u-1', 'AVAILABILITY', { version: 3, timezone: 'Asia/Damascus' });

    expect(h.drafts.replaceAvailability).toHaveBeenCalledWith(
      'pp-1',
      [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020, timezone: 'Asia/Damascus' }],
      expect.anything(),
    );
  });

  it('accepts a legal week', async () => {
    const h = build();
    await h.service.patchStep('u-1', 'AVAILABILITY', {
      version: 3,
      timezone: 'Europe/Stockholm',
      availability: [
        { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
        { dayOfWeek: 1, startMinute: 720, endMinute: 1020 },
      ],
    });

    expect(h.drafts.replaceAvailability).toHaveBeenCalled();
  });
});

describe('patchStep — CONSENT', () => {
  it('records the version AND the timestamp together', async () => {
    // A boolean "agreed" is unfalsifiable the moment the terms change, and the
    // database CHECK requires the pair to agree.
    const h = build({ profile: makeCompleteProfile({ acceptedConsentVersion: null }) });

    await h.service.patchStep('u-1', 'CONSENT', {
      version: 3,
      acceptedConsentVersion: LIVE_CONSENT_VERSION,
    });

    const data = h.trx.providerProfile.update.mock.calls[0][0].data;
    expect(data.acceptedConsentVersion).toBe(LIVE_CONSENT_VERSION);
    expect(data.consentAcceptedAt).toBeInstanceOf(Date);
  });

  it('refuses acceptance of a STALE document version', async () => {
    // Accepting an old document is not consent to the live one. The wizard
    // re-presents; it does not quietly upgrade what the provider agreed to.
    const h = build();

    await expect(
      h.service.patchStep('u-1', 'CONSENT', { version: 3, acceptedConsentVersion: 'v1' }),
    ).rejects.toMatchObject({
      status: 409,
      details: { currentVersion: LIVE_CONSENT_VERSION },
    });
  });

  it('clears BOTH columns when consent is withdrawn', async () => {
    const h = build();
    await h.service.patchStep('u-1', 'CONSENT', { version: 3, acceptedConsentVersion: null });

    const data = h.trx.providerProfile.update.mock.calls[0][0].data;
    expect(data.acceptedConsentVersion).toBeNull();
    expect(data.consentAcceptedAt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE EDIT LOCK AND THE WAY OUT OF IT
// ─────────────────────────────────────────────────────────────────────────────
describe('the edit lock', () => {
  it('blocks edits while the application is in the queue', async () => {
    // Silently reverting a queued application to DRAFT on any edit would make
    // it vanish from the queue without telling anyone, and let someone change
    // what a reviewer is looking at mid-review.
    const h = build({ profile: makeCompleteProfile({ onboardingState: 'SUBMITTED' }) });

    await expect(
      h.service.patchStep('u-1', 'PROFILE', { version: 3, bio: 'Sneaky edit.' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('blocks edits at DOCUMENTS_REQUIRED too', async () => {
    const h = build({ profile: makeCompleteProfile({ onboardingState: 'DOCUMENTS_REQUIRED' }) });
    await expect(
      h.service.patchStep('u-1', 'PROFILE', { version: 3, bio: 'Sneaky edit.' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('withdraws a submitted application back to DRAFT', async () => {
    const h = build({ profile: makeCompleteProfile({ onboardingState: 'DOCUMENTS_REQUIRED' }) });
    await h.service.withdraw('u-1');

    expect(h.trx.providerProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ onboardingState: 'DRAFT', status: 'DRAFT' }),
      }),
    );
  });

  it('scopes the withdrawal so a reviewer who acted first wins', async () => {
    const h = build({ profile: makeCompleteProfile({ onboardingState: 'SUBMITTED' }) });
    h.trx.providerProfile.updateMany.mockResolvedValue({ count: 0 });

    await expect(h.service.withdraw('u-1')).rejects.toMatchObject({ status: 409 });
  });

  it('refuses to withdraw an application that was never submitted', async () => {
    const h = build();
    await expect(h.service.withdraw('u-1')).rejects.toMatchObject({ status: 409 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE READ
// ─────────────────────────────────────────────────────────────────────────────
describe('get', () => {
  it('creates the draft on first read rather than requiring a POST first', async () => {
    const h = build();
    await h.service.get('u-1');

    expect(h.drafts.ensure).toHaveBeenCalledWith(
      'pp-1',
      expect.objectContaining({ currentStep: 'PROVIDER_TYPE', policyVersion: 'sprint-08' }),
    );
  });

  it('reports a complete application as submittable', async () => {
    const view = await build().service.get('u-1');

    expect(view.complete).toBe(true);
    expect(view.missing).toEqual([]);
    expect(view.percentComplete).toBe(100);
    expect(view.nextAction).toEqual({ kind: 'SUBMIT' });
  });

  it('points an incomplete application at the first gap', async () => {
    const h = build({ profile: makeCompleteProfile({ bio: null }) });
    const view = await h.service.get('u-1');

    expect(view.complete).toBe(false);
    expect(view.currentStep).toBe('PROFILE');
    expect(view.nextAction).toEqual({ kind: 'COMPLETE_STEP', step: 'PROFILE' });
  });

  it('echoes the collected data back from the SERVER copy', async () => {
    // The client renders from this rather than from local state a failed
    // autosave may have diverged from.
    const view = await build().service.get('u-1');

    expect(view.data.providerType).toBe('INDIVIDUAL');
    expect(view.data.phoneVerified).toBe(true);
    expect(view.data.availability).toHaveLength(1);
    expect(view.data.timezone).toBe('Europe/Stockholm');
  });

  it('marks a queued application not editable', async () => {
    const h = build({ profile: makeCompleteProfile({ onboardingState: 'DOCUMENTS_REQUIRED' }) });
    const view = await h.service.get('u-1');

    expect(view.editable).toBe(false);
    expect(view.nextAction).toEqual({ kind: 'UPLOAD_DOCUMENTS' });
  });

  it('404s when there is no provider profile', async () => {
    const h = build({ profile: null });
    await expect(h.service.get('u-1')).rejects.toMatchObject({ status: 404 });
  });

  it('reads a legacy row with a NULL onboarding axis from its old status', async () => {
    // ADR 0007 owns this compatibility window. Reading NULL as NOT_STARTED
    // would tell an approved legacy provider they have not begun.
    const h = build({
      profile: makeCompleteProfile({ onboardingState: null, status: 'ACTIVE' }),
    });
    const view = await h.service.get('u-1');

    expect(view.state).toBe('ACCEPTED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION — the per-step guard against a REAL DTO instance.
//
// Every test above passes a plain object literal, which is not what the
// service receives in production. The ValidationPipe hands it a class
// INSTANCE, and TypeScript's class-field semantics define every declared
// property on every instance — as `undefined`. A guard filtering on
// `Object.keys` therefore saw all thirty declared fields on a request that
// sent one, and rejected every PATCH the wizard made.
//
// The whole unit suite passed. The first real PATCH against a booted API
// 400'd. These cases run the actual pipe so the gap cannot reopen.
// ─────────────────────────────────────────────────────────────────────────────
describe('patchStep — against a real ValidationPipe instance', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });

  const asDto = (body: Record<string, unknown>) =>
    pipe.transform(body, {
      type: 'body',
      metatype: PatchOnboardingStepDto,
    }) as Promise<PatchOnboardingStepRequest>;

  it('accepts a single-field patch carried on a full DTO instance', async () => {
    const h = build();
    const body = await asDto({ version: 3, providerType: 'INDIVIDUAL' });

    // The condition that caused the bug, asserted directly: the instance
    // really does carry keys the client never sent.
    expect(Object.keys(body).length).toBeGreaterThan(20);
    expect((body as Record<string, unknown>).bio).toBeUndefined();

    await h.service.patchStep('u-1', 'PROVIDER_TYPE', body);

    expect(h.trx.providerProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ providerType: 'INDIVIDUAL' }) }),
    );
  });

  it('still rejects a field genuinely SENT for another step', async () => {
    // The filter must not blunt the guard. `null` counts as sent — it means
    // "clear this field", which is exactly the kind of cross-step write that
    // would wipe a completed step from a half-finished one.
    const h = build();
    const body = await asDto({ version: 3, providerType: 'INDIVIDUAL', bio: null });

    await expect(h.service.patchStep('u-1', 'PROVIDER_TYPE', body)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('accepts a full week on the AVAILABILITY step', async () => {
    const h = build();
    const body = await asDto({
      version: 3,
      timezone: 'Asia/Damascus',
      availability: [
        { dayOfWeek: 1, startMinute: 540, endMinute: 1020 },
        { dayOfWeek: 2, startMinute: 540, endMinute: 1020 },
      ],
    });

    await h.service.patchStep('u-1', 'AVAILABILITY', body);

    expect(h.drafts.replaceAvailability).toHaveBeenCalled();
  });
});
