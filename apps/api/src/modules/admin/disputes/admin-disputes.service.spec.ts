import type {
  DisputeRepository,
  DisputeRow,
} from '../../../infrastructure/persistence/disputes/dispute.repository';
import type {
  DisputeEventRepository,
  DisputeEventRow,
} from '../../../infrastructure/persistence/disputes/dispute-event.repository';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { AdminAuditService } from '../admin-audit.service';
import { AdminDisputesService } from './admin-disputes.service';

const tx: TransactionRunner = {
  run: <T>(fn: (t: undefined) => Promise<T>) => fn(undefined),
} as unknown as TransactionRunner;

function makeRow(over: Partial<DisputeRow> = {}): DisputeRow {
  return {
    id: 'dp-1',
    bookingId: 'bk-1',
    openedById: 'user-seeker-1',
    status: 'OPEN',
    priority: 'MEDIUM',
    reason: 'Provider was late',
    description: null,
    resolution: null,
    resolvedAt: null,
    resolvedById: null,
    createdAt: new Date('2026-05-02T00:00:00Z'),
    updatedAt: new Date('2026-05-02T00:00:00Z'),
    deletedAt: null,
    ...over,
  };
}

function makeEventRow(over: Partial<DisputeEventRow> = {}): DisputeEventRow {
  return {
    id: `de-${Math.random().toString(36).slice(2, 8)}`,
    disputeId: 'dp-1',
    actorUserId: 'admin-1',
    type: 'OPENED',
    before: null,
    after: null,
    message: null,
    createdAt: new Date('2026-05-02T00:00:00Z'),
    ...over,
  };
}

interface Mocks {
  disputes: DisputeRepository;
  events: DisputeEventRepository;
  notifications: NotificationsService;
  audit: AdminAuditService;
}

function makeMocks(initial: DisputeRow | null = makeRow()): Mocks {
  let current: DisputeRow | null = initial;
  return {
    disputes: {
      list: jest.fn().mockResolvedValue(current ? [current] : []),
      findById: jest.fn().mockImplementation(() => Promise.resolve(current)),
      create: jest.fn().mockImplementation(async (input) => {
        current = makeRow({
          id: 'dp-new',
          bookingId: input.bookingId,
          openedById: input.openedById,
          reason: input.reason,
          description: input.description ?? null,
          priority: input.priority ?? 'MEDIUM',
          status: 'OPEN',
        });
        return current;
      }),
      update: jest.fn().mockImplementation(async (id, fields) => {
        if (current) {
          current = { ...current, ...fields };
        }
        return current!;
      }),
      resolve: jest.fn().mockImplementation(async (id, input) => {
        if (current) {
          current = {
            ...current,
            status: input.status,
            resolution: input.resolution,
            resolvedById: input.resolvedById,
            resolvedAt: new Date(),
          };
        }
        return current!;
      }),
    } as unknown as DisputeRepository,
    events: {
      create: jest.fn().mockResolvedValue(makeEventRow()),
      listForDispute: jest.fn().mockResolvedValue([makeEventRow()]),
    } as unknown as DisputeEventRepository,
    notifications: {
      createForUser: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService,
    audit: {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AdminAuditService,
  };
}

function makeService(m: Mocks): AdminDisputesService {
  return new AdminDisputesService(m.disputes, m.events, m.notifications, m.audit, tx);
}

describe('AdminDisputesService', () => {
  it('list forwards status + priority filters', async () => {
    const m = makeMocks();
    await makeService(m).list({ status: 'OPEN', priority: 'HIGH' });
    expect(m.disputes.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'OPEN', priority: 'HIGH' }),
    );
  });

  it('list maps rows to summaries (carries priority)', async () => {
    const m = makeMocks(makeRow({ priority: 'URGENT' }));
    const out = await makeService(m).list({});
    expect(out.items).toHaveLength(1);
    expect(out.items[0].priority).toBe('URGENT');
  });

  it('detail returns 404 if missing', async () => {
    const m = makeMocks(null);
    await expect(makeService(m).detail('dp-missing')).rejects.toMatchObject({ status: 404 });
  });

  it('detail attaches recentEvents from the timeline repo', async () => {
    const m = makeMocks(makeRow());
    const out = await makeService(m).detail('dp-1');
    expect(m.events.listForDispute).toHaveBeenCalledWith('dp-1', expect.any(Number));
    expect(out.recentEvents).toBeDefined();
    expect(out.recentEvents!.length).toBeGreaterThan(0);
  });

  it('open writes ADMIN_DISPUTE_OPENED audit + DisputeEvent OPENED', async () => {
    const m = makeMocks(null);
    const out = await makeService(m).open('admin-1', {
      bookingId: 'bk-1',
      openedById: 'user-seeker-1',
      reason: 'late',
      priority: 'HIGH',
    });
    expect(out.dispute.id).toBe('dp-new');
    expect(out.dispute.priority).toBe('HIGH');
    expect(m.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ADMIN_DISPUTE_OPENED' }),
      undefined,
    );
    expect(m.events.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'OPENED', disputeId: 'dp-new' }),
      undefined,
    );
  });

  describe('update (Sprint 6.3 PATCH)', () => {
    it('rejects an empty body at 400', async () => {
      const m = makeMocks(makeRow());
      await expect(makeService(m).update('admin-1', 'dp-1', {})).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    });

    it('returns 404 when the dispute is missing', async () => {
      const m = makeMocks(null);
      await expect(
        makeService(m).update('admin-1', 'dp-missing', { priority: 'HIGH' }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('rejects moves OUT of a terminal status with 409', async () => {
      const m = makeMocks(makeRow({ status: 'RESOLVED_REFUND' }));
      await expect(
        makeService(m).update('admin-1', 'dp-1', { status: 'OPEN' }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('rejects moves INTO a terminal status with 409 (must use /resolve)', async () => {
      const m = makeMocks(makeRow({ status: 'IN_REVIEW' }));
      await expect(
        makeService(m).update('admin-1', 'dp-1', { status: 'RESOLVED_REFUND' }),
      ).rejects.toMatchObject({ status: 409 });
    });

    it('flips status OPEN → IN_REVIEW + emits STATUS_CHANGED + notifies opener', async () => {
      const m = makeMocks(makeRow({ status: 'OPEN' }));
      const out = await makeService(m).update('admin-1', 'dp-1', { status: 'IN_REVIEW' });
      expect(out.dispute.status).toBe('IN_REVIEW');
      expect(m.events.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'STATUS_CHANGED' }),
        undefined,
      );
      expect(m.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ADMIN_DISPUTE_UPDATED' }),
        undefined,
      );
      expect(m.notifications.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-seeker-1' }),
        undefined,
      );
    });

    it('priority-only PATCH does NOT notify the opener', async () => {
      const m = makeMocks(makeRow({ status: 'OPEN', priority: 'MEDIUM' }));
      await makeService(m).update('admin-1', 'dp-1', { priority: 'URGENT' });
      expect(m.events.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PRIORITY_CHANGED' }),
        undefined,
      );
      expect(m.notifications.createForUser).not.toHaveBeenCalled();
    });

    it('description-only PATCH emits DESCRIPTION_UPDATED + skips notification', async () => {
      const m = makeMocks(makeRow({ description: null }));
      await makeService(m).update('admin-1', 'dp-1', { description: 'new note' });
      expect(m.events.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'DESCRIPTION_UPDATED' }),
        undefined,
      );
      expect(m.notifications.createForUser).not.toHaveBeenCalled();
    });

    it('skips event emission when the value is unchanged (no-op idempotent)', async () => {
      const m = makeMocks(makeRow({ priority: 'HIGH' }));
      await makeService(m).update('admin-1', 'dp-1', { priority: 'HIGH' });
      // No PRIORITY_CHANGED event should fire.
      const calls = (m.events.create as jest.Mock).mock.calls;
      expect(calls.every((c) => c[0].type !== 'PRIORITY_CHANGED')).toBe(true);
      // But the audit row IS still recorded (operator's intent captured).
      expect(m.audit.record).toHaveBeenCalled();
    });
  });

  describe('resolve', () => {
    it('flips status + writes audit + emits RESOLVED event + notifies opener', async () => {
      const m = makeMocks(makeRow({ status: 'OPEN' }));
      await makeService(m).resolve('admin-1', 'dp-1', {
        status: 'RESOLVED_REFUND',
        resolution: 'full refund',
      });
      expect(m.disputes.resolve).toHaveBeenCalledWith(
        'dp-1',
        expect.objectContaining({ status: 'RESOLVED_REFUND', resolvedById: 'admin-1' }),
        undefined,
      );
      expect(m.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ADMIN_DISPUTE_RESOLVED' }),
        undefined,
      );
      expect(m.events.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'RESOLVED', message: 'full refund' }),
        undefined,
      );
      expect(m.notifications.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-seeker-1' }),
        undefined,
      );
    });

    it('rejects already-resolved dispute with 409', async () => {
      const m = makeMocks(makeRow({ status: 'RESOLVED_DENIED' }));
      await expect(
        makeService(m).resolve('admin-1', 'dp-1', {
          status: 'RESOLVED_REFUND',
          resolution: 'x',
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });
});
