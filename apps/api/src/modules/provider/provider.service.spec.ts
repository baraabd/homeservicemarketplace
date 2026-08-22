import type {
  ProviderProfile,
  Role,
  ServiceCategory,
  User,
} from '@homeservicemarketplace/database';

import type { RoleRepository } from '../../infrastructure/persistence/iam/role.repository';
import type { UserRepository } from '../../infrastructure/persistence/iam/user.repository';
import type {
  ProviderProfileRepository,
  ProviderProfileWithCategories,
} from '../../infrastructure/persistence/bids/provider-profile.repository';
import type { ServiceCategoryRepository } from '../../infrastructure/persistence/services/service-category.repository';
import type { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';
import type { AuditService } from '../iam/audit/audit.service';
import { ProviderService } from './provider.service';

function makeTx(): TransactionRunner {
  return {
    run: <T>(fn: (tx: undefined) => Promise<T>) => fn(undefined),
  } as unknown as TransactionRunner;
}

function makeUser(over: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'ada@example.com',
    passwordHash: null,
    firstName: 'Ada',
    lastName: 'Lovelace',
    isActive: true,
    status: 'ACTIVE',
    emailVerifiedAt: new Date('2026-04-30T00:00:00.000Z'),
    passwordUpdatedAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    mfaEnabled: false,
    mfaSecret: null,
    mfaEnrolledAt: null,
    createdAt: new Date('2026-04-30T00:00:00.000Z'),
    updatedAt: new Date('2026-04-30T00:00:00.000Z'),
    deletedAt: null,
    ...over,
  } as User;
}

function makeProvider(over: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'pp-1',
    userId: 'user-1',
    displayName: 'Ada Lovelace',
    initials: 'AL',
    avatarUrl: null,
    ratingAvg: 0,
    reviewCount: 0,
    completedJobs: 0,
    verified: false,
    topPro: false,
    bio: null,
    headline: null,
    phoneNumber: null,
    serviceAreaCity: null,
    serviceAreaCountry: null,
    serviceAreaLat: null,
    serviceAreaLng: null,
    serviceAreaRadiusKm: null,
    availability: 'OFFLINE',
    status: 'ACTIVE',
    createdAt: new Date('2026-04-30T00:00:00.000Z'),
    updatedAt: new Date('2026-04-30T00:00:00.000Z'),
    deletedAt: null,
    ...over,
  } as ProviderProfile;
}

function makeProviderWithCategories(
  over: Partial<ProviderProfile> = {},
  categories: ServiceCategory[] = [],
  pending: ServiceCategory[] = [],
): ProviderProfileWithCategories {
  const base = makeProvider(over);
  return {
    ...base,
    serviceCategories: categories.map((c) => ({
      providerProfileId: base.id,
      serviceCategoryId: c.id,
      createdAt: new Date('2026-04-30T00:00:00.000Z'),
      serviceCategory: c,
    })),
    // Sprint 2 — the shared profile include eager-loads live PENDING
    // applications so every provider-profile response carries
    // pendingCategories.
    categoryApplications: pending.map((c) => ({ serviceCategory: c })),
  } as ProviderProfileWithCategories;
}

function makeRole(over: Partial<Role> = {}): Role {
  return {
    id: 'role-provider',
    name: 'provider',
    description: null,
    isSystem: true,
    createdAt: new Date('2026-04-30T00:00:00.000Z'),
    updatedAt: new Date('2026-04-30T00:00:00.000Z'),
    deletedAt: null,
    ...over,
  } as Role;
}

function makeCategory(over: Partial<ServiceCategory> = {}): ServiceCategory {
  return {
    id: 'cat-plumbing',
    slug: 'plumbing',
    labelEn: 'Plumbing',
    labelAr: 'سباكة',
    icon: 'wrench',
    sortOrder: 0,
    isActive: true,
    createdAt: new Date('2026-04-30T00:00:00.000Z'),
    updatedAt: new Date('2026-04-30T00:00:00.000Z'),
    deletedAt: null,
    ...over,
  } as ServiceCategory;
}

interface Mocks {
  users: { findById: jest.Mock; assignRole: jest.Mock };
  roles: { findByName: jest.Mock };
  providers: {
    findByUserId: jest.Mock;
    findByUserIdWithCategories: jest.Mock;
    findByIdWithCategories: jest.Mock;
    createForUser: jest.Mock;
    updateById: jest.Mock;
    updateAvailabilityById: jest.Mock;
    removeServiceCategories: jest.Mock;
  };
  categories: { findById: jest.Mock };
  audit: { record: jest.Mock };
}

type MocksOverride = { [K in keyof Mocks]?: Partial<Mocks[K]> };

function makeMocks(over: MocksOverride = {}): Mocks {
  return {
    users: {
      findById: jest.fn().mockResolvedValue(makeUser()),
      assignRole: jest.fn().mockResolvedValue(undefined),
      ...(over.users ?? {}),
    },
    roles: {
      findByName: jest.fn().mockResolvedValue(makeRole()),
      ...(over.roles ?? {}),
    },
    providers: {
      findByUserId: jest.fn().mockResolvedValue(makeProvider()),
      findByUserIdWithCategories: jest.fn().mockResolvedValue(makeProviderWithCategories()),
      findByIdWithCategories: jest.fn().mockResolvedValue(makeProviderWithCategories()),
      createForUser: jest.fn().mockResolvedValue(makeProvider()),
      updateById: jest.fn().mockImplementation((_id, input) => makeProvider(input)),
      updateAvailabilityById: jest
        .fn()
        .mockImplementation((_id, availability) => makeProvider({ availability })),
      removeServiceCategories: jest.fn().mockResolvedValue(0),
      ...(over.providers ?? {}),
    },
    categories: {
      findById: jest.fn().mockResolvedValue(makeCategory()),
      ...(over.categories ?? {}),
    },
    audit: { record: jest.fn().mockResolvedValue(undefined), ...(over.audit ?? {}) },
  };
}

function makeService(m: Mocks) {
  return new ProviderService(
    m.users as unknown as UserRepository,
    m.roles as unknown as RoleRepository,
    m.providers as unknown as ProviderProfileRepository,
    m.categories as unknown as ServiceCategoryRepository,
    makeTx(),
    m.audit as unknown as AuditService,
  );
}

describe('ProviderService', () => {
  // ─── upgrade ─────────────────────────────────────────────────────────────
  describe('upgrade', () => {
    it('creates the provider profile on first call and returns the summary', async () => {
      const m = makeMocks({
        providers: {
          // No existing profile yet — service should create one.
          findByUserIdWithCategories: jest.fn().mockResolvedValue(null),
          createForUser: jest.fn().mockResolvedValue(makeProvider({ status: 'DRAFT' })),
          findByIdWithCategories: jest
            .fn()
            .mockResolvedValue(makeProviderWithCategories({ status: 'DRAFT' })),
        },
      });
      const out = await makeService(m).upgrade('user-1');
      expect(m.users.assignRole).toHaveBeenCalledWith('user-1', 'role-provider', undefined);
      expect(m.providers.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          displayName: 'Ada Lovelace',
          initials: 'AL',
          // Phase 4: a freshly upgraded provider is NEITHER active NOR
          // queued for review. It lands in DRAFT.
          //
          // Two rules are pinned by this one value:
          //   - it must never be ACTIVE, or ProviderActiveGuard becomes a
          //     no-op for every self-upgraded provider (the original defect);
          //   - it must never be PENDING_REVIEW either, or an EMPTY profile
          //     enters the admin review queue the instant someone clicks
          //     "become a provider", and PENDING_REVIEW stops meaning "a
          //     complete application was submitted".
          // Reaching PENDING_REVIEW requires POST /submit-for-review, which
          // enforces the completeness policy first.
          status: 'DRAFT',
        }),
        undefined,
      );
      expect(out.profile.id).toBe('pp-1');
      expect(out.profile.availability).toBe('OFFLINE');
      expect(out.profile.status).toBe('DRAFT');
      // An upgrade is not an application: nothing has been submitted yet.
      expect(out.profile.submittedForReviewAt).toBeNull();
      // Wire fields are ISO strings.
      expect(typeof out.profile.createdAt).toBe('string');
    });

    it('is idempotent — second call returns the existing profile and does NOT recreate', async () => {
      const m = makeMocks({
        providers: {
          findByUserIdWithCategories: jest.fn().mockResolvedValue(makeProviderWithCategories()),
          createForUser: jest.fn(),
        },
      });
      const out = await makeService(m).upgrade('user-1');
      expect(m.users.assignRole).toHaveBeenCalledTimes(1);
      expect(m.providers.createForUser).not.toHaveBeenCalled();
      expect(out.profile.id).toBe('pp-1');
    });

    it('fails loudly with INTERNAL_ERROR if the provider role is not seeded', async () => {
      const m = makeMocks({
        roles: { findByName: jest.fn().mockResolvedValue(null) },
        providers: {
          findByUserIdWithCategories: jest.fn().mockResolvedValue(null),
          createForUser: jest.fn(),
        },
      });
      await expect(makeService(m).upgrade('user-1')).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        status: 500,
      });
      expect(m.users.assignRole).not.toHaveBeenCalled();
      expect(m.providers.createForUser).not.toHaveBeenCalled();
    });

    it('rejects with NOT_FOUND when the user is missing', async () => {
      const m = makeMocks({ users: { findById: jest.fn().mockResolvedValue(null) } });
      await expect(makeService(m).upgrade('ghost')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });
  });

  // ─── get ─────────────────────────────────────────────────────────────────
  describe('get', () => {
    it('returns the summary for an existing provider', async () => {
      const m = makeMocks({
        providers: {
          findByUserIdWithCategories: jest
            .fn()
            .mockResolvedValue(
              makeProviderWithCategories({ availability: 'ONLINE' }, [makeCategory()]),
            ),
        },
      });
      const out = await makeService(m).get('user-1');
      expect(out.profile.availability).toBe('ONLINE');
      expect(out.profile.serviceCategories).toEqual([
        expect.objectContaining({ slug: 'plumbing', labelEn: 'Plumbing' }),
      ]);
      // Internal columns never leak.
      expect(out.profile).not.toHaveProperty('userId');
      expect(out.profile).not.toHaveProperty('deletedAt');
    });

    it('returns NOT_FOUND when the provider has the role but no profile row', async () => {
      const m = makeMocks({
        providers: { findByUserIdWithCategories: jest.fn().mockResolvedValue(null) },
      });
      await expect(makeService(m).get('user-1')).rejects.toBeInstanceOf(AppError);
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────
  describe('update', () => {
    it('persists profile fields the caller actually sent', async () => {
      const m = makeMocks();
      await makeService(m).update('user-1', {
        bio: 'Hello there.',
        serviceAreaCity: 'Riyadh',
        serviceAreaCountry: 'Saudi Arabia',
        serviceAreaLat: 24.7136,
        serviceAreaLng: 46.6753,
        serviceAreaRadiusKm: 25,
      });
      expect(m.providers.updateById).toHaveBeenCalledWith(
        'pp-1',
        expect.objectContaining({
          bio: 'Hello there.',
          serviceAreaCity: 'Riyadh',
          serviceAreaCountry: 'Saudi Arabia',
          serviceAreaLat: 24.7136,
          serviceAreaLng: 46.6753,
          serviceAreaRadiusKm: 25,
        }),
        undefined,
      );
      expect(m.providers.removeServiceCategories).not.toHaveBeenCalled();
    });

    // ── Sprint 2: adding a skill is an ADMIN decision ─────────────────────
    //
    // These replace the previous "replaces service categories when categoryIds
    // is provided" test, which asserted the defect: it pinned the behaviour
    // that let a provider write any active category straight onto their own
    // profile. The endpoint still accepts categoryIds — that is how removal is
    // expressed — but an id the provider does not already hold is now refused.
    it('REFUSES to add a category the provider does not already hold', async () => {
      const m = makeMocks(); // profile starts with no categories
      await expect(
        makeService(m).update('user-1', { categoryIds: ['cat-plumbing'] }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

      expect(m.providers.removeServiceCategories).not.toHaveBeenCalled();
      expect(m.providers.updateById).not.toHaveBeenCalled();
    });

    it('the refusal tells the provider where to actually apply', async () => {
      const m = makeMocks();
      await expect(
        makeService(m).update('user-1', { categoryIds: ['cat-plumbing'] }),
      ).rejects.toMatchObject({ message: expect.stringContaining('Apply for the category') });
    });

    it('refuses the ADD even when it is bundled with a legitimate profile edit', async () => {
      // The whole PATCH is one transaction, so a rejected skill grant must not
      // let the rest of the payload through. Otherwise "change my bio AND give
      // me plumbing" half-succeeds and the client cannot tell which half.
      const m = makeMocks();
      await expect(
        makeService(m).update('user-1', { bio: 'Hello', categoryIds: ['cat-plumbing'] }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      expect(m.providers.removeServiceCategories).not.toHaveBeenCalled();
      expect(m.providers.updateById).not.toHaveBeenCalled();
    });

    it('refuses an ADD that is disguised as a removal of something else', async () => {
      // Holds plumbing; asks for electrical only. That is one removal AND one
      // addition, and the addition decides the outcome.
      const held = makeCategory({ id: 'cat-plumbing' });
      const m = makeMocks({
        providers: {
          findByUserIdWithCategories: jest
            .fn()
            .mockResolvedValue(makeProviderWithCategories({}, [held])),
        },
      });
      await expect(
        makeService(m).update('user-1', { categoryIds: ['cat-electrical'] }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      expect(m.providers.removeServiceCategories).not.toHaveBeenCalled();
    });

    // ── Sprint 2: removal is self-service ────────────────────────────────
    it('removes a held category and records why the skill set changed', async () => {
      const held = makeCategory({ id: 'cat-plumbing' });
      const m = makeMocks({
        providers: {
          findByUserIdWithCategories: jest
            .fn()
            .mockResolvedValue(makeProviderWithCategories({}, [held])),
        },
      });
      await makeService(m).update('user-1', { categoryIds: [] });

      expect(m.providers.removeServiceCategories).toHaveBeenCalledWith(
        'pp-1',
        ['cat-plumbing'],
        undefined,
      );
      expect(m.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PROVIDER_CATEGORY_REMOVED',
          userId: 'user-1',
          metadata: expect.objectContaining({ removedCategoryIds: ['cat-plumbing'] }),
        }),
        undefined,
      );
    });

    it('keeps a held category that is still present in the payload', async () => {
      const held = makeCategory({ id: 'cat-plumbing' });
      const m = makeMocks({
        providers: {
          findByUserIdWithCategories: jest
            .fn()
            .mockResolvedValue(makeProviderWithCategories({}, [held])),
        },
      });
      await makeService(m).update('user-1', { categoryIds: ['cat-plumbing'] });
      expect(m.providers.removeServiceCategories).not.toHaveBeenCalled();
      expect(m.audit.record).not.toHaveBeenCalled();
    });

    it('an empty array on a provider with no skills is a no-op, not an audit event', async () => {
      const m = makeMocks();
      await makeService(m).update('user-1', { categoryIds: [] });
      expect(m.categories.findById).not.toHaveBeenCalled();
      expect(m.providers.removeServiceCategories).not.toHaveBeenCalled();
      expect(m.audit.record).not.toHaveBeenCalled();
    });

    it('surfaces pendingCategories on the profile it returns', async () => {
      const pending = makeCategory({ id: 'cat-electrical', slug: 'electrical' });
      const m = makeMocks({
        providers: {
          findByUserIdWithCategories: jest
            .fn()
            .mockResolvedValue(makeProviderWithCategories({}, [], [pending])),
          findByIdWithCategories: jest
            .fn()
            .mockResolvedValue(makeProviderWithCategories({}, [], [pending])),
        },
      });
      const out = await makeService(m).update('user-1', { bio: 'x' });
      expect(out.profile.pendingCategories).toEqual([
        expect.objectContaining({ id: 'cat-electrical', slug: 'electrical' }),
      ]);
      // A pending category is NOT an approved one. Conflating the two is how a
      // Skills screen ends up advertising an unearned skill as live.
      expect(out.profile.serviceCategories).toEqual([]);
    });

    it('rejects unknown / inactive categoryIds with VALIDATION_ERROR', async () => {
      const m = makeMocks({
        categories: {
          findById: jest
            .fn()
            .mockResolvedValueOnce(makeCategory())
            .mockResolvedValueOnce(makeCategory({ isActive: false })),
        },
      });
      await expect(
        makeService(m).update('user-1', { categoryIds: ['cat-plumbing', 'cat-stale'] }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      expect(m.providers.removeServiceCategories).not.toHaveBeenCalled();
      expect(m.providers.updateById).not.toHaveBeenCalled();
    });

    it('rejects with NOT_FOUND if the provider profile disappears mid-transaction', async () => {
      const m = makeMocks({
        providers: { findByUserIdWithCategories: jest.fn().mockResolvedValue(null) },
      });
      await expect(makeService(m).update('user-1', { bio: 'x' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(m.providers.updateById).not.toHaveBeenCalled();
    });

    it('skips the profile UPDATE when only categoryIds are sent', async () => {
      const held = makeCategory({ id: 'cat-plumbing' });
      const m = makeMocks({
        providers: {
          findByUserIdWithCategories: jest
            .fn()
            .mockResolvedValue(makeProviderWithCategories({}, [held])),
        },
      });
      await makeService(m).update('user-1', { categoryIds: [] });
      expect(m.providers.updateById).not.toHaveBeenCalled();
      expect(m.providers.removeServiceCategories).toHaveBeenCalled();
    });

    // Sprint 7.x — city → coords auto-resolution. The provider feed +
    // LiveJobs map default to Riyadh coordinates regardless of the
    // provider's actual city when lat/lng aren't on the row. Filling
    // them from a city centroid table at write time keeps the map
    // honest without forcing the operator to look up coords.
    it('auto-fills serviceAreaLat/Lng from the city centroid when lat/lng are omitted', async () => {
      const m = makeMocks();
      await makeService(m).update('user-1', { serviceAreaCity: 'Aleppo' });
      expect(m.providers.updateById).toHaveBeenCalledWith(
        'pp-1',
        expect.objectContaining({
          serviceAreaCity: 'Aleppo',
          serviceAreaLat: 36.2012,
          serviceAreaLng: 37.1612,
        }),
        undefined,
      );
    });

    it('matches the city centroid case-insensitively (lowercase / mixed-case)', async () => {
      const m = makeMocks();
      await makeService(m).update('user-1', { serviceAreaCity: 'damascus' });
      expect(m.providers.updateById).toHaveBeenCalledWith(
        'pp-1',
        expect.objectContaining({
          serviceAreaLat: 33.5138,
          serviceAreaLng: 36.2765,
        }),
        undefined,
      );
    });

    it('respects explicit lat/lng — never overrides them with the city centroid', async () => {
      const m = makeMocks();
      // Caller passed precise coords (e.g. they dragged the map pin to
      // their workshop, not the city centre). We MUST forward those
      // verbatim and never substitute the centroid.
      await makeService(m).update('user-1', {
        serviceAreaCity: 'Aleppo',
        serviceAreaLat: 36.215,
        serviceAreaLng: 37.155,
      });
      expect(m.providers.updateById).toHaveBeenCalledWith(
        'pp-1',
        expect.objectContaining({
          serviceAreaLat: 36.215,
          serviceAreaLng: 37.155,
        }),
        undefined,
      );
    });

    it('does not overwrite existing row coords when only the city is patched', async () => {
      // The row already carries precise coords from a prior PATCH.
      // The new patch only touches the city — we must leave the
      // coords alone (passing `undefined` to the repo, which is
      // its "not touched" sentinel).
      const m = makeMocks({
        providers: {
          findByUserIdWithCategories: jest.fn().mockResolvedValue(
            makeProviderWithCategories({
              serviceAreaLat: 36.215,
              serviceAreaLng: 37.155,
            }),
          ),
        },
      });
      await makeService(m).update('user-1', { serviceAreaCity: 'Aleppo' });
      const call = m.providers.updateById.mock.calls[0][1];
      expect(call.serviceAreaLat).toBeUndefined();
      expect(call.serviceAreaLng).toBeUndefined();
    });

    it('leaves lat/lng untouched when the city is not in the centroid table', async () => {
      const m = makeMocks();
      await makeService(m).update('user-1', { serviceAreaCity: 'NotARealCity' });
      const call = m.providers.updateById.mock.calls[0][1];
      expect(call.serviceAreaLat).toBeUndefined();
      expect(call.serviceAreaLng).toBeUndefined();
    });
  });

  // ─── update availability ─────────────────────────────────────────────────
  describe('updateAvailability', () => {
    it('persists the new availability and returns the fresh summary', async () => {
      const m = makeMocks();
      const out = await makeService(m).updateAvailability('user-1', { availability: 'ONLINE' });
      expect(m.providers.updateAvailabilityById).toHaveBeenCalledWith('pp-1', 'ONLINE', undefined);
      expect(out.profile.id).toBe('pp-1');
    });

    it('rejects with NOT_FOUND when the provider has no profile', async () => {
      const m = makeMocks({
        providers: { findByUserId: jest.fn().mockResolvedValue(null) },
      });
      await expect(
        makeService(m).updateAvailability('user-1', { availability: 'ONLINE' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ─── error mapping ───────────────────────────────────────────────────────
  it('always raises AppError on the documented failure paths (no raw Prisma leak)', async () => {
    // Each method's own NOT_FOUND path uses a different repository call,
    // so we mock the relevant lookup as null per method to drive the
    // failure branch without leaking a raw Prisma error to the caller.
    const noUser = makeMocks({ users: { findById: jest.fn().mockResolvedValue(null) } });
    const noProfileGet = makeMocks({
      providers: { findByUserIdWithCategories: jest.fn().mockResolvedValue(null) },
    });
    const noProfileUpdate = makeMocks({
      providers: { findByUserIdWithCategories: jest.fn().mockResolvedValue(null) },
    });
    const noProfileAvailability = makeMocks({
      providers: { findByUserId: jest.fn().mockResolvedValue(null) },
    });
    await Promise.all([
      expect(makeService(noUser).upgrade('u')).rejects.toBeInstanceOf(AppError),
      expect(makeService(noProfileGet).get('u')).rejects.toBeInstanceOf(AppError),
      expect(makeService(noProfileUpdate).update('u', {})).rejects.toBeInstanceOf(AppError),
      expect(
        makeService(noProfileAvailability).updateAvailability('u', { availability: 'ONLINE' }),
      ).rejects.toBeInstanceOf(AppError),
    ]);
  });
});
