import type {
  Bid,
  Booking,
  BookingEvent,
  BookingStatus,
  ProviderProfile,
  ServiceCategory,
  ServiceRequest,
} from '@homeservicemarketplace/database';

import type { BookingEventRepository } from '../../infrastructure/persistence/bookings/booking-event.repository';
import type { NotificationsService } from '../notifications/notifications.service';
import type { RealtimeEventsPublisher } from '../realtime/realtime-events.publisher';
import type {
  BookingRepository,
  BookingWithRelations,
} from '../../infrastructure/persistence/bookings/booking.repository';
import type { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';
import { BookingsService } from './bookings.service';

// Lightweight in-memory tx runner. Repositories are mocked, so the
// "real" Prisma transaction is unnecessary — we just invoke the
// callback with `undefined`.
function makeTx(): TransactionRunner {
  return {
    run: <T>(fn: (tx: undefined) => Promise<T>) => fn(undefined),
  } as unknown as TransactionRunner;
}

function makeProvider(over: Partial<ProviderProfile> = {}): ProviderProfile {
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
    reviewNotes: null,
    // Phase 4 onboarding lifecycle columns. An ACTIVE fixture is a provider
    // that already went through submit → approve, so it carries both stamps.
    submittedForReviewAt: new Date('2026-04-28T00:00:00.000Z'),
    reviewedAt: new Date('2026-04-28T00:00:00.000Z'),
    reviewedByUserId: null,
    rejectionReason: null,
    createdAt: new Date('2026-04-28T00:00:00.000Z'),
    updatedAt: new Date('2026-04-28T00:00:00.000Z'),
    deletedAt: null,
    ...over,
  };
}

function makeCategory(over: Partial<ServiceCategory> = {}): ServiceCategory {
  return {
    id: 'cat-plumb',
    slug: 'plumbing',
    labelEn: 'Plumbing',
    labelAr: 'سباكة',
    icon: 'wrench',
    sortOrder: 1,
    isActive: true,
    createdAt: new Date('2026-04-28T00:00:00.000Z'),
    updatedAt: new Date('2026-04-28T00:00:00.000Z'),
    deletedAt: null,
    ...over,
  };
}

function makeRequest(over: Partial<ServiceRequest> = {}): ServiceRequest & {
  category: ServiceCategory | null;
} {
  return {
    id: 'req-1',
    seekerUserId: 'user-1',
    categoryId: 'cat-plumb',
    customServiceText: null,
    description: 'Leaky tap under the kitchen sink',
    status: 'BID_ACCEPTED',
    scheduleType: 'ASAP',
    scheduledAt: null,
    addressId: null,
    addressSnapshot: {
      label: 'Home',
      line1: '123 Main',
      city: 'Riyadh',
      country: 'SA',
      lat: null,
      lng: null,
    },
    createdAt: new Date('2026-04-28T00:00:00.000Z'),
    updatedAt: new Date('2026-04-28T00:00:00.000Z'),
    deletedAt: null,
    ...over,
    category: makeCategory(),
  } as ServiceRequest & { category: ServiceCategory | null };
}

function makeBid(over: Partial<Bid> = {}): Bid {
  return {
    id: 'bid-1',
    requestId: 'req-1',
    providerId: 'pp-1',
    amount: 35,
    currency: 'USD',
    pricingType: 'HOURLY',
    note: 'I can be there in 30 minutes.',
    status: 'ACCEPTED',
    responseTimeMinutes: 5,
    badge: null,
    submittedAt: new Date('2026-04-28T01:00:00.000Z'),
    createdAt: new Date('2026-04-28T01:00:00.000Z'),
    updatedAt: new Date('2026-04-28T01:00:00.000Z'),
    deletedAt: null,
    ...over,
  };
}

function makeBooking(over: Partial<Booking> = {}): BookingWithRelations {
  const provider = makeProvider();
  const request = makeRequest();
  const bid = makeBid();
  return {
    id: 'bk-1',
    requestId: 'req-1',
    bidId: 'bid-1',
    seekerUserId: 'user-1',
    providerId: 'pp-1',
    status: 'SCHEDULED' as BookingStatus,
    scheduledAt: null,
    priceAmount: 35,
    currency: 'USD',
    createdAt: new Date('2026-04-28T02:00:00.000Z'),
    updatedAt: new Date('2026-04-28T02:00:00.000Z'),
    deletedAt: null,
    ...over,
    request,
    bid,
    provider,
  } as BookingWithRelations;
}

interface Mocks {
  bookings: {
    listForSeeker: jest.Mock;
    findOwned: jest.Mock;
    setStatusOwned: jest.Mock;
  };
  events: { create: jest.Mock; listForBooking: jest.Mock };
  notifications: { createForUser: jest.Mock };
  realtime: { publishFor: jest.Mock; publish: jest.Mock; publishToRoom: jest.Mock };
}

type MocksOverride = { [K in keyof Mocks]?: Partial<Mocks[K]> };

function makeMocks(over: MocksOverride = {}): Mocks {
  return {
    bookings: {
      listForSeeker: jest.fn().mockResolvedValue([]),
      findOwned: jest.fn().mockResolvedValue(makeBooking()),
      setStatusOwned: jest.fn().mockResolvedValue({ count: 1 }),
      ...(over.bookings ?? {}),
    },
    events: {
      create: jest.fn().mockResolvedValue({ id: 'bevt-1' }),
      listForBooking: jest.fn().mockResolvedValue([]),
      ...(over.events ?? {}),
    },
    notifications: {
      createForUser: jest.fn().mockResolvedValue({ id: 'notif-1' }),
      ...(over.notifications ?? {}),
    },
    realtime: {
      publishFor: jest.fn(),
      publish: jest.fn(),
      publishToRoom: jest.fn(),
      ...(over.realtime ?? {}),
    },
  };
}

function makeService(m: Mocks) {
  return new BookingsService(
    m.bookings as unknown as BookingRepository,
    m.events as unknown as BookingEventRepository,
    m.notifications as unknown as NotificationsService,
    makeTx(),
    m.realtime as unknown as RealtimeEventsPublisher,
  );
}

describe('BookingsService', () => {
  // ─── list ──────────────────────────────────────────────────────────────
  describe('list', () => {
    it('maps the eager-loaded row to BookingListItem (drops infra-only fields)', async () => {
      const m = makeMocks({
        bookings: { listForSeeker: jest.fn().mockResolvedValue([makeBooking()]) },
      });
      const out = await makeService(m).list('user-1', {});
      expect(out.items).toHaveLength(1);
      expect(out.nextCursor).toBeNull();
      const dto = out.items[0];
      // Persistence-only fields must not leak.
      expect(dto).not.toHaveProperty('seekerUserId');
      expect(dto).not.toHaveProperty('deletedAt');
      // Service block carries category labels for the UI.
      expect(dto.service).toEqual({
        categorySlug: 'plumbing',
        categoryLabelEn: 'Plumbing',
        categoryLabelAr: 'سباكة',
        customServiceText: null,
      });
      // Provider summary is the lightweight shape (no userId).
      expect(dto.provider).not.toHaveProperty('userId');
      // Wire dates are ISO-formatted.
      expect(typeof dto.createdAt).toBe('string');
      expect(() => new Date(dto.createdAt).toISOString()).not.toThrow();
    });

    it('empty list returns 200-shape with empty items', async () => {
      const m = makeMocks();
      const out = await makeService(m).list('user-1', {});
      expect(out).toEqual({ items: [], nextCursor: null });
    });

    it('forwards status filter to the repository (drops the IDOR vector)', async () => {
      const m = makeMocks();
      await makeService(m).list('user-1', { status: 'COMPLETED' });
      expect(m.bookings.listForSeeker).toHaveBeenCalledWith(
        expect.objectContaining({ seekerUserId: 'user-1', status: 'COMPLETED' }),
      );
    });

    it('emits nextCursor when the page is full (take+1 trick)', async () => {
      // Two rows when DEFAULT_PAGE_SIZE=50 isn't going to overflow,
      // so we use a small explicit limit to exercise the boundary.
      const a = makeBooking({ id: 'bk-a' });
      const b = makeBooking({ id: 'bk-b' });
      const c = makeBooking({ id: 'bk-c' }); // overflow row
      const m = makeMocks({
        bookings: { listForSeeker: jest.fn().mockResolvedValue([a, b, c]) },
      });
      const out = await makeService(m).list('user-1', { limit: 2 });
      expect(out.items).toHaveLength(2);
      expect(out.nextCursor).toBe('bk-b');
    });
  });

  // ─── detail ────────────────────────────────────────────────────────────
  describe('detail', () => {
    it('returns the eager-loaded BookingDetail when owned', async () => {
      const m = makeMocks();
      const out = await makeService(m).detail('user-1', 'bk-1');
      expect(out.id).toBe('bk-1');
      expect(out.bidNote).toBe('I can be there in 30 minutes.');
      expect(out.description).toBe('Leaky tap under the kitchen sink');
    });

    // Sprint 7.12 — Bug #8: the booking-side JobDetailView's
    // "Posted" step needs the ORIGINAL request's createdAt (not the
    // booking createdAt — the booking is created later, at
    // bid-accept time). BookingDetail.requestCreatedAt is sourced
    // from the eager-loaded `request` relation; this test pins the
    // wire contract.
    it('surfaces requestCreatedAt from the eager-loaded request', async () => {
      const m = makeMocks();
      const out = await makeService(m).detail('user-1', 'bk-1');
      expect(out.requestCreatedAt).toBeDefined();
      // The mock fixture's makeRequest defaults createdAt to
      // 2026-04-28T00:00:00.000Z; assert the ISO shape is on the
      // wire so the frontend formatter never receives undefined.
      expect(typeof out.requestCreatedAt).toBe('string');
      expect(out.requestCreatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('rejects with NOT_FOUND on a foreign bookingId (no leak between FORBIDDEN and NOT_FOUND)', async () => {
      const m = makeMocks({
        bookings: { findOwned: jest.fn().mockResolvedValue(null) },
      });
      await expect(makeService(m).detail('user-attacker', 'bk-victim')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });
  });

  // ─── timeline ──────────────────────────────────────────────────────────
  describe('timeline', () => {
    it('enforces ownership BEFORE reading events (cross-user → 404, no event leak)', async () => {
      const events = jest.fn();
      const m = makeMocks({
        bookings: { findOwned: jest.fn().mockResolvedValue(null) },
        events: { listForBooking: events, create: jest.fn() },
      });
      await expect(makeService(m).timeline('user-attacker', 'bk-victim')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      // Critical: the events finder is never called when ownership fails.
      expect(events).not.toHaveBeenCalled();
    });

    it('returns events mapped to the BookingTimelineEvent shape', async () => {
      const evt: BookingEvent = {
        id: 'bevt-1',
        bookingId: 'bk-1',
        actorUserId: 'user-1',
        type: 'BOOKING_CREATED',
        metadata: { requestId: 'req-1', bidId: 'bid-1', providerId: 'pp-1' },
        createdAt: new Date('2026-04-28T02:00:00.000Z'),
      };
      const m = makeMocks({
        events: { listForBooking: jest.fn().mockResolvedValue([evt]), create: jest.fn() },
      });
      const out = await makeService(m).timeline('user-1', 'bk-1');
      expect(out.items).toHaveLength(1);
      expect(out.items[0]).toEqual({
        id: 'bevt-1',
        type: 'BOOKING_CREATED',
        metadata: { requestId: 'req-1', bidId: 'bid-1', providerId: 'pp-1' },
        createdAt: '2026-04-28T02:00:00.000Z',
      });
      // actorUserId is intentionally NOT exposed on the wire.
      expect(out.items[0]).not.toHaveProperty('actorUserId');
    });
  });

  // ─── cancel ────────────────────────────────────────────────────────────
  describe('cancel', () => {
    it('SCHEDULED → CANCELLED writes status flip + BOOKING_CANCELLED event', async () => {
      const reloaded = makeBooking({ status: 'CANCELLED' as BookingStatus });
      const findOwned = jest
        .fn()
        .mockResolvedValueOnce(makeBooking())
        .mockResolvedValueOnce(reloaded);
      const m = makeMocks({
        bookings: {
          findOwned,
          setStatusOwned: jest.fn().mockResolvedValue({ count: 1 }),
        },
      });
      const out = await makeService(m).cancel('user-1', 'bk-1');
      expect(m.bookings.setStatusOwned).toHaveBeenCalledWith(
        'bk-1',
        'user-1',
        ['SCHEDULED'],
        'CANCELLED',
        undefined,
      );
      expect(m.events.create).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: 'bk-1',
          actorUserId: 'user-1',
          type: 'BOOKING_CANCELLED',
        }),
        undefined,
      );
      // Sprint 7.x — provider profile in the default fixture has
      // userId: null, so no notification recipient. The seeker
      // self-notification (echo) was removed in this sprint.
      expect(m.notifications.createForUser).not.toHaveBeenCalled();
      expect(out.status).toBe('CANCELLED');
    });

    // Sprint 7.x — provider-side notification when the provider profile
    // has a linked userId. Body / metadata mirror the provider-cancel
    // path so the provider's notification drawer treats the row
    // uniformly regardless of who initiated.
    it('notifies the PROVIDER (not the seeker self) when the provider has a linked userId', async () => {
      const linkedProvider = makeProvider({ userId: 'user-prov-1' });
      const owned = { ...makeBooking(), provider: linkedProvider } as BookingWithRelations;
      const reloaded = {
        ...makeBooking({ status: 'CANCELLED' as BookingStatus }),
        provider: linkedProvider,
      } as BookingWithRelations;
      const m = makeMocks({
        bookings: {
          findOwned: jest.fn().mockResolvedValueOnce(owned).mockResolvedValueOnce(reloaded),
          setStatusOwned: jest.fn().mockResolvedValue({ count: 1 }),
        },
      });
      await makeService(m).cancel('user-1', 'bk-1');
      // Exactly ONE notification — and it goes to the PROVIDER.
      expect(m.notifications.createForUser).toHaveBeenCalledTimes(1);
      expect(m.notifications.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-prov-1',
          type: 'BOOKING_CANCELLED',
          resourceType: 'BOOKING',
          resourceId: 'bk-1',
          deepLink: '/provider/bookings/bk-1',
          metadata: expect.objectContaining({
            bookingId: 'bk-1',
            requestId: 'req-1',
            cancelledBy: 'seeker',
          }),
          actorUserId: 'user-1',
        }),
        undefined,
      );
    });

    // Sprint 7.x — POST-COMMIT realtime fan-out. Both parties receive
    // booking.status_changed; envelope's actorUserId silences UX on
    // the seeker's own tabs while the provider gets toast + sound.
    it('publishes booking.status_changed to BOTH seeker and provider (with actor metadata)', async () => {
      const linkedProvider = makeProvider({ userId: 'user-prov-1' });
      const owned = { ...makeBooking(), provider: linkedProvider } as BookingWithRelations;
      const reloaded = {
        ...makeBooking({ status: 'CANCELLED' as BookingStatus }),
        provider: linkedProvider,
      } as BookingWithRelations;
      const m = makeMocks({
        bookings: {
          findOwned: jest.fn().mockResolvedValueOnce(owned).mockResolvedValueOnce(reloaded),
          setStatusOwned: jest.fn().mockResolvedValue({ count: 1 }),
        },
      });
      await makeService(m).cancel('user-1', 'bk-1');
      const expectedPayload = expect.objectContaining({
        bookingId: 'bk-1',
        requestId: 'req-1',
        from: 'SCHEDULED',
        to: 'CANCELLED',
        actorUserId: 'user-1',
        actorRole: 'SEEKER',
      });
      const expectedMeta = { actorUserId: 'user-1' };
      expect(m.realtime.publishFor).toHaveBeenCalledWith(
        'user-1',
        'booking.status_changed',
        expectedPayload,
        expectedMeta,
      );
      expect(m.realtime.publishFor).toHaveBeenCalledWith(
        'user-prov-1',
        'booking.status_changed',
        expectedPayload,
        expectedMeta,
      );
    });

    it('skips the provider notification when the provider profile has no linked userId', async () => {
      // Default fixture provider has userId: null — the unlinked
      // (legacy seed) case. The seeker still receives realtime
      // invalidation; the provider has no surface to deliver to.
      const m = makeMocks({
        bookings: {
          findOwned: jest
            .fn()
            .mockResolvedValueOnce(makeBooking())
            .mockResolvedValueOnce(makeBooking({ status: 'CANCELLED' as BookingStatus })),
          setStatusOwned: jest.fn().mockResolvedValue({ count: 1 }),
        },
      });
      await makeService(m).cancel('user-1', 'bk-1');
      expect(m.notifications.createForUser).not.toHaveBeenCalled();
      // Seeker still gets the realtime publish for cross-tab cache
      // invalidation.
      expect(m.realtime.publishFor).toHaveBeenCalledWith(
        'user-1',
        'booking.status_changed',
        expect.any(Object),
        { actorUserId: 'user-1' },
      );
      // Exactly ONE publish — no provider recipient.
      expect(m.realtime.publishFor).toHaveBeenCalledTimes(1);
    });

    it('rejects with NOT_FOUND on a foreign bookingId (no event or notification written)', async () => {
      const m = makeMocks({
        bookings: {
          findOwned: jest.fn().mockResolvedValue(null),
          setStatusOwned: jest.fn(),
        },
      });
      await expect(makeService(m).cancel('user-attacker', 'bk-victim')).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(m.bookings.setStatusOwned).not.toHaveBeenCalled();
      expect(m.events.create).not.toHaveBeenCalled();
      expect(m.notifications.createForUser).not.toHaveBeenCalled();
    });

    it('rejects with CONFLICT on a CANCELLED booking (idempotent rejection)', async () => {
      const m = makeMocks({
        bookings: {
          findOwned: jest
            .fn()
            .mockResolvedValue(makeBooking({ status: 'CANCELLED' as BookingStatus })),
          setStatusOwned: jest.fn(),
        },
      });
      await expect(makeService(m).cancel('user-1', 'bk-1')).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
      });
      expect(m.bookings.setStatusOwned).not.toHaveBeenCalled();
    });

    it('rejects with CONFLICT on IN_PROGRESS / COMPLETED (out of slice 2.3 scope)', async () => {
      for (const status of ['IN_PROGRESS', 'COMPLETED'] as BookingStatus[]) {
        const m = makeMocks({
          bookings: {
            findOwned: jest.fn().mockResolvedValue(makeBooking({ status })),
            setStatusOwned: jest.fn(),
          },
        });
        await expect(makeService(m).cancel('user-1', 'bk-1')).rejects.toMatchObject({
          code: 'CONFLICT',
        });
      }
    });

    it('rejects with CONFLICT on a status race (setStatusOwned returns count: 0)', async () => {
      const m = makeMocks({
        bookings: {
          findOwned: jest.fn().mockResolvedValue(makeBooking()),
          setStatusOwned: jest.fn().mockResolvedValue({ count: 0 }),
        },
      });
      await expect(makeService(m).cancel('user-1', 'bk-1')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      // Event is NOT written when the flip didn't actually fire.
      expect(m.events.create).not.toHaveBeenCalled();
    });
  });

  // ─── error contract ────────────────────────────────────────────────────
  it('throws AppError on every error path (no raw Prisma errors leak)', async () => {
    const m = makeMocks({
      bookings: {
        findOwned: jest.fn().mockResolvedValue(null),
        setStatusOwned: jest.fn(),
      },
    });
    const svc = makeService(m);
    await Promise.all([
      expect(svc.detail('u', 'b')).rejects.toBeInstanceOf(AppError),
      expect(svc.timeline('u', 'b')).rejects.toBeInstanceOf(AppError),
      expect(svc.cancel('u', 'b')).rejects.toBeInstanceOf(AppError),
    ]);
  });
});
