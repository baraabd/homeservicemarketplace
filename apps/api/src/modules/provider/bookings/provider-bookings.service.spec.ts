import type {
  Bid,
  Booking,
  BookingEvent,
  BookingStatus,
  ProviderProfile,
  ServiceCategory,
  ServiceRequest,
} from '@homeservicemarketplace/database';

import type { BookingEventRepository } from '../../../infrastructure/persistence/bookings/booking-event.repository';
import type {
  BookingRepository,
  BookingWithProviderRelations,
} from '../../../infrastructure/persistence/bookings/booking.repository';
import type { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { RealtimeEventsPublisher } from '../../realtime/realtime-events.publisher';
import { ProviderBookingsService } from './provider-bookings.service';

function makeTx(): TransactionRunner {
  return {
    run: <T>(fn: (tx: undefined) => Promise<T>) => fn(undefined),
  } as unknown as TransactionRunner;
}

function makeProfile(over: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'pp-1',
    userId: 'user-provider-1',
    displayName: 'Ada L.',
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
    availability: 'ONLINE',
    status: 'ACTIVE',
    createdAt: new Date('2026-04-30T00:00:00Z'),
    updatedAt: new Date('2026-04-30T00:00:00Z'),
    deletedAt: null,
    ...over,
  } as ProviderProfile;
}

function makeBookingRow(
  status: BookingStatus = 'SCHEDULED',
  over: Partial<Booking> = {},
): BookingWithProviderRelations {
  const profile = makeProfile();
  const date = new Date('2026-05-02T10:00:00Z');
  return {
    id: 'bk-1',
    requestId: 'req-1',
    bidId: 'bid-1',
    seekerUserId: 'user-seeker-1',
    providerId: profile.id,
    status,
    scheduledAt: date,
    priceAmount: 4500,
    currency: 'USD',
    createdAt: date,
    updatedAt: date,
    deletedAt: null,
    ...over,
    request: {
      id: 'req-1',
      seekerUserId: 'user-seeker-1',
      categoryId: 'cat-plumbing',
      customServiceText: null,
      description: 'Leaky kitchen sink',
      mediaUrls: [],
      status: 'BID_ACCEPTED',
      scheduleType: 'LATER',
      scheduledAt: date,
      addressId: null,
      addressSnapshot: {
        label: 'Home',
        line1: '7 Main St',
        city: 'Riyadh',
        country: 'SA',
        lat: null,
        lng: null,
      },
      createdAt: date,
      updatedAt: date,
      deletedAt: null,
      category: {
        id: 'cat-plumbing',
        slug: 'plumbing',
        labelEn: 'Plumbing',
        labelAr: 'سباكة',
        icon: '🔧',
        sortOrder: 1,
        isActive: true,
        createdAt: date,
        updatedAt: date,
        deletedAt: null,
      } as ServiceCategory,
    } as ServiceRequest & { category: ServiceCategory | null },
    bid: {
      id: 'bid-1',
      requestId: 'req-1',
      providerId: profile.id,
      amount: 4500,
      currency: 'USD',
      pricingType: 'HOURLY',
      note: 'I can be there in 20 minutes',
      status: 'ACCEPTED',
      responseTimeMinutes: 30,
      badge: null,
      submittedAt: date,
      createdAt: date,
      updatedAt: date,
      deletedAt: null,
    } as Bid,
    provider: profile,
    seeker: { id: 'user-seeker-1', firstName: 'Ahmed' },
  } as BookingWithProviderRelations;
}

interface Mocks {
  providers: ProviderProfileRepository;
  bookings: BookingRepository;
  events: BookingEventRepository;
  notifications: NotificationsService;
  realtime: RealtimeEventsPublisher;
}

function makeMocks(
  args: {
    profile?: ProviderProfile | null;
    ownedRow?: BookingWithProviderRelations | null;
    setStatusCount?: number;
    reloadedRow?: BookingWithProviderRelations | null;
    listRows?: BookingWithProviderRelations[];
  } = {},
): Mocks {
  const profile = args.profile === undefined ? makeProfile() : args.profile;
  const owned = args.ownedRow === undefined ? makeBookingRow() : args.ownedRow;
  const reload = args.reloadedRow === undefined ? owned : args.reloadedRow;
  const setCount = args.setStatusCount ?? 1;
  // findOwnedByProvider is called twice in transition (pre + post flip).
  // First call returns the original row; subsequent calls return the
  // post-flip row when supplied.
  let call = 0;
  return {
    providers: {
      findByUserId: jest.fn().mockResolvedValue(profile),
    } as unknown as ProviderProfileRepository,
    bookings: {
      listForProvider: jest.fn().mockResolvedValue(args.listRows ?? []),
      findOwnedByProvider: jest.fn().mockImplementation(() => {
        call += 1;
        return Promise.resolve(call === 1 ? owned : reload);
      }),
      setStatusOwnedByProvider: jest.fn().mockResolvedValue({ count: setCount }),
    } as unknown as BookingRepository,
    events: {
      create: jest.fn().mockResolvedValue(undefined),
      listForBooking: jest.fn().mockResolvedValue([] as BookingEvent[]),
    } as unknown as BookingEventRepository,
    notifications: {
      createForUser: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService,
    realtime: {
      publishFor: jest.fn(),
      publish: jest.fn(),
      publishToRoom: jest.fn(),
    } as unknown as RealtimeEventsPublisher,
  };
}

function makeService(m: Mocks): ProviderBookingsService {
  return new ProviderBookingsService(
    m.providers,
    m.bookings,
    m.events,
    m.notifications,
    makeTx(),
    m.realtime,
  );
}

describe('ProviderBookingsService', () => {
  describe('list', () => {
    it('returns the cursor-paginated page scoped to the provider', async () => {
      const a = makeBookingRow('SCHEDULED', { id: 'a' });
      const b = makeBookingRow('IN_PROGRESS', { id: 'b' });
      const mocks = makeMocks({ listRows: [a, b] });
      const out = await makeService(mocks).list('user-provider-1', { limit: 50 });
      expect(out.items.map((i) => i.id)).toEqual(['a', 'b']);
      expect(out.nextCursor).toBeNull();
      expect(out.items[0].seeker.firstName).toBe('Ahmed');
    });

    it('emits nextCursor when more rows than the page size exist', async () => {
      const rows = ['a', 'b', 'c'].map((id) => makeBookingRow('SCHEDULED', { id }));
      const mocks = makeMocks({ listRows: rows });
      const out = await makeService(mocks).list('user-provider-1', { limit: 2 });
      expect(out.items.map((i) => i.id)).toEqual(['a', 'b']);
      expect(out.nextCursor).toBe('b');
    });

    it('returns 404 if the provider profile vanished', async () => {
      const mocks = makeMocks({ profile: null });
      await expect(makeService(mocks).list('user-provider-1', {})).rejects.toMatchObject({
        status: 404,
        code: 'NOT_FOUND',
      });
    });
  });

  describe('detail', () => {
    it('returns the eager-loaded detail when owned', async () => {
      const mocks = makeMocks({ ownedRow: makeBookingRow('SCHEDULED') });
      const out = await makeService(mocks).detail('user-provider-1', 'bk-1');
      expect(out.id).toBe('bk-1');
      expect(out.seeker.firstName).toBe('Ahmed');
      expect(out.addressSnapshot.line1).toBe('7 Main St');
    });

    it('returns 404 if the booking is not owned by the provider', async () => {
      const mocks = makeMocks({ ownedRow: null });
      await expect(
        makeService(mocks).detail('user-provider-1', 'bk-foreign'),
      ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
    });
  });

  describe('start (SCHEDULED → IN_PROGRESS)', () => {
    it('flips status, emits event, and writes a BOOKING_IN_PROGRESS notification to the seeker (Sprint 7.x)', async () => {
      const owned = makeBookingRow('SCHEDULED');
      const reloaded = makeBookingRow('IN_PROGRESS');
      const mocks = makeMocks({ ownedRow: owned, reloadedRow: reloaded });
      const out = await makeService(mocks).start('user-provider-1', 'bk-1');
      expect(out.booking.status).toBe('IN_PROGRESS');
      expect(mocks.bookings.setStatusOwnedByProvider).toHaveBeenCalledWith(
        'bk-1',
        'pp-1',
        ['SCHEDULED'],
        'IN_PROGRESS',
        undefined,
      );
      expect(mocks.events.create).toHaveBeenCalledTimes(1);
      // Sprint 7.x — start now writes a seeker notification so the
      // polling fallback can surface an "In Progress" toast even when
      // the realtime socket is offline.
      expect(mocks.notifications.createForUser).toHaveBeenCalledTimes(1);
      expect(mocks.notifications.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-seeker-1',
          type: 'BOOKING_IN_PROGRESS',
          resourceType: 'BOOKING',
          resourceId: 'bk-1',
          deepLink: '/home/bookings/bk-1',
          actorUserId: 'user-provider-1',
          metadata: expect.objectContaining({
            requestId: 'req-1',
            bookingId: 'bk-1',
            from: 'SCHEDULED',
            to: 'IN_PROGRESS',
          }),
        }),
        undefined,
      );
    });

    // Sprint 7.5.1 — booking.status_changed realtime fan-out.
    // Sprint 7.6 — every publish carries the actor metadata so the
    // envelope anti-echo gate can silence UX on the provider's tabs.
    it('publishes booking.status_changed to BOTH seeker and provider after a successful start, with actor metadata', async () => {
      const owned = makeBookingRow('SCHEDULED');
      const reloaded = makeBookingRow('IN_PROGRESS');
      const mocks = makeMocks({ ownedRow: owned, reloadedRow: reloaded });
      await makeService(mocks).start('user-provider-1', 'bk-1');
      // Two publishes — seeker + provider.
      expect(mocks.realtime.publishFor).toHaveBeenCalledTimes(2);
      const expectedPayload = {
        bookingId: 'bk-1',
        requestId: 'req-1',
        bidId: 'bid-1',
        from: 'SCHEDULED',
        to: 'IN_PROGRESS',
        actorUserId: 'user-provider-1',
        actorRole: 'PROVIDER',
      };
      const expectedMeta = { actorUserId: 'user-provider-1' };
      expect(mocks.realtime.publishFor).toHaveBeenNthCalledWith(
        1,
        'user-seeker-1',
        'booking.status_changed',
        expectedPayload,
        expectedMeta,
      );
      expect(mocks.realtime.publishFor).toHaveBeenNthCalledWith(
        2,
        'user-provider-1',
        'booking.status_changed',
        expectedPayload,
        expectedMeta,
      );
    });

    it('rejects starting an IN_PROGRESS booking with 409', async () => {
      const mocks = makeMocks({ ownedRow: makeBookingRow('IN_PROGRESS') });
      await expect(makeService(mocks).start('user-provider-1', 'bk-1')).rejects.toMatchObject({
        status: 409,
        code: 'CONFLICT',
      });
      // Invalid transition MUST NOT publish.
      expect(mocks.realtime.publishFor).not.toHaveBeenCalled();
    });

    it('rejects with 409 on race-loss (setStatus returns count: 0)', async () => {
      const mocks = makeMocks({
        ownedRow: makeBookingRow('SCHEDULED'),
        setStatusCount: 0,
      });
      await expect(makeService(mocks).start('user-provider-1', 'bk-1')).rejects.toMatchObject({
        status: 409,
        code: 'CONFLICT',
      });
      // Race-loss must not leak a realtime event either — the
      // post-commit publish only fires when the transaction settles.
      expect(mocks.realtime.publishFor).not.toHaveBeenCalled();
    });
  });

  describe('complete (IN_PROGRESS → COMPLETED)', () => {
    it('flips status, emits event, and notifies the seeker', async () => {
      const owned = makeBookingRow('IN_PROGRESS');
      const reloaded = makeBookingRow('COMPLETED');
      const mocks = makeMocks({ ownedRow: owned, reloadedRow: reloaded });
      const out = await makeService(mocks).complete('user-provider-1', 'bk-1');
      expect(out.booking.status).toBe('COMPLETED');
      expect(mocks.notifications.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-seeker-1',
          type: 'BOOKING_COMPLETED',
          resourceType: 'BOOKING',
          resourceId: 'bk-1',
        }),
        undefined,
      );
    });

    // Sprint 7.5.1 — complete publishes the realtime event AND keeps
    // the existing BOOKING_COMPLETED notification. The two channels
    // are independent: the notification persists, the realtime event
    // is a transient delivery hint.
    // Sprint 7.6 — notification goes ONLY to the seeker (non-actor)
    // and threads actorUserId so the seeker's bridge knows the
    // provider did this; cache invalidation still runs on the
    // provider's tabs but UX is silenced there.
    it('publishes booking.status_changed (preserving the notification) on complete, with actor metadata', async () => {
      const owned = makeBookingRow('IN_PROGRESS');
      const reloaded = makeBookingRow('COMPLETED');
      const mocks = makeMocks({ ownedRow: owned, reloadedRow: reloaded });
      await makeService(mocks).complete('user-provider-1', 'bk-1');
      expect(mocks.realtime.publishFor).toHaveBeenCalledTimes(2);
      expect(mocks.realtime.publishFor).toHaveBeenCalledWith(
        'user-seeker-1',
        'booking.status_changed',
        expect.objectContaining({ from: 'IN_PROGRESS', to: 'COMPLETED' }),
        { actorUserId: 'user-provider-1' },
      );
      // Seeker-only notification — provider does NOT receive a
      // self-notification for an action they triggered. Sprint 7.x —
      // metadata carries `from` + `to` + `bookingId` so the frontend
      // status-normalizer can derive the lifecycle status from this
      // notification.created event WITHOUT needing the paired
      // booking.status_changed (the polling fallback path).
      expect(mocks.notifications.createForUser).toHaveBeenCalledTimes(1);
      expect(mocks.notifications.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-seeker-1',
          type: 'BOOKING_COMPLETED',
          actorUserId: 'user-provider-1',
          metadata: expect.objectContaining({
            requestId: 'req-1',
            bookingId: 'bk-1',
            from: 'IN_PROGRESS',
            to: 'COMPLETED',
          }),
        }),
        undefined,
      );
    });

    it('rejects completing a SCHEDULED booking with 409', async () => {
      const mocks = makeMocks({ ownedRow: makeBookingRow('SCHEDULED') });
      await expect(makeService(mocks).complete('user-provider-1', 'bk-1')).rejects.toMatchObject({
        status: 409,
        code: 'CONFLICT',
      });
      expect(mocks.realtime.publishFor).not.toHaveBeenCalled();
    });
  });

  describe('cancel (SCHEDULED → CANCELLED)', () => {
    it('flips status, emits event, and notifies the seeker', async () => {
      const owned = makeBookingRow('SCHEDULED');
      const reloaded = makeBookingRow('CANCELLED');
      const mocks = makeMocks({ ownedRow: owned, reloadedRow: reloaded });
      const out = await makeService(mocks).cancel('user-provider-1', 'bk-1');
      expect(out.booking.status).toBe('CANCELLED');
      expect(mocks.notifications.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'BOOKING_CANCELLED' }),
        undefined,
      );
    });

    // Sprint 7.5.1 — cancel publishes realtime + preserves notification.
    // Sprint 7.6 — seeker-only notification; actor metadata threaded.
    it('publishes booking.status_changed (preserving the notification) on cancel, with actor metadata', async () => {
      const owned = makeBookingRow('SCHEDULED');
      const reloaded = makeBookingRow('CANCELLED');
      const mocks = makeMocks({ ownedRow: owned, reloadedRow: reloaded });
      await makeService(mocks).cancel('user-provider-1', 'bk-1');
      expect(mocks.realtime.publishFor).toHaveBeenCalledTimes(2);
      expect(mocks.realtime.publishFor).toHaveBeenCalledWith(
        'user-seeker-1',
        'booking.status_changed',
        expect.objectContaining({ from: 'SCHEDULED', to: 'CANCELLED' }),
        { actorUserId: 'user-provider-1' },
      );
      expect(mocks.realtime.publishFor).toHaveBeenCalledWith(
        'user-provider-1',
        'booking.status_changed',
        expect.objectContaining({ from: 'SCHEDULED', to: 'CANCELLED' }),
        { actorUserId: 'user-provider-1' },
      );
      // Seeker-only notification — no provider self-notification.
      // Sprint 7.x — metadata.to carries the target status so the
      // frontend status-normalizer can resolve "this is a cancel"
      // from the notification alone (polling path).
      expect(mocks.notifications.createForUser).toHaveBeenCalledTimes(1);
      expect(mocks.notifications.createForUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-seeker-1',
          type: 'BOOKING_CANCELLED',
          actorUserId: 'user-provider-1',
          metadata: expect.objectContaining({
            requestId: 'req-1',
            bookingId: 'bk-1',
            from: 'SCHEDULED',
            to: 'CANCELLED',
          }),
        }),
        undefined,
      );
    });

    it('rejects cancelling an IN_PROGRESS booking with 409', async () => {
      const mocks = makeMocks({ ownedRow: makeBookingRow('IN_PROGRESS') });
      await expect(makeService(mocks).cancel('user-provider-1', 'bk-1')).rejects.toMatchObject({
        status: 409,
        code: 'CONFLICT',
      });
      expect(mocks.realtime.publishFor).not.toHaveBeenCalled();
    });

    it('rejects cancelling a COMPLETED booking with 409', async () => {
      const mocks = makeMocks({ ownedRow: makeBookingRow('COMPLETED') });
      await expect(makeService(mocks).cancel('user-provider-1', 'bk-1')).rejects.toMatchObject({
        status: 409,
        code: 'CONFLICT',
      });
      expect(mocks.realtime.publishFor).not.toHaveBeenCalled();
    });
  });

  // Sprint 7.8 — explicit anti-regression. The seeker MUST be a
  // recipient of `booking.status_changed` for EVERY provider-initiated
  // transition; the actor metadata on the envelope MUST be the
  // provider's userId so the seeker's bridge fires UX (non-actor) and
  // the provider's own tabs do not. The same contract is exercised in
  // the per-transition tests above, but this block names the Sprint 7.8
  // requirement directly so a future drift surfaces with the right
  // owning sprint in the failure message.
  describe('Sprint 7.8 anti-regression: seeker is always a booking.status_changed recipient', () => {
    it.each([
      ['start', 'SCHEDULED', 'IN_PROGRESS'] as const,
      ['complete', 'IN_PROGRESS', 'COMPLETED'] as const,
      ['cancel', 'SCHEDULED', 'CANCELLED'] as const,
    ])('%s publishes to seekerUserId with actorUserId=providerUserId', async (method, from, to) => {
      const owned = makeBookingRow(from);
      const reloaded = makeBookingRow(to);
      const mocks = makeMocks({ ownedRow: owned, reloadedRow: reloaded });
      const svc = makeService(mocks);
      // Drive the method by name so the loop covers all three.
      await (svc as unknown as Record<string, (u: string, b: string) => Promise<unknown>>)[method](
        'user-provider-1',
        'bk-1',
      );
      // The seeker MUST receive booking.status_changed with the
      // typed payload + the provider as the actor.
      expect(mocks.realtime.publishFor).toHaveBeenCalledWith(
        'user-seeker-1',
        'booking.status_changed',
        expect.objectContaining({
          from,
          to,
          actorUserId: 'user-provider-1',
          actorRole: 'PROVIDER',
        }),
        { actorUserId: 'user-provider-1' },
      );
    });
  });

  describe('timeline', () => {
    it('returns events when the booking is owned', async () => {
      const mocks = makeMocks({ ownedRow: makeBookingRow('SCHEDULED') });
      (mocks.events.listForBooking as jest.Mock).mockResolvedValue([
        {
          id: 'ev-1',
          bookingId: 'bk-1',
          actorUserId: 'user-provider-1',
          type: 'BOOKING_CREATED',
          metadata: null,
          createdAt: new Date('2026-05-02T10:05:00Z'),
        },
      ]);
      const out = await makeService(mocks).timeline('user-provider-1', 'bk-1');
      expect(out.items).toHaveLength(1);
      expect(out.items[0].type).toBe('BOOKING_CREATED');
    });

    it('returns 404 when the booking is not owned', async () => {
      const mocks = makeMocks({ ownedRow: null });
      await expect(makeService(mocks).timeline('user-provider-1', 'bk-1')).rejects.toMatchObject({
        status: 404,
        code: 'NOT_FOUND',
      });
    });
  });
});
