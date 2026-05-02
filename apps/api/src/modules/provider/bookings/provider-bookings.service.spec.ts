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
  };
}

function makeService(m: Mocks): ProviderBookingsService {
  return new ProviderBookingsService(m.providers, m.bookings, m.events, m.notifications, makeTx());
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
    it('flips status, emits event, and does NOT send a notification', async () => {
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
      expect(mocks.notifications.createForUser).not.toHaveBeenCalled();
    });

    it('rejects starting an IN_PROGRESS booking with 409', async () => {
      const mocks = makeMocks({ ownedRow: makeBookingRow('IN_PROGRESS') });
      await expect(makeService(mocks).start('user-provider-1', 'bk-1')).rejects.toMatchObject({
        status: 409,
        code: 'CONFLICT',
      });
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

    it('rejects completing a SCHEDULED booking with 409', async () => {
      const mocks = makeMocks({ ownedRow: makeBookingRow('SCHEDULED') });
      await expect(makeService(mocks).complete('user-provider-1', 'bk-1')).rejects.toMatchObject({
        status: 409,
        code: 'CONFLICT',
      });
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

    it('rejects cancelling an IN_PROGRESS booking with 409', async () => {
      const mocks = makeMocks({ ownedRow: makeBookingRow('IN_PROGRESS') });
      await expect(makeService(mocks).cancel('user-provider-1', 'bk-1')).rejects.toMatchObject({
        status: 409,
        code: 'CONFLICT',
      });
    });

    it('rejects cancelling a COMPLETED booking with 409', async () => {
      const mocks = makeMocks({ ownedRow: makeBookingRow('COMPLETED') });
      await expect(makeService(mocks).cancel('user-provider-1', 'bk-1')).rejects.toMatchObject({
        status: 409,
        code: 'CONFLICT',
      });
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
