import type { BookingRepository } from '../../../infrastructure/persistence/bookings/booking.repository';
import type {
  DisputeRepository,
  DisputeRow,
} from '../../../infrastructure/persistence/disputes/dispute.repository';
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
    reason: 'Provider was late',
    resolution: null,
    resolvedAt: null,
    resolvedById: null,
    createdAt: new Date('2026-05-02T00:00:00Z'),
    updatedAt: new Date('2026-05-02T00:00:00Z'),
    deletedAt: null,
    ...over,
  };
}

interface Mocks {
  disputes: DisputeRepository;
  bookings: BookingRepository;
  notifications: NotificationsService;
  audit: AdminAuditService;
}

function makeMocks(initial: DisputeRow | null = makeRow()): Mocks {
  return {
    disputes: {
      list: jest.fn().mockResolvedValue(initial ? [initial] : []),
      findById: jest.fn().mockResolvedValue(initial),
      create: jest.fn().mockResolvedValue(makeRow({ id: 'dp-new' })),
      resolve: jest
        .fn()
        .mockResolvedValue(makeRow({ status: 'RESOLVED_REFUND', resolution: 'full refund' })),
    } as unknown as DisputeRepository,
    bookings: {
      findByBidId: jest.fn().mockResolvedValue(null),
    } as unknown as BookingRepository,
    notifications: {
      createForUser: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService,
    audit: {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AdminAuditService,
  };
}

function makeService(m: Mocks): AdminDisputesService {
  return new AdminDisputesService(m.disputes, m.bookings, m.notifications, m.audit, tx);
}

describe('AdminDisputesService', () => {
  it('open writes ADMIN_DISPUTE_OPENED audit', async () => {
    const m = makeMocks();
    const out = await makeService(m).open('admin-1', {
      bookingId: 'bk-1',
      openedById: 'user-seeker-1',
      reason: 'late',
    });
    expect(out.dispute.id).toBe('dp-new');
    expect(m.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ADMIN_DISPUTE_OPENED' }),
      undefined,
    );
  });

  it('detail returns 404 if missing', async () => {
    const m = makeMocks(null);
    await expect(makeService(m).detail('dp-missing')).rejects.toMatchObject({ status: 404 });
  });

  it('resolve flips status + writes audit + notifies opener', async () => {
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
    expect(m.notifications.createForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-seeker-1' }),
      undefined,
    );
  });

  it('resolve rejects already-resolved dispute with 409', async () => {
    const m = makeMocks(makeRow({ status: 'RESOLVED_DENIED' }));
    await expect(
      makeService(m).resolve('admin-1', 'dp-1', {
        status: 'RESOLVED_REFUND',
        resolution: 'x',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('list maps rows to summaries', async () => {
    const m = makeMocks(makeRow());
    const out = await makeService(m).list({});
    expect(out.items).toHaveLength(1);
    expect(out.items[0].id).toBe('dp-1');
  });
});
