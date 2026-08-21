import { Prisma } from '@homeservicemarketplace/database';

import type { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import type { ProviderCategoryApplicationRepository } from '../../../infrastructure/persistence/services/provider-category-application.repository';
import type { ServiceCategoryRepository } from '../../../infrastructure/persistence/services/service-category.repository';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { AuditService } from '../../iam/audit/audit.service';
import { ProviderCategoriesService } from './provider-categories.service';

// Sprint 2 — provider-side skill applications.
//
// The property under test throughout is that applying is the ONLY way a
// provider can move toward holding a skill, and that applying grants nothing
// by itself. Every test here should still pass if the admin queue were deleted
// tomorrow — none of them let a provider reach an approved state.

function makeTx(): TransactionRunner {
  return {
    run: <T>(fn: (tx: undefined) => Promise<T>) => fn(undefined),
  } as unknown as TransactionRunner;
}

const CATEGORY = {
  id: 'cat-plumbing',
  slug: 'plumbing',
  labelEn: 'Plumbing',
  labelAr: 'plumbing-ar',
  icon: 'wrench',
  sortOrder: 1,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
};

function makeApplicationRow(over: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    providerProfileId: 'pp-1',
    serviceCategoryId: CATEGORY.id,
    status: 'PENDING',
    supersededAt: null,
    supersededById: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    serviceCategory: CATEGORY,
    ...over,
  };
}

function makeProfile(held: string[] = []) {
  return {
    id: 'pp-1',
    userId: 'user-1',
    serviceCategories: held.map((id) => ({ serviceCategoryId: id })),
    categoryApplications: [],
  };
}

interface Mocks {
  providers: { findByUserId: jest.Mock; findByUserIdWithCategories: jest.Mock };
  applications: {
    findLivePending: jest.Mock;
    createPending: jest.Mock;
    listForProvider: jest.Mock;
  };
  categories: { findById: jest.Mock; findBySlug: jest.Mock };
  audit: { record: jest.Mock };
}

function makeMocks(over: { [K in keyof Mocks]?: Partial<Mocks[K]> } = {}): Mocks {
  return {
    providers: {
      findByUserId: jest.fn().mockResolvedValue(makeProfile()),
      findByUserIdWithCategories: jest.fn().mockResolvedValue(makeProfile()),
      ...(over.providers ?? {}),
    },
    applications: {
      findLivePending: jest.fn().mockResolvedValue(null),
      createPending: jest.fn().mockResolvedValue(makeApplicationRow()),
      listForProvider: jest.fn().mockResolvedValue([makeApplicationRow()]),
      ...(over.applications ?? {}),
    },
    categories: {
      findById: jest.fn().mockResolvedValue(CATEGORY),
      findBySlug: jest.fn().mockResolvedValue(CATEGORY),
      ...(over.categories ?? {}),
    },
    audit: { record: jest.fn().mockResolvedValue(undefined), ...(over.audit ?? {}) },
  };
}

function makeService(m: Mocks) {
  return new ProviderCategoriesService(
    m.providers as unknown as ProviderProfileRepository,
    m.applications as unknown as ProviderCategoryApplicationRepository,
    m.categories as unknown as ServiceCategoryRepository,
    m.audit as unknown as AuditService,
    makeTx(),
  );
}

describe('ProviderCategoriesService', () => {
  describe('apply', () => {
    it('creates a PENDING application and records who asked', async () => {
      const m = makeMocks();
      const out = await makeService(m).apply('user-1', { categoryId: 'cat-plumbing' });

      expect(m.applications.createPending).toHaveBeenCalledWith('pp-1', 'cat-plumbing', undefined);
      expect(out.application.status).toBe('PENDING');
      expect(m.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'PROVIDER_CATEGORY_APPLIED',
          userId: 'user-1',
          metadata: expect.objectContaining({
            applicationId: 'app-1',
            providerProfileId: 'pp-1',
            serviceCategoryId: 'cat-plumbing',
            categorySlug: 'plumbing',
          }),
        }),
        undefined,
      );
    });

    it('never lets the caller choose the status', async () => {
      // The DTO drops unknown fields, but this pins the service side too: the
      // create call carries a provider id and a category id and nothing else,
      // so there is no argument position through which APPROVED could arrive.
      const m = makeMocks();
      await makeService(m).apply('user-1', { categoryId: 'cat-plumbing' });
      expect(m.applications.createPending).toHaveBeenCalledWith('pp-1', 'cat-plumbing', undefined);
      expect(m.applications.createPending.mock.calls[0]).toHaveLength(3);
    });

    it('applying does NOT grant the skill', async () => {
      const m = makeMocks();
      const out = await makeService(m).apply('user-1', { categoryId: 'cat-plumbing' });
      // Nothing in the response says the provider now offers plumbing, and no
      // join-table write happened — the whole point of the queue.
      expect(out).not.toHaveProperty('profile');
      expect(out.application.status).toBe('PENDING');
    });

    it('resolves a category by slug when no id is supplied', async () => {
      const m = makeMocks();
      await makeService(m).apply('user-1', { categorySlug: 'plumbing' });
      expect(m.categories.findBySlug).toHaveBeenCalledWith('plumbing', undefined);
    });

    it('prefers the id when both id and slug are supplied', async () => {
      const m = makeMocks();
      await makeService(m).apply('user-1', { categoryId: 'cat-plumbing', categorySlug: 'other' });
      expect(m.categories.findById).toHaveBeenCalled();
      expect(m.categories.findBySlug).not.toHaveBeenCalled();
    });

    it('rejects an empty payload with 400', async () => {
      const m = makeMocks();
      await expect(makeService(m).apply('user-1', {})).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400,
      });
      expect(m.applications.createPending).not.toHaveBeenCalled();
    });

    it('rejects an unknown category with 400', async () => {
      const m = makeMocks({ categories: { findById: jest.fn().mockResolvedValue(null) } });
      await expect(
        makeService(m).apply('user-1', { categoryId: 'cat-nope' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      expect(m.applications.createPending).not.toHaveBeenCalled();
    });

    it('rejects an inactive category with 400', async () => {
      const m = makeMocks({
        categories: { findById: jest.fn().mockResolvedValue({ ...CATEGORY, isActive: false }) },
      });
      await expect(
        makeService(m).apply('user-1', { categoryId: 'cat-plumbing' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    });

    it('rejects a soft-deleted category with 400', async () => {
      const m = makeMocks({
        categories: {
          findById: jest.fn().mockResolvedValue({ ...CATEGORY, deletedAt: new Date() }),
        },
      });
      await expect(
        makeService(m).apply('user-1', { categoryId: 'cat-plumbing' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    });

    it('rejects re-applying for a category the provider already holds', async () => {
      const m = makeMocks({
        providers: {
          findByUserIdWithCategories: jest.fn().mockResolvedValue(makeProfile(['cat-plumbing'])),
        },
      });
      await expect(
        makeService(m).apply('user-1', { categoryId: 'cat-plumbing' }),
      ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      expect(m.applications.createPending).not.toHaveBeenCalled();
    });

    it('rejects a second application while one is still pending', async () => {
      const m = makeMocks({
        applications: { findLivePending: jest.fn().mockResolvedValue(makeApplicationRow()) },
      });
      await expect(
        makeService(m).apply('user-1', { categoryId: 'cat-plumbing' }),
      ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      expect(m.applications.createPending).not.toHaveBeenCalled();
    });

    // ── the concurrency path ────────────────────────────────────────────────
    // The shape Postgres actually produces: a COLUMN LIST, not the index name.
    // The first version of this test used the index-name form only, which the
    // database never emits for this constraint — so it passed while the real
    // mapping was dead. Both forms are pinned now, real one first.
    it('turns the losing side of a race into the same 409 (column-list meta)', async () => {
      const m = makeMocks({
        applications: {
          createPending: jest.fn().mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: '5.22.0',
              meta: { target: ['providerProfileId', 'serviceCategoryId'] },
            }),
          ),
        },
      });
      await expect(
        makeService(m).apply('user-1', { categoryId: 'cat-plumbing' }),
      ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    });

    it('maps a P2002 with no meta at all to 409', async () => {
      const m = makeMocks({
        applications: {
          createPending: jest.fn().mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: '5.22.0',
            }),
          ),
        },
      });
      await expect(
        makeService(m).apply('user-1', { categoryId: 'cat-plumbing' }),
      ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    });

    it('turns the losing side of a race into the same 409 (index-name meta)', async () => {
      // Both callers pass findLivePending — READ COMMITTED permits that — and
      // the partial unique index rejects the loser. Without this mapping the
      // provider who double-clicked would get an opaque 500 for what is, from
      // their side, the ordinary "you already applied" case.
      const m = makeMocks({
        applications: {
          createPending: jest.fn().mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: '5.22.0',
              meta: { target: 'provider_category_application_one_pending_uniq' },
            }),
          ),
        },
      });
      await expect(
        makeService(m).apply('user-1', { categoryId: 'cat-plumbing' }),
      ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    });

    it('does NOT swallow an unrelated unique violation as "already applied"', async () => {
      // A P2002 naming some other constraint is a real fault. Reporting it as
      // a friendly 409 would hide a bug behind a plausible message.
      const m = makeMocks({
        applications: {
          createPending: jest.fn().mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: '5.22.0',
              meta: { target: ['email'] },
            }),
          ),
        },
      });
      await expect(
        makeService(m).apply('user-1', { categoryId: 'cat-plumbing' }),
      ).rejects.not.toMatchObject({ code: 'CONFLICT' });
    });

    it('returns 404 when the caller has no provider profile', async () => {
      const m = makeMocks({
        providers: { findByUserIdWithCategories: jest.fn().mockResolvedValue(null) },
      });
      await expect(
        makeService(m).apply('ghost', { categoryId: 'cat-plumbing' }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    });
  });

  describe('listMine — ownership', () => {
    it('scopes the query to the profile resolved from the SESSION', async () => {
      const m = makeMocks();
      await makeService(m).listMine('user-1', {});

      // The session user id is what resolves the profile, and the resolved
      // profile id is what the query filters on. There is no argument through
      // which a caller could name a different provider.
      expect(m.providers.findByUserId).toHaveBeenCalledWith('user-1');
      expect(m.applications.listForProvider).toHaveBeenCalledWith('pp-1', { status: undefined });
    });

    it('a different session reaches a different profile, never a shared one', async () => {
      const m = makeMocks({
        providers: {
          findByUserId: jest.fn().mockResolvedValue({ id: 'pp-2', userId: 'user-2' }),
        },
      });
      await makeService(m).listMine('user-2', {});
      expect(m.applications.listForProvider).toHaveBeenCalledWith('pp-2', { status: undefined });
    });

    it('passes a status filter through', async () => {
      const m = makeMocks();
      await makeService(m).listMine('user-1', { status: 'REJECTED' });
      expect(m.applications.listForProvider).toHaveBeenCalledWith('pp-1', { status: 'REJECTED' });
    });

    it('maps rows to the provider-facing shape without leaking the profile id', async () => {
      const m = makeMocks();
      const out = await makeService(m).listMine('user-1', {});
      expect(out.items[0]).toEqual({
        id: 'app-1',
        status: 'PENDING',
        category: {
          id: 'cat-plumbing',
          slug: 'plumbing',
          labelEn: 'Plumbing',
          labelAr: 'plumbing-ar',
          icon: 'wrench',
        },
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        supersededAt: null,
      });
      expect(out.items[0]).not.toHaveProperty('providerProfileId');
    });

    it('surfaces supersededAt so a duplicate can be explained rather than duplicated', async () => {
      const superseded = new Date('2026-08-02T00:00:00.000Z');
      const m = makeMocks({
        applications: {
          listForProvider: jest
            .fn()
            .mockResolvedValue([makeApplicationRow({ supersededAt: superseded })]),
        },
      });
      const out = await makeService(m).listMine('user-1', {});
      expect(out.items[0].supersededAt).toBe('2026-08-02T00:00:00.000Z');
      // Still PENDING: no admin decided it, it simply lost its slot.
      expect(out.items[0].status).toBe('PENDING');
    });

    it('returns 404 when the caller has no provider profile', async () => {
      const m = makeMocks({ providers: { findByUserId: jest.fn().mockResolvedValue(null) } });
      await expect(makeService(m).listMine('ghost', {})).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });
  });
});
