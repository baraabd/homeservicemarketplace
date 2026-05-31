// Sprint 7.x — `ServiceRequestSummary.activeBooking*` mapper tests.
//
// Pins the contract that ServiceRequestSummary surfaces the latest
// live booking's id / status / updatedAt so the seeker's Active
// Leads carousel renders the booking lifecycle state (e.g.
// "Completed") even after a hard refresh — the parent
// ServiceRequest.status intentionally stays at BID_ACCEPTED across
// booking transitions (cancel/complete do NOT auto-revert it).
//
// This is the "source-of-truth consistency" guarantee called out in
// the sprint prompt: the UI must stay correct after F5, not only
// after a cache patch.

import type {
  Address,
  BookingStatus,
  ServiceCategory,
  ServiceRequestStatus,
} from '@homeservicemarketplace/database';

import type { AddressRepository } from '../../infrastructure/persistence/addresses/address.repository';
import type { ProviderProfileRepository } from '../../infrastructure/persistence/bids/provider-profile.repository';
import type {
  ServiceRequestRepository,
  ServiceRequestWithCategory,
} from '../../infrastructure/persistence/requests/service-request.repository';
import type { ServiceRequestEventRepository } from '../../infrastructure/persistence/requests/service-request-event.repository';
import type { ServiceCategoryRepository } from '../../infrastructure/persistence/services/service-category.repository';
import type { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import type { NotificationsService } from '../notifications/notifications.service';
import type { RealtimeEventsPublisher } from '../realtime/realtime-events.publisher';
import { RequestsService } from './requests.service';

function makeTx(): TransactionRunner {
  return {
    run: <T>(fn: (tx: undefined) => Promise<T>) => fn(undefined),
  } as unknown as TransactionRunner;
}

function makeCategory(): ServiceCategory {
  return {
    id: 'cat-1',
    slug: 'plumbing',
    labelEn: 'Plumbing',
    labelAr: 'سباكة',
    icon: '🔧',
    sortOrder: 0,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
  };
}

function makeAddress(): Address {
  return {
    id: 'addr-1',
    userId: 'user-1',
    label: 'Home',
    type: 'HOME',
    line1: '4 Main St',
    city: 'Riyadh',
    country: 'SA',
    lat: null,
    lng: null,
    isDefault: true,
    createdAt: new Date('2026-04-27T00:00:00Z'),
    updatedAt: new Date('2026-04-27T00:00:00Z'),
    deletedAt: null,
  };
}

function makeRow(
  bookings: { id: string; status: BookingStatus; updatedAt: Date }[] | undefined,
  requestStatus: ServiceRequestStatus = 'BID_ACCEPTED',
): ServiceRequestWithCategory {
  const baseDate = new Date('2026-04-28T00:00:00.000Z');
  return {
    id: 'req-1',
    seekerUserId: 'user-1',
    categoryId: 'cat-1',
    customServiceText: null,
    description: null,
    mediaUrls: [],
    status: requestStatus,
    scheduleType: 'ASAP',
    scheduledAt: null,
    addressId: 'addr-1',
    addressSnapshot: {
      label: 'Home',
      line1: '4 Main St',
      city: 'Riyadh',
      cityKey: 'riyadh',
      country: 'SA',
      lat: null,
      lng: null,
    },
    createdAt: baseDate,
    updatedAt: baseDate,
    deletedAt: null,
    category: makeCategory(),
    bookings,
  } as unknown as ServiceRequestWithCategory;
}

function makeService(rows: ServiceRequestWithCategory[]) {
  return new RequestsService(
    {
      listForSeeker: jest.fn().mockResolvedValue(rows),
      findOwned: jest.fn().mockResolvedValue(rows[0]),
      create: jest.fn(),
      updateOwned: jest.fn(),
      setStatusOwned: jest.fn(),
    } as unknown as ServiceRequestRepository,
    {
      create: jest.fn(),
      listForRequest: jest.fn().mockResolvedValue([]),
    } as unknown as ServiceRequestEventRepository,
    {
      findOwned: jest.fn().mockResolvedValue(makeAddress()),
    } as unknown as AddressRepository,
    {
      findById: jest.fn().mockResolvedValue(makeCategory()),
    } as unknown as ServiceCategoryRepository,
    makeTx(),
    {
      listEligibleUserIdsForRequest: jest.fn().mockResolvedValue([]),
    } as unknown as ProviderProfileRepository,
    { createForUser: jest.fn() } as unknown as NotificationsService,
    { publishFor: jest.fn() } as unknown as RealtimeEventsPublisher,
  );
}

describe('ServiceRequestSummary.activeBooking* — hard-refresh source-of-truth', () => {
  it('surfaces activeBookingId / activeBookingStatus / activeBookingUpdatedAt when a booking exists', async () => {
    const bookingDate = new Date('2026-05-30T14:09:00.000Z');
    const row = makeRow([{ id: 'bk-1', status: 'IN_PROGRESS', updatedAt: bookingDate }]);
    const out = await makeService([row]).list('user-1', {});
    expect(out.items[0]).toMatchObject({
      id: 'req-1',
      // Request itself stays at BID_ACCEPTED — cancel/complete do NOT
      // auto-revert it.
      status: 'BID_ACCEPTED',
      activeBookingId: 'bk-1',
      activeBookingStatus: 'IN_PROGRESS',
      activeBookingUpdatedAt: bookingDate.toISOString(),
    });
  });

  it('emits null activeBooking* when no booking exists yet (request is still OPEN_FOR_BIDS)', async () => {
    const row = makeRow([], 'OPEN_FOR_BIDS');
    const out = await makeService([row]).list('user-1', {});
    expect(out.items[0]).toMatchObject({
      status: 'OPEN_FOR_BIDS',
      activeBookingId: null,
      activeBookingStatus: null,
      activeBookingUpdatedAt: null,
    });
  });

  it('emits null activeBooking* when the bookings array is undefined (legacy / partial includes)', async () => {
    const row = makeRow(undefined);
    const out = await makeService([row]).list('user-1', {});
    expect(out.items[0]).toMatchObject({
      activeBookingId: null,
      activeBookingStatus: null,
      activeBookingUpdatedAt: null,
    });
  });

  it.each(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const)(
    'preserves activeBookingStatus = %s verbatim on the wire',
    async (status) => {
      const row = makeRow([
        { id: 'bk-x', status, updatedAt: new Date('2026-05-30T14:09:00.000Z') },
      ]);
      const out = await makeService([row]).list('user-1', {});
      expect(out.items[0].activeBookingStatus).toBe(status);
    },
  );

  it('detail (findOwned path) also surfaces activeBookingStatus', async () => {
    const row = makeRow([
      { id: 'bk-1', status: 'COMPLETED', updatedAt: new Date('2026-05-30T14:09:00.000Z') },
    ]);
    const out = await makeService([row]).detail('user-1', 'req-1');
    expect(out.activeBookingStatus).toBe('COMPLETED');
  });
});
