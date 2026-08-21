import type { ProviderCategoryApplicationStatus } from '@homeservicemarketplace/database';

import type {
  ProviderCategoryApplicationRepository,
  ProviderCategoryApplicationWithJoins,
} from '../../../infrastructure/persistence/services/provider-category-application.repository';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { AdminAuditService } from '../admin-audit.service';
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
//   - Sprint 2: the decision and its audit record commit TOGETHER.

// A transaction double that models ROLLBACK.
//
// The previous double just invoked the callback, so a write followed by a
// throw inside one tx.run looked exactly like a write that committed. That
// makes it impossible to test the property this service actually has to have:
// that granting a provider a skill and recording who granted it are one
// atomic act. Writes are journalled against the run that made them, and a run
// counts as committed only if its callback RESOLVED.
function makeTxJournal() {
  let runSeq = 0;
  let activeRun = 0;
  const committedRuns = new Set<number>();
  const writes: { run: number; op: string }[] = [];

  const tx = {
    run: async <T>(fn: (tx: undefined) => Promise<T>): Promise<T> => {
      const id = ++runSeq;
      const previous = activeRun;
      activeRun = id;
      try {
        const result = await fn(undefined);
        committedRuns.add(id); // resolved -> COMMIT
        return result;
      } finally {
        activeRun = previous; // threw -> no commit; its writes never happened
      }
    },
  } as unknown as TransactionRunner;

  return {
    tx,
    record: (op: string) => void writes.push({ run: activeRun, op }),
    committedWrites: () => writes.filter((w) => committedRuns.has(w.run)).map((w) => w.op),
  };
}
type TxJournal = ReturnType<typeof makeTxJournal>;

function makeTx(): TransactionRunner {
  return makeTxJournal().tx;
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
  audit: { record: jest.Mock };
}

function makeMocks(
  initial: ProviderCategoryApplicationWithJoins | null = makeRow(),
  journal?: TxJournal,
): Mocks {
  let current: ProviderCategoryApplicationWithJoins | null = initial;
  // Writes whose durability matters go through the journal, so a test can ask
  // what SURVIVED rather than merely what was called.
  const note = (op: string) => journal?.record(op);
  return {
    applications: {
      listForAdmin: jest.fn().mockImplementation(() => Promise.resolve(current ? [current] : [])),
      findByIdForAdmin: jest.fn().mockImplementation(() => Promise.resolve(current)),
      updateStatus: jest.fn().mockImplementation(async (_id, status) => {
        note(`status:${status}`);
        if (current) current = { ...current, status };
        return current!;
      }),
      ensureProviderHasCategory: jest.fn().mockImplementation(async () => {
        note('joinRow');
      }),
    },
    audit: {
      record: jest.fn().mockImplementation(async (input: { type: string }) => {
        note(`audit:${input.type}`);
      }),
    },
  };
}

function makeService(m: Mocks, tx: TransactionRunner = makeTx()) {
  return new AdminCategoryApplicationsService(
    m.applications as unknown as ProviderCategoryApplicationRepository,
    tx,
    m.audit as unknown as AdminAuditService,
  );
}

const ADMIN = 'admin-user-1';

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
      const out = await makeService(m).review(ADMIN, 'app-1', { action: 'APPROVE' });

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
      const out = await makeService(m).review(ADMIN, 'app-1', {
        action: 'REJECT',
        notes: 'bad fit',
      });

      expect(m.applications.ensureProviderHasCategory).not.toHaveBeenCalled();
      expect(m.applications.updateStatus).toHaveBeenCalledWith('app-1', 'REJECTED', undefined);
      expect(out.status).toBe('REJECTED');
    });

    it('rejects double-review on a row that is already APPROVED with 409', async () => {
      const m = makeMocks(makeRow({ status: 'APPROVED' }));
      await expect(
        makeService(m).review(ADMIN, 'app-1', { action: 'REJECT' }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
      });
      expect(m.applications.updateStatus).not.toHaveBeenCalled();
      expect(m.applications.ensureProviderHasCategory).not.toHaveBeenCalled();
    });

    it('rejects double-review on a row that is already REJECTED with 409', async () => {
      const m = makeMocks(makeRow({ status: 'REJECTED' }));
      await expect(
        makeService(m).review(ADMIN, 'app-1', { action: 'APPROVE' }),
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
      });
      expect(m.applications.updateStatus).not.toHaveBeenCalled();
    });

    it('writes an APPROVED audit record naming the deciding admin', async () => {
      const m = makeMocks();
      await makeService(m).review(ADMIN, 'app-1', { action: 'APPROVE' });

      expect(m.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          adminUserId: ADMIN,
          type: 'ADMIN_CATEGORY_APPLICATION_APPROVED',
          metadata: expect.objectContaining({
            applicationId: 'app-1',
            providerProfileId: 'pp-1',
            serviceCategoryId: 'cat-plumbing',
            categorySlug: 'plumbing',
            previousStatus: 'PENDING',
            newStatus: 'APPROVED',
          }),
        }),
        undefined,
      );
    });

    it('writes a REJECTED audit record naming the deciding admin', async () => {
      const m = makeMocks();
      await makeService(m).review(ADMIN, 'app-1', { action: 'REJECT' });
      expect(m.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          adminUserId: ADMIN,
          type: 'ADMIN_CATEGORY_APPLICATION_REJECTED',
        }),
        undefined,
      );
    });

    it('commits the join row, the status flip, and the audit record TOGETHER', async () => {
      const journal = makeTxJournal();
      const m = makeMocks(makeRow(), journal);
      await makeService(m, journal.tx).review(ADMIN, 'app-1', { action: 'APPROVE' });

      // All three survived, and they survived because the SAME transaction
      // committed. A provider who can suddenly bid in a category with no
      // record of who let them is the exact state this asserts against.
      expect(journal.committedWrites()).toEqual([
        'joinRow',
        'status:APPROVED',
        'audit:ADMIN_CATEGORY_APPLICATION_APPROVED',
      ]);
    });

    it('a failure after the grant leaves NOTHING committed — not the skill, not the record', async () => {
      const journal = makeTxJournal();
      const m = makeMocks(makeRow(), journal);
      // The audit write is the last step; make it blow up.
      m.audit.record.mockImplementation(async () => {
        journal.record('audit:ADMIN_CATEGORY_APPLICATION_APPROVED');
        throw new Error('audit store unavailable');
      });

      await expect(
        makeService(m, journal.tx).review(ADMIN, 'app-1', { action: 'APPROVE' }),
      ).rejects.toThrow('audit store unavailable');

      // Everything rolled back together. If the join row had been written
      // outside the transaction the provider would now hold an unaudited
      // skill, which is the failure mode this test exists for.
      expect(journal.committedWrites()).toEqual([]);
    });

    it('APPROVE never writes a second join row for an already-attached category', async () => {
      const m = makeMocks();
      await makeService(m).review(ADMIN, 'app-1', { action: 'APPROVE' });

      // One call, and the repository behind it uses skipDuplicates against the
      // (providerProfileId, serviceCategoryId) primary key — so a provider
      // approved twice for one category holds one link, not two.
      expect(m.applications.ensureProviderHasCategory).toHaveBeenCalledTimes(1);
    });

    it('returns 404 when the application does not exist', async () => {
      const m = makeMocks(null);
      await expect(
        makeService(m).review(ADMIN, 'nope', { action: 'APPROVE' }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
      expect(m.applications.updateStatus).not.toHaveBeenCalled();
    });
  });
});
