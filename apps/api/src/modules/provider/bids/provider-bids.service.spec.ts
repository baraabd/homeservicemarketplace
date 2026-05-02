import type {
  Bid,
  ProviderProfile,
  ServiceCategory,
  ServiceRequest,
  ServiceRequestStatus,
} from '@homeservicemarketplace/database';

import type { BidRepository } from '../../../infrastructure/persistence/bids/bid.repository';
import type { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import type {
  ServiceRequestRepository,
  ServiceRequestWithCategory,
} from '../../../infrastructure/persistence/requests/service-request.repository';
import type { ServiceRequestEventRepository } from '../../../infrastructure/persistence/requests/service-request-event.repository';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { NotificationsService } from '../../notifications/notifications.service';
import { ProviderBidsService } from './provider-bids.service';

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

function makeRequest(
  over: Partial<ServiceRequest> = {},
  category: ServiceCategory | null = null,
): ServiceRequestWithCategory {
  return {
    id: 'req-1',
    seekerUserId: 'user-seeker-1',
    categoryId: category?.id ?? null,
    customServiceText: null,
    description: null,
    status: 'OPEN_FOR_BIDS' as ServiceRequestStatus,
    scheduleType: 'ASAP',
    scheduledAt: null,
    addressId: null,
    addressSnapshot: { city: 'Riyadh', country: 'SA' },
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    deletedAt: null,
    category,
    ...over,
  } as unknown as ServiceRequestWithCategory;
}

function makeBid(over: Partial<Bid> = {}): Bid {
  return {
    id: 'bid-1',
    requestId: 'req-1',
    providerId: 'pp-1',
    amount: 4500,
    currency: 'USD',
    pricingType: 'HOURLY',
    note: null,
    status: 'PENDING',
    responseTimeMinutes: 30,
    badge: null,
    submittedAt: new Date('2026-05-01T01:00:00Z'),
    createdAt: new Date('2026-05-01T01:00:00Z'),
    updatedAt: new Date('2026-05-01T01:00:00Z'),
    deletedAt: null,
    ...over,
  } as Bid;
}

interface Mocks {
  providers: ProviderProfileRepository;
  bids: BidRepository;
  requests: ServiceRequestRepository;
  events: ServiceRequestEventRepository;
  notifications: NotificationsService;
}

function makeMocks(
  over: {
    profile?: ProviderProfile | null;
    request?: ServiceRequestWithCategory | null;
    existingActiveBid?: Bid | null;
    createdBid?: Bid;
    ownedBid?: Bid | null;
    setStatusCount?: number;
  } = {},
): Mocks {
  const profile = over.profile === undefined ? makeProfile() : over.profile;
  const request = over.request === undefined ? makeRequest() : over.request;
  const ownedBid = over.ownedBid;
  const setStatusCount = over.setStatusCount ?? 1;
  return {
    providers: {
      findByUserId: jest.fn().mockResolvedValue(profile),
    } as unknown as ProviderProfileRepository,
    bids: {
      findActiveBidForRequest: jest.fn().mockResolvedValue(over.existingActiveBid ?? null),
      createForProvider: jest.fn().mockResolvedValue(over.createdBid ?? makeBid()),
      findOwnedByProvider: jest.fn().mockResolvedValue(ownedBid ?? null),
      setStatusIf: jest.fn().mockResolvedValue({ count: setStatusCount }),
      listForProvider: jest.fn().mockResolvedValue([]),
    } as unknown as BidRepository,
    requests: {
      findById: jest.fn().mockResolvedValue(request),
    } as unknown as ServiceRequestRepository,
    events: {
      create: jest.fn().mockResolvedValue(undefined),
    } as unknown as ServiceRequestEventRepository,
    notifications: {
      createForUser: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService,
  };
}

function makeService(mocks: Mocks): ProviderBidsService {
  return new ProviderBidsService(
    mocks.providers,
    mocks.bids,
    mocks.requests,
    mocks.events,
    mocks.notifications,
    makeTx(),
  );
}

describe('ProviderBidsService.submit', () => {
  it('creates a PENDING bid and notifies the seeker on the happy path', async () => {
    const created = makeBid({ id: 'bid-new' });
    const mocks = makeMocks({ createdBid: created });
    const service = makeService(mocks);

    const out = await service.submit('user-provider-1', {
      requestId: 'req-1',
      amount: 4500,
      pricingType: 'HOURLY',
      note: 'I can be there in 20 minutes',
    });

    expect(out.bid.id).toBe('bid-new');
    expect(out.bid.amount).toBe(4500);
    expect(mocks.bids.createForProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-1',
        providerId: 'pp-1',
        amount: 4500,
        pricingType: 'HOURLY',
      }),
      undefined,
    );
    expect(mocks.notifications.createForUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-seeker-1',
        type: 'BID_RECEIVED',
        resourceType: 'BID',
        resourceId: 'bid-new',
      }),
      undefined,
    );
    expect(mocks.events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-1',
        actorUserId: 'user-provider-1',
        type: 'REQUEST_UPDATED',
      }),
      undefined,
    );
  });

  it('returns 404 if the request does not exist', async () => {
    const mocks = makeMocks({ request: null });
    await expect(
      makeService(mocks).submit('user-provider-1', {
        requestId: 'req-missing',
        amount: 100,
        pricingType: 'HOURLY',
      }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('returns 409 if the request is no longer OPEN_FOR_BIDS', async () => {
    const mocks = makeMocks({
      request: makeRequest({ status: 'BID_ACCEPTED' as ServiceRequestStatus }),
    });
    await expect(
      makeService(mocks).submit('user-provider-1', {
        requestId: 'req-1',
        amount: 100,
        pricingType: 'HOURLY',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('rejects bidding on the provider own request with VALIDATION_ERROR', async () => {
    const mocks = makeMocks({
      request: makeRequest({ seekerUserId: 'user-provider-1' }),
    });
    await expect(
      makeService(mocks).submit('user-provider-1', {
        requestId: 'req-1',
        amount: 100,
        pricingType: 'HOURLY',
      }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('rejects a duplicate active bid (one-active-bid invariant)', async () => {
    const mocks = makeMocks({ existingActiveBid: makeBid() });
    await expect(
      makeService(mocks).submit('user-provider-1', {
        requestId: 'req-1',
        amount: 100,
        pricingType: 'HOURLY',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
  });

  it('returns 404 if the provider profile vanished between guard and service', async () => {
    const mocks = makeMocks({ profile: null });
    await expect(
      makeService(mocks).submit('user-provider-1', {
        requestId: 'req-1',
        amount: 100,
        pricingType: 'HOURLY',
      }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('does not leak seekerUserId on the wire', async () => {
    const mocks = makeMocks({ createdBid: makeBid({ id: 'bid-x' }) });
    const out = await makeService(mocks).submit('user-provider-1', {
      requestId: 'req-1',
      amount: 100,
      pricingType: 'HOURLY',
    });
    const wire = JSON.stringify(out);
    expect(wire).not.toContain('user-seeker-1');
    expect(wire).not.toContain('seekerUserId');
  });
});

describe('ProviderBidsService.withdraw', () => {
  it('flips PENDING → WITHDRAWN and emits a timeline event', async () => {
    const ownedAfter = makeBid({ status: 'WITHDRAWN' });
    // First findOwnedByProvider returns PENDING; second (after flip) returns WITHDRAWN.
    let call = 0;
    const mocks = makeMocks({});
    (mocks.bids.findOwnedByProvider as jest.Mock).mockImplementation(() => {
      call += 1;
      return Promise.resolve(call === 1 ? makeBid({ status: 'PENDING' }) : ownedAfter);
    });
    (mocks.requests.findById as jest.Mock).mockResolvedValue(makeRequest());
    const out = await makeService(mocks).withdraw('user-provider-1', 'bid-1');
    expect(out.bid.status).toBe('WITHDRAWN');
    expect(mocks.bids.setStatusIf).toHaveBeenCalledWith('bid-1', 'PENDING', 'WITHDRAWN', undefined);
    expect(mocks.events.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'REQUEST_UPDATED' }),
      undefined,
    );
  });

  it('returns 404 if the bid is not found / not owned', async () => {
    const mocks = makeMocks({});
    (mocks.bids.findOwnedByProvider as jest.Mock).mockResolvedValue(null);
    await expect(
      makeService(mocks).withdraw('user-provider-1', 'bid-foreign'),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('returns 409 if the bid is already WITHDRAWN', async () => {
    const mocks = makeMocks({});
    (mocks.bids.findOwnedByProvider as jest.Mock).mockResolvedValue(
      makeBid({ status: 'WITHDRAWN' }),
    );
    await expect(makeService(mocks).withdraw('user-provider-1', 'bid-1')).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
    });
  });

  it('returns 409 if the bid is ACCEPTED (terminal — cannot withdraw)', async () => {
    const mocks = makeMocks({});
    (mocks.bids.findOwnedByProvider as jest.Mock).mockResolvedValue(
      makeBid({ status: 'ACCEPTED' }),
    );
    await expect(makeService(mocks).withdraw('user-provider-1', 'bid-1')).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
    });
  });

  it('returns 409 if the conditional setStatus loses the race', async () => {
    const mocks = makeMocks({ setStatusCount: 0 });
    (mocks.bids.findOwnedByProvider as jest.Mock).mockResolvedValue(makeBid({ status: 'PENDING' }));
    await expect(makeService(mocks).withdraw('user-provider-1', 'bid-1')).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
    });
  });
});

describe('ProviderBidsService.list', () => {
  it('returns the cursor-paginated page of my bids', async () => {
    const mocks = makeMocks({});
    const baseDate = new Date('2026-05-01T01:00:00Z');
    const rows = [
      {
        ...makeBid({ id: 'a' }),
        provider: makeProfile(),
        request: {
          id: 'req-a',
          categoryId: null,
          customServiceText: 'Custom service',
          description: null,
          addressSnapshot: { city: 'Riyadh', country: 'SA' },
          category: null,
        },
      },
      {
        ...makeBid({ id: 'b', submittedAt: new Date(baseDate.getTime() - 60_000) }),
        provider: makeProfile(),
        request: {
          id: 'req-b',
          categoryId: 'cat-plumbing',
          customServiceText: null,
          description: 'Pipe leak',
          addressSnapshot: { city: 'Jeddah', country: 'SA' },
          category: { id: 'cat-plumbing', slug: 'plumbing', labelEn: 'Plumbing', labelAr: 'سباكة' },
        },
      },
    ];
    (mocks.bids.listForProvider as jest.Mock).mockResolvedValue(rows);
    const out = await makeService(mocks).list('user-provider-1', { limit: 50 });
    expect(out.items).toHaveLength(2);
    expect(out.items[0].id).toBe('a');
    expect(out.items[1].request.category?.slug).toBe('plumbing');
    expect(out.nextCursor).toBeNull();
  });

  it('emits nextCursor when more rows exist beyond the page', async () => {
    const mocks = makeMocks({});
    const rows = ['a', 'b', 'c'].map((id) => ({
      ...makeBid({ id }),
      provider: makeProfile(),
      request: {
        id: `req-${id}`,
        categoryId: null,
        customServiceText: null,
        description: null,
        addressSnapshot: { city: 'Riyadh', country: 'SA' },
        category: null,
      },
    }));
    (mocks.bids.listForProvider as jest.Mock).mockResolvedValue(rows);
    const out = await makeService(mocks).list('user-provider-1', { limit: 2 });
    expect(out.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(out.nextCursor).toBe('b');
  });
});
