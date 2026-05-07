import type {
  ProviderProfileServiceCategory,
  ServiceCategory,
  ServiceRequest,
} from '@homeservicemarketplace/database';

import type { BidRepository } from '../../../infrastructure/persistence/bids/bid.repository';
import type {
  ProviderProfileRepository,
  ProviderProfileWithCategories,
} from '../../../infrastructure/persistence/bids/provider-profile.repository';
import type { ServiceCategoryRepository } from '../../../infrastructure/persistence/services/service-category.repository';
import type {
  ServiceRequestRepository,
  ServiceRequestWithCategory,
} from '../../../infrastructure/persistence/requests/service-request.repository';
import { AppError } from '../../../shared/errors/app-error';
import { ProviderJobsService } from './provider-jobs.service';

function makeCategory(over: Partial<ServiceCategory> = {}): ServiceCategory {
  return {
    id: 'cat-plumbing',
    slug: 'plumbing',
    labelEn: 'Plumbing',
    labelAr: 'سباكة',
    icon: '🔧',
    sortOrder: 1,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...over,
  } as ServiceCategory;
}

function makeProviderProfile(
  categories: ServiceCategory[] = [],
  over: Partial<ProviderProfileWithCategories> = {},
): ProviderProfileWithCategories {
  const baseDate = new Date('2026-04-30T00:00:00Z');
  return {
    id: 'pp-provider-1',
    userId: 'user-provider-1',
    displayName: 'Ada Lovelace',
    initials: 'AL',
    avatarUrl: null,
    ratingAvg: 4.7,
    reviewCount: 23,
    completedJobs: 17,
    verified: true,
    topPro: false,
    bio: null,
    headline: null,
    phoneNumber: null,
    serviceAreaCity: 'Riyadh',
    serviceAreaCountry: 'SA',
    serviceAreaLat: null,
    serviceAreaLng: null,
    serviceAreaRadiusKm: 25,
    availability: 'ONLINE',
    status: 'ACTIVE',
    createdAt: baseDate,
    updatedAt: baseDate,
    deletedAt: null,
    serviceCategories: categories.map((c) => ({
      providerProfileId: 'pp-provider-1',
      serviceCategoryId: c.id,
      createdAt: baseDate,
      serviceCategory: c,
    })) as (ProviderProfileServiceCategory & { serviceCategory: ServiceCategory })[],
    ...over,
  } as ProviderProfileWithCategories;
}

function makeRequest(
  id: string,
  over: Partial<ServiceRequest> = {},
  category: ServiceCategory | null = null,
): ServiceRequestWithCategory {
  const baseDate = new Date('2026-05-01T00:00:00Z');
  return {
    id,
    seekerUserId: 'user-seeker-1',
    categoryId: category?.id ?? null,
    customServiceText: null,
    description: null,
    status: 'OPEN_FOR_BIDS',
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
    createdAt: baseDate,
    updatedAt: baseDate,
    deletedAt: null,
    category,
    ...over,
  } as unknown as ServiceRequestWithCategory;
}

function makeProviders(profile: ProviderProfileWithCategories | null): ProviderProfileRepository {
  return {
    findByUserIdWithCategories: jest.fn().mockResolvedValue(profile),
  } as unknown as ProviderProfileRepository;
}

function makeRequests(rows: ServiceRequestWithCategory[]): ServiceRequestRepository {
  return {
    listAvailableForProvider: jest.fn().mockResolvedValue(rows),
  } as unknown as ServiceRequestRepository;
}

function makeBids(
  args: {
    countByRequestId?: Map<string, number>;
    ownBidRequestIds?: Set<string>;
  } = {},
): BidRepository {
  return {
    countActiveByRequestIds: jest.fn().mockResolvedValue(args.countByRequestId ?? new Map()),
    findRequestIdsBidByProvider: jest.fn().mockResolvedValue(args.ownBidRequestIds ?? new Set()),
  } as unknown as BidRepository;
}

function makeCategories(catalog: ServiceCategory[]): ServiceCategoryRepository {
  return {
    findById: jest.fn(async (id: string) => catalog.find((c) => c.id === id) ?? null),
  } as unknown as ServiceCategoryRepository;
}

describe('ProviderJobsService.listAvailable', () => {
  it('returns the cursor-paginated page with bidsCount and hasOwnBid for each row', async () => {
    const cat = makeCategory();
    const profile = makeProviderProfile([cat]);
    const r1 = makeRequest('req-1', {}, cat);
    const r2 = makeRequest('req-2', {}, cat);
    const requests = makeRequests([r1, r2]);
    const bids = makeBids({
      countByRequestId: new Map([
        ['req-1', 3],
        ['req-2', 0],
      ]),
      ownBidRequestIds: new Set(['req-1']),
    });
    const service = new ProviderJobsService(
      makeProviders(profile),
      requests,
      bids,
      makeCategories([cat]),
    );

    const out = await service.listAvailable('user-provider-1', { limit: 10 });

    expect(out.items).toHaveLength(2);
    expect(out.nextCursor).toBeNull();
    expect(out.items[0]).toMatchObject({
      id: 'req-1',
      bidsCount: 3,
      hasOwnBid: true,
      category: { slug: 'plumbing' },
    });
    expect(out.items[1]).toMatchObject({
      id: 'req-2',
      bidsCount: 0,
      hasOwnBid: false,
    });
  });

  it('emits nextCursor when more rows exist beyond the requested page', async () => {
    const cat = makeCategory();
    const profile = makeProviderProfile([cat]);
    // Repository fetches `take + 1` rows; we simulate that here by
    // returning 3 rows for limit=2.
    const rows = ['a', 'b', 'c'].map((id) => makeRequest(id, {}, cat));
    const service = new ProviderJobsService(
      makeProviders(profile),
      makeRequests(rows),
      makeBids(),
      makeCategories([cat]),
    );

    const out = await service.listAvailable('user-provider-1', { limit: 2 });

    expect(out.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(out.nextCursor).toBe('b');
  });

  it('rejects an unknown categoryId filter with VALIDATION_ERROR (no Prisma FK leak)', async () => {
    const cat = makeCategory();
    const profile = makeProviderProfile([cat]);
    const service = new ProviderJobsService(
      makeProviders(profile),
      makeRequests([]),
      makeBids(),
      makeCategories([]), // catalog is empty — any id is unknown
    );

    await expect(
      service.listAvailable('user-provider-1', { categoryId: 'cat-bogus' }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('rejects an inactive categoryId filter with VALIDATION_ERROR', async () => {
    const cat = makeCategory({ id: 'cat-old', isActive: false });
    const profile = makeProviderProfile([]);
    const service = new ProviderJobsService(
      makeProviders(profile),
      makeRequests([]),
      makeBids(),
      makeCategories([cat]),
    );

    await expect(
      service.listAvailable('user-provider-1', { categoryId: 'cat-old' }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('uses the explicit categoryId filter when provided (overrides the implicit profile filter)', async () => {
    const plumbing = makeCategory({ id: 'cat-plumbing' });
    const electrical = makeCategory({
      id: 'cat-electrical',
      slug: 'electrical',
      labelEn: 'Electrical',
      labelAr: 'كهرباء',
    });
    // Profile is configured for plumbing only.
    const profile = makeProviderProfile([plumbing]);
    const requests = makeRequests([]);
    const service = new ProviderJobsService(
      makeProviders(profile),
      requests,
      makeBids(),
      makeCategories([plumbing, electrical]),
    );

    await service.listAvailable('user-provider-1', { categoryId: 'cat-electrical' });

    expect(requests.listAvailableForProvider).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: ['cat-electrical'] }),
    );
  });

  it('falls back to the provider profile categories when no categoryId filter is given', async () => {
    const plumbing = makeCategory({ id: 'cat-plumbing' });
    const cleaning = makeCategory({
      id: 'cat-cleaning',
      slug: 'cleaning',
      labelEn: 'Cleaning',
      labelAr: 'تنظيف',
    });
    const profile = makeProviderProfile([plumbing, cleaning]);
    const requests = makeRequests([]);
    const service = new ProviderJobsService(
      makeProviders(profile),
      requests,
      makeBids(),
      makeCategories([plumbing, cleaning]),
    );

    await service.listAvailable('user-provider-1', {});

    expect(requests.listAvailableForProvider).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: ['cat-plumbing', 'cat-cleaning'] }),
    );
  });

  it('passes the provider userId to the repository as excludeSeekerUserId', async () => {
    const cat = makeCategory();
    const profile = makeProviderProfile([cat]);
    const requests = makeRequests([]);
    const service = new ProviderJobsService(
      makeProviders(profile),
      requests,
      makeBids(),
      makeCategories([cat]),
    );

    await service.listAvailable('user-provider-1', {});

    expect(requests.listAvailableForProvider).toHaveBeenCalledWith(
      expect.objectContaining({ excludeSeekerUserId: 'user-provider-1' }),
    );
  });

  it('clamps an out-of-bounds limit to the repository max (100)', async () => {
    const cat = makeCategory();
    const profile = makeProviderProfile([cat]);
    const requests = makeRequests([]);
    const service = new ProviderJobsService(
      makeProviders(profile),
      requests,
      makeBids(),
      makeCategories([cat]),
    );

    await service.listAvailable('user-provider-1', { limit: 9999 });

    expect(requests.listAvailableForProvider).toHaveBeenCalledWith(
      expect.objectContaining({ take: 101 }),
    );
  });

  it('returns 404 if the provider profile vanished between the guard and the service', async () => {
    const service = new ProviderJobsService(
      makeProviders(null),
      makeRequests([]),
      makeBids(),
      makeCategories([]),
    );

    await expect(service.listAvailable('user-provider-1', {})).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('strips line1 and seekerUserId from the wire DTO (security projection)', async () => {
    const cat = makeCategory();
    const profile = makeProviderProfile([cat]);
    const sensitive = makeRequest(
      'req-secret',
      {
        seekerUserId: 'user-seeker-secret',
        addressSnapshot: {
          label: 'Home',
          line1: '7 Private Street',
          city: 'Riyadh',
          country: 'SA',
          lat: 24.7,
          lng: 46.7,
        },
      },
      cat,
    );
    const service = new ProviderJobsService(
      makeProviders(profile),
      makeRequests([sensitive]),
      makeBids(),
      makeCategories([cat]),
    );

    const out = await service.listAvailable('user-provider-1', {});

    const wire = JSON.stringify(out);
    expect(wire).not.toContain('user-seeker-secret');
    expect(wire).not.toContain('7 Private Street');
    expect(out.items[0].location).toEqual({
      city: 'Riyadh',
      country: 'SA',
      lat: 24.7,
      lng: 46.7,
    });
  });
});
