import type { ProviderCategoryApplicationStatus } from '@homeservicemarketplace/database';

import type {
  ProviderCategoryApplicationRepository,
  ProviderCategoryApplicationWithJoins,
} from '../../../infrastructure/persistence/services/provider-category-application.repository';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AdminCategoryApplicationsService } from './admin-category-applications.service';

// Sprint 7.x — admin moderation surface for ProviderCategoryApplication.
//
// Covered:
//   - list: defaults to PENDING, surfaces serviceCategory + provider
//     joins, returns nextCursor when the page overflows.
//   - review APPROVE: flips status AND mirrors into
//     ProviderProfileServiceCategory inside one transaction.
//   - review REJECT: flips status only, no join-table mutation.
//   - double-review (PENDING → re-review): rejected with 409.
//   - not-found: 404 (covers the concurrent-deletion race too).
//   - APPROVE is idempotent vs an already-attached category (the
//     skipDuplicates contract on the repository).

function makeTx(): TransactionRunner {
  return {
    run: <T>(fn: (tx: undefined) => Promise<T>) => fn(undefined),
  } as unknown as TransactionRunner;
}

function makeRow(
  over: Partial<ProviderCategoryApplicationWithJoins> = {},
): ProviderCategoryApplicationWithJoins {
  return {
    id: 'app-1',
    providerProfileId: 'pp-1',
    serviceCategoryId: 'cat-plumbing',
    status: 'PENDING' as ProviderCategoryApplicationStatus,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    providerProfile: { id: 'pp-1', displayName: 'Ada Lovelace', userId: 'user-1' },
    serviceCategory: {
      id: 'cat-plumbing',
      slug: 'plumbing',
      labelEn: 'Plumbing',
      labelAr: 'سباكة',
    },
    ...over,
  } as ProviderCategoryApplicationWithJoins;
}

interface Mocks {
  applications: {
    listForAdmin: jest.Mock;
    findByIdForAdmin: jest.Mock;
    updateStatus: jest.Mock;
    ensureProviderHasCategory: jest.Mock;
  };
}

function makeMocks(initial: ProviderCategoryApplicationWithJoins | null = makeRow()): Mocks {
  let current: ProviderCategoryApplicationWithJoins | null = initial;
  return {
    applications: {
      listForAdmin: jest.fn().mockImplementation(() => Promise.resolve(current ? [current] : [])),
      findByIdForAdmin: jest.fn().mockImplementation(() => Promise.resolve(current)),
      updateStatus: jest.fn().mockImplementation(async (_id, status) => {
        if (current) current = { ...current, status };
        return current!;
      }),
      ensureProviderHasCategory: jest.fn().mockResolvedValue(undefined),
    },
  };
}

function makeService(m: Mocks) {
  return new AdminCategoryApplicationsService(
    m.applications as unknown as ProviderCategoryApplicationRepository,
    makeTx(),
  );
}

describe('AdminCategoryApplicationsService', () => {
  describe('list', () => {
    it('defaults to PENDING and maps the join into the wire shape', async () => {
      const m = makeMocks();
      const out = await makeService(m).list({});
      expect(m.applications.listForAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PENDING' }),
      );
      expect(out.items).toHaveLength(1);
      expect(out.items[0]).toMatchObject({
        id: 'app-1',
        providerProfileId: 'pp-1',
        providerDisplayName: 'Ada Lovelace',
        serviceCategoryId: 'cat-plumbing',
        serviceCategorySlug: 'plumbing',
        serviceCategoryLabelEn: 'Plumbing',
        status: 'PENDING',
      });
      expect(out.nextCursor).toBeNull();
    });

    it('forwards an explicit status filter (audit-history view)', async () => {
      const m = makeMocks(makeRow({ status: 'APPROVED' }));
      await makeService(m).list({ status: 'APPROVED' });
      expect(m.applications.listForAdmin).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'APPROVED' }),
      );
    });

    it('emits nextCursor when the page overflows the requested limit', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => makeRow({ id: `app-${i + 1}` }));
      const m = makeMocks();
      m.applications.listForAdmin.mockResolvedValue(rows);
      const out = await makeService(m).list({ limit: 2 });
      expect(out.items.map((r) => r.id)).toEqual(['app-1', 'app-2']);
      expect(out.nextCursor).toBe('app-2');
    });
  });

  describe('review', () => {
    it('APPROVE flips status AND mirrors the category into the provider profile', async () => {
      const m = makeMocks();
      const out = await makeService(m).review('app-1', { action: 'APPROVE' });

      // The join row is written FIRST so a unique-constraint surprise
      // surfaces before we flip the status.
      expect(m.applications.ensureProviderHasCategory).toHaveBeenCalledWith(
        'pp-1',
        'cat-plumbing',
        undefined,
      );
      expect(m.applications.updateStatus).toHaveBeenCalledWith('app-1', 'APPROVED', undefined);
      expect(out.status).toBe('APPROVED');
    });

    it('REJECT flips status and does NOT mutate the join table', async () => {
      const m = makeMocks();
      const out = await makeService(m).review('app-1', { action: 'REJECT', notes: 'bad fit' });

      expect(m.applications.ensureProviderHasCategory).not.toHaveBeenCalled();
      expect(m.applications.updateStatus).toHaveBeenCalledWith('app-1', 'REJECTED', undefined);
      expect(out.status).toBe('REJECTED');
    });

    it('rejects double-review on a row that is already APPROVED with 409', async () => {
      const m = makeMocks(makeRow({ status: 'APPROVED' }));
      await expect(makeService(m).review('app-1', { action: 'REJECT' })).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
      });
      expect(m.applications.updateStatus).not.toHaveBeenCalled();
      expect(m.applications.ensureProviderHasCategory).not.toHaveBeenCalled();
    });

    it('rejects double-review on a row that is already REJECTED with 409', async () => {
      const m = makeMocks(makeRow({ status: 'REJECTED' }));
      await expect(makeService(m).review('app-1', { action: 'APPROVE' })).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
      });
      expect(m.applications.updateStatus).not.toHaveBeenCalled();
    });

    it('returns 404 when the application does not exist', async () => {
      const m = makeMocks(null);
      await expect(makeService(m).review('nope', { action: 'APPROVE' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
      expect(m.applications.updateStatus).not.toHaveBeenCalled();
    });
  });
});
