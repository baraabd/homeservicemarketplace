import type {
  Bid,
  BidStatus,
  ProviderProfile,
  ServiceRequest,
  ServiceRequestStatus,
} from '@homeservicemarketplace/database';

import type {
  BidRepository,
  BidWithProvider,
} from '../../infrastructure/persistence/bids/bid.repository';
import type { BookingEventRepository } from '../../infrastructure/persistence/bookings/booking-event.repository';
import type { BookingRepository } from '../../infrastructure/persistence/bookings/booking.repository';
import type {
  ServiceRequestRepository,
  ServiceRequestWithCategory,
} from '../../infrastructure/persistence/requests/service-request.repository';
import type { ServiceRequestEventRepository } from '../../infrastructure/persistence/requests/service-request-event.repository';
import type { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';
import { BidsService } from './bids.service';

// In-memory tx runner: just calls the supplied callback with `undefined`
// — no real Prisma transaction is needed because every repository
// method is mocked.
function makeTx(): TransactionRunner {
  return {
    run: <T>(fn: (tx: undefined) => Promise<T>) => fn(undefined),
  } as unknown as TransactionRunner;
}

function makeProvider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'pp-1',
    userId: null,
    displayName: 'Omar Al-Khalid',
    initials: 'OK',
    avatarUrl: null,
    ratingAvg: 4.9,
    reviewCount: 312,
    completedJobs: 540,
    verified: true,
    topPro: true,
    createdAt: new Date('2026-04-28T00:00:00.000Z'),
    updatedAt: new Date('2026-04-28T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeBid(overrides: Partial<Bid> = {}, provider = makeProvider()): BidWithProvider {
  return {
    id: 'bid-1',
    requestId: 'req-1',
    providerId: provider.id,
    amount: 35,
    currency: 'USD',
    pricingType: 'HOURLY',
    note: null,
    status: 'PENDING' as BidStatus,
    responseTimeMinutes: 5,
    badge: 'BEST_MATCH',
    submittedAt: new Date('2026-04-28T01:00:00.000Z'),
    createdAt: new Date('2026-04-28T01:00:00.000Z'),
    updatedAt: new Date('2026-04-28T01:00:00.000Z'),
    deletedAt: null,
    ...overrides,
    provider,
  };
}

function makeRequest(overrides: Partial<ServiceRequest> = {}): ServiceRequestWithCategory {
  return {
    id: 'req-1',
    seekerUserId: 'user-1',
    categoryId: null,
    customServiceText: null,
    description: null,
    status: 'OPEN_FOR_BIDS' as ServiceRequestStatus,
    scheduleType: 'ASAP',
    scheduledAt: null,
    addressId: null,
    addressSnapshot: { label: null, line1: 'a', city: 'b', country: 'cc', lat: null, lng: null },
    createdAt: new Date('2026-04-28T00:00:00.000Z'),
    updatedAt: new Date('2026-04-28T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
    category: null,
  };
}

interface Mocks {
  bids: {
    listForRequest: jest.Mock;
    findOwned: jest.Mock;
    setStatusIf: jest.Mock;
    rejectSiblings: jest.Mock;
  };
  requests: { findOwned: jest.Mock; setStatusOwned: jest.Mock };
  bookings: { create: jest.Mock; findByBidId: jest.Mock };
  events: { create: jest.Mock };
  bookingEvents: { create: jest.Mock };
}

// Deep-partial overrides so a test can replace a single repo method
// (e.g. `requests.findOwned`) without restating every other method —
// the factory backfills the rest with the documented defaults below.
type MocksOverride = {
  [K in keyof Mocks]?: Partial<Mocks[K]>;
};

function makeMocks(over: MocksOverride = {}): Mocks {
  return {
    bids: {
      listForRequest: jest.fn().mockResolvedValue([]),
      findOwned: jest.fn().mockResolvedValue(null),
      setStatusIf: jest.fn().mockResolvedValue({ count: 1 }),
      rejectSiblings: jest.fn().mockResolvedValue({ count: 0 }),
      ...(over.bids ?? {}),
    },
    requests: {
      findOwned: jest.fn().mockResolvedValue(makeRequest()),
      setStatusOwned: jest.fn().mockResolvedValue({ count: 1 }),
      ...(over.requests ?? {}),
    },
    bookings: {
      create: jest.fn().mockResolvedValue({
        id: 'bk-1',
        requestId: 'req-1',
        bidId: 'bid-1',
        seekerUserId: 'user-1',
        providerId: 'pp-1',
        status: 'SCHEDULED',
        scheduledAt: null,
        priceAmount: 35,
        currency: 'USD',
        createdAt: new Date('2026-04-28T02:00:00.000Z'),
        updatedAt: new Date('2026-04-28T02:00:00.000Z'),
        deletedAt: null,
      }),
      findByBidId: jest.fn().mockResolvedValue(null),
      ...(over.bookings ?? {}),
    },
    events: {
      create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      ...(over.events ?? {}),
    },
    bookingEvents: {
      create: jest.fn().mockResolvedValue({ id: 'bevt-1' }),
      ...(over.bookingEvents ?? {}),
    },
  };
}

function makeService(m: Mocks) {
  return new BidsService(
    m.bids as unknown as BidRepository,
    m.requests as unknown as ServiceRequestRepository,
    m.bookings as unknown as BookingRepository,
    m.events as unknown as ServiceRequestEventRepository,
    m.bookingEvents as unknown as BookingEventRepository,
    makeTx(),
  );
}

describe('BidsService', () => {
  // ─── ownership ────────────────────────────────────────────────────────
  describe('ownership', () => {
    it('list rejects with NOT_FOUND when the request is not owned', async () => {
      const m = makeMocks({ requests: { findOwned: jest.fn().mockResolvedValue(null) } });
      await expect(
        makeService(m).listForRequest('user-attacker', 'req-victim'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      expect(m.bids.listForRequest).not.toHaveBeenCalled();
    });

    it('detail rejects with NOT_FOUND when the request is not owned', async () => {
      const m = makeMocks({ requests: { findOwned: jest.fn().mockResolvedValue(null) } });
      await expect(
        makeService(m).detail('user-attacker', 'req-victim', 'bid-1'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(m.bids.findOwned).not.toHaveBeenCalled();
    });

    it('detail rejects with NOT_FOUND when the bid is missing on an owned request', async () => {
      const m = makeMocks({
        bids: { findOwned: jest.fn().mockResolvedValue(null), listForRequest: jest.fn() },
      });
      await expect(makeService(m).detail('user-1', 'req-1', 'bid-bogus')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  // ─── list ─────────────────────────────────────────────────────────────
  describe('list', () => {
    it('returns the items envelope mapped to BidSummary (drops persistence fields)', async () => {
      const m = makeMocks({
        bids: {
          listForRequest: jest.fn().mockResolvedValue([makeBid()]),
          findOwned: jest.fn(),
        },
      });
      const out = await makeService(m).listForRequest('user-1', 'req-1');
      expect(out.items).toHaveLength(1);
      expect(out.nextCursor).toBeNull();
      const dto = out.items[0];
      // Persistence-only fields must not leak.
      expect(dto).not.toHaveProperty('providerId');
      expect(dto).not.toHaveProperty('deletedAt');
      // Provider summary is the lightweight shape (no userId).
      expect(dto.provider).not.toHaveProperty('userId');
      // ISO timestamp on the wire.
      expect(typeof dto.submittedAt).toBe('string');
      expect(() => new Date(dto.submittedAt).toISOString()).not.toThrow();
    });

    it('empty list returns 200-shape with empty items array', async () => {
      const m = makeMocks();
      const out = await makeService(m).listForRequest('user-1', 'req-1');
      expect(out).toEqual({ items: [], nextCursor: null });
    });

    it('forwards the requested sort to the repository', async () => {
      const m = makeMocks({
        bids: {
          listForRequest: jest.fn().mockResolvedValue([]),
          findOwned: jest.fn(),
        },
      });
      await makeService(m).listForRequest('user-1', 'req-1', { sort: 'price' });
      expect(m.bids.listForRequest).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: 'req-1', sort: 'price' }),
      );
    });

    it('default sort is "recommended" when no query is supplied', async () => {
      const m = makeMocks({
        bids: {
          listForRequest: jest.fn().mockResolvedValue([]),
          findOwned: jest.fn(),
        },
      });
      await makeService(m).listForRequest('user-1', 'req-1');
      expect(m.bids.listForRequest).toHaveBeenCalledWith(
        expect.objectContaining({ sort: 'recommended' }),
      );
    });
  });

  // ─── provider summary mapping ─────────────────────────────────────────
  it('provider summary maps every public field and excludes private ones', async () => {
    const provider = makeProvider({
      userId: 'leaky-user-id', // must NOT show up on the wire
      avatarUrl: 'https://cdn/x.png',
    });
    const m = makeMocks({
      bids: {
        listForRequest: jest.fn().mockResolvedValue([makeBid({}, provider)]),
        findOwned: jest.fn(),
      },
    });
    const out = await makeService(m).listForRequest('user-1', 'req-1');
    expect(out.items[0].provider).toEqual({
      id: 'pp-1',
      displayName: 'Omar Al-Khalid',
      initials: 'OK',
      avatarUrl: 'https://cdn/x.png',
      ratingAvg: 4.9,
      reviewCount: 312,
      completedJobs: 540,
      verified: true,
      topPro: true,
    });
  });

  // ─── accept-bid (slice 2.2) ───────────────────────────────────────────
  describe('accept', () => {
    function ownedRequest(over: Partial<ServiceRequest> = {}) {
      return jest.fn().mockResolvedValue(makeRequest(over));
    }
    function pendingBid(over: Partial<Bid> = {}) {
      // findOwned is called twice: once before the flip, once after.
      // The post-flip read returns the bid with status ACCEPTED.
      const pre = makeBid({ status: 'PENDING' as BidStatus, ...over });
      const post = makeBid({ status: 'ACCEPTED' as BidStatus, ...over });
      return jest.fn().mockResolvedValueOnce(pre).mockResolvedValueOnce(post);
    }

    it('happy path: flips bid → ACCEPTED, rejects siblings, flips request, creates booking + event', async () => {
      const m = makeMocks({
        requests: {
          findOwned: ownedRequest(),
          setStatusOwned: jest.fn().mockResolvedValue({ count: 1 }),
        },
        bids: {
          listForRequest: jest.fn(),
          findOwned: pendingBid(),
          setStatusIf: jest.fn().mockResolvedValue({ count: 1 }),
          rejectSiblings: jest.fn().mockResolvedValue({ count: 2 }),
        },
      });
      const out = await makeService(m).accept('user-1', 'req-1', 'bid-1');
      // Bid flip ordering pinned: setStatusIf called with the
      // PENDING → ACCEPTED transition.
      expect(m.bids.setStatusIf).toHaveBeenCalledWith('bid-1', 'PENDING', 'ACCEPTED', undefined);
      // Sibling rejection skipped the just-accepted bid.
      expect(m.bids.rejectSiblings).toHaveBeenCalledWith('req-1', 'bid-1', undefined);
      // Request flip: OPEN_FOR_BIDS → BID_ACCEPTED only.
      expect(m.requests.setStatusOwned).toHaveBeenCalledWith(
        'req-1',
        'user-1',
        ['OPEN_FOR_BIDS'],
        'BID_ACCEPTED',
        undefined,
      );
      // Booking row carries the snapshotted price + currency from the bid.
      const passed = m.bookings.create.mock.calls[0]?.[0];
      expect(passed).toMatchObject({
        requestId: 'req-1',
        bidId: 'bid-1',
        seekerUserId: 'user-1',
        providerId: 'pp-1',
        priceAmount: 35,
        currency: 'USD',
      });
      // Event records the transition with the linking ids.
      expect(m.events.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'REQUEST_UPDATED',
          actorUserId: 'user-1',
          metadata: { acceptedBidId: 'bid-1', bookingId: 'bk-1' },
        }),
        undefined,
      );
      // Booking-side timeline event (slice 2.3) is written inside the
      // same tx so the booking timeline can never disagree with the
      // booking row.
      expect(m.bookingEvents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: 'bk-1',
          actorUserId: 'user-1',
          type: 'BOOKING_CREATED',
          metadata: { requestId: 'req-1', bidId: 'bid-1', providerId: 'pp-1' },
        }),
        undefined,
      );
      // Response shape.
      expect(out.bid.status).toBe('ACCEPTED');
      expect(out.booking.id).toBe('bk-1');
      expect(out.requestStatus).toBe('BID_ACCEPTED');
    });

    it('rejects with NOT_FOUND when the request is not owned (cross-user attempt)', async () => {
      const m = makeMocks({
        requests: {
          findOwned: jest.fn().mockResolvedValue(null),
          setStatusOwned: jest.fn(),
        },
      });
      await expect(
        makeService(m).accept('user-attacker', 'req-victim', 'bid-1'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      expect(m.bids.setStatusIf).not.toHaveBeenCalled();
      expect(m.bookings.create).not.toHaveBeenCalled();
    });

    it('rejects with CONFLICT when the request is CANCELLED', async () => {
      const m = makeMocks({
        requests: {
          findOwned: ownedRequest({ status: 'CANCELLED' as ServiceRequestStatus }),
          setStatusOwned: jest.fn(),
        },
      });
      await expect(makeService(m).accept('user-1', 'req-1', 'bid-1')).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
      });
      expect(m.bookings.create).not.toHaveBeenCalled();
    });

    it('rejects with CONFLICT when the request is already BID_ACCEPTED (second-bid attempt)', async () => {
      const m = makeMocks({
        requests: {
          findOwned: ownedRequest({ status: 'BID_ACCEPTED' as ServiceRequestStatus }),
          setStatusOwned: jest.fn(),
        },
      });
      await expect(makeService(m).accept('user-1', 'req-1', 'bid-2')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(m.bids.setStatusIf).not.toHaveBeenCalled();
    });

    it('rejects with NOT_FOUND when the bid is not on this request (foreign bidId)', async () => {
      const m = makeMocks({
        requests: { findOwned: ownedRequest(), setStatusOwned: jest.fn() },
        bids: {
          listForRequest: jest.fn(),
          findOwned: jest.fn().mockResolvedValue(null),
          setStatusIf: jest.fn(),
          rejectSiblings: jest.fn(),
        },
      });
      await expect(makeService(m).accept('user-1', 'req-1', 'bid-foreign')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('rejects with CONFLICT when the bid is already ACCEPTED (double-accept same bid)', async () => {
      const m = makeMocks({
        requests: { findOwned: ownedRequest(), setStatusOwned: jest.fn() },
        bids: {
          listForRequest: jest.fn(),
          findOwned: jest.fn().mockResolvedValue(makeBid({ status: 'ACCEPTED' as BidStatus })),
          setStatusIf: jest.fn(),
          rejectSiblings: jest.fn(),
        },
      });
      await expect(makeService(m).accept('user-1', 'req-1', 'bid-1')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(m.bids.setStatusIf).not.toHaveBeenCalled();
    });

    it('rejects with CONFLICT when the bid is REJECTED / WITHDRAWN', async () => {
      for (const status of ['REJECTED', 'WITHDRAWN'] as const) {
        const m = makeMocks({
          requests: { findOwned: ownedRequest(), setStatusOwned: jest.fn() },
          bids: {
            listForRequest: jest.fn(),
            findOwned: jest.fn().mockResolvedValue(makeBid({ status: status as BidStatus })),
            setStatusIf: jest.fn(),
            rejectSiblings: jest.fn(),
          },
        });
        await expect(makeService(m).accept('user-1', 'req-1', 'bid-1')).rejects.toMatchObject({
          code: 'CONFLICT',
        });
      }
    });

    it('rejects with CONFLICT on a bid race (setStatusIf returns count: 0)', async () => {
      // Pre-flip read sees PENDING, but a concurrent writer flipped
      // the row before our update fired.
      const m = makeMocks({
        requests: { findOwned: ownedRequest(), setStatusOwned: jest.fn() },
        bids: {
          listForRequest: jest.fn(),
          findOwned: jest.fn().mockResolvedValue(makeBid({ status: 'PENDING' as BidStatus })),
          setStatusIf: jest.fn().mockResolvedValue({ count: 0 }),
          rejectSiblings: jest.fn(),
        },
      });
      await expect(makeService(m).accept('user-1', 'req-1', 'bid-1')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect(m.bookings.create).not.toHaveBeenCalled();
    });

    it('rejects with CONFLICT on a request race (setStatusOwned returns count: 0)', async () => {
      const m = makeMocks({
        requests: {
          findOwned: ownedRequest(),
          setStatusOwned: jest.fn().mockResolvedValue({ count: 0 }),
        },
        bids: {
          listForRequest: jest.fn(),
          findOwned: pendingBid(),
          setStatusIf: jest.fn().mockResolvedValue({ count: 1 }),
          rejectSiblings: jest.fn().mockResolvedValue({ count: 0 }),
        },
      });
      await expect(makeService(m).accept('user-1', 'req-1', 'bid-1')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      // Booking must NOT be created when the request flip fails.
      expect(m.bookings.create).not.toHaveBeenCalled();
    });

    it('snapshots priceAmount + currency from the bid (not the request)', async () => {
      const m = makeMocks({
        requests: {
          findOwned: ownedRequest(),
          setStatusOwned: jest.fn().mockResolvedValue({ count: 1 }),
        },
        bids: {
          listForRequest: jest.fn(),
          findOwned: pendingBid({ amount: 99, currency: 'EUR' }),
          setStatusIf: jest.fn().mockResolvedValue({ count: 1 }),
          rejectSiblings: jest.fn().mockResolvedValue({ count: 0 }),
        },
      });
      await makeService(m).accept('user-1', 'req-1', 'bid-1');
      const passed = m.bookings.create.mock.calls[0]?.[0];
      expect(passed.priceAmount).toBe(99);
      expect(passed.currency).toBe('EUR');
    });
  });

  // ─── error contract ───────────────────────────────────────────────────
  it('throws AppError on every error path (no raw Prisma errors leak)', async () => {
    const m = makeMocks({
      requests: { findOwned: jest.fn().mockResolvedValue(null), setStatusOwned: jest.fn() },
    });
    const svc = makeService(m);
    await Promise.all([
      expect(svc.listForRequest('u', 'r')).rejects.toBeInstanceOf(AppError),
      expect(svc.detail('u', 'r', 'b')).rejects.toBeInstanceOf(AppError),
      expect(svc.accept('u', 'r', 'b')).rejects.toBeInstanceOf(AppError),
    ]);
  });
});
