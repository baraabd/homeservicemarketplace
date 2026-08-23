import type {
  ProviderProfileServiceCategory,
  ServiceCategory,
  ServiceRequest,
  User,
} from '@homeservicemarketplace/database';

import type { BidRepository } from '../../../infrastructure/persistence/bids/bid.repository';
import type {
  ProviderProfileRepository,
  ProviderProfileWithCategories,
} from '../../../infrastructure/persistence/bids/provider-profile.repository';
import type {
  ServiceRequestRepository,
  ServiceRequestForProvider,
} from '../../../infrastructure/persistence/requests/service-request.repository';
import type { ServiceCategoryRepository } from '../../../infrastructure/persistence/services/service-category.repository';
import { AvailableRequestsService, computeDistanceKm } from './available-requests.service';

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

function makeProfile(
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

// Default seeker preview. Layla Mansour → "Layla M." on the wire.
// Email / phone / status / passwordHash are NEVER selected from the
// repo so they cannot reach the mapper. The test treats the fixture
// as if the repo applied that projection.
function makeSeeker(over: Partial<Pick<User, 'id' | 'firstName' | 'lastName'>> = {}) {
  return {
    id: 'user-seeker-1',
    firstName: 'Layla',
    lastName: 'Mansour',
    ...over,
  };
}

function makeRequest(
  id: string,
  category: ServiceCategory | null = null,
  over: Partial<ServiceRequest> & {
    seeker?: ReturnType<typeof makeSeeker>;
    addressSnapshotOverrides?: Record<string, unknown>;
  } = {},
): ServiceRequestForProvider {
  const baseDate = new Date('2026-05-01T00:00:00Z');
  const { seeker = makeSeeker(), addressSnapshotOverrides = {}, ...rest } = over;
  return {
    id,
    seekerUserId: seeker.id,
    categoryId: category?.id ?? null,
    customServiceText: null,
    description: 'leak under the sink',
    status: 'OPEN_FOR_BIDS',
    scheduleType: 'ASAP',
    scheduledAt: null,
    addressId: null,
    addressSnapshot: {
      label: 'Home',
      line1: '7 Private Street', // must NOT appear on the wire
      city: 'Riyadh',
      country: 'SA',
      lat: 24.7,
      lng: 46.7,
      ...addressSnapshotOverrides,
    },
    createdAt: baseDate,
    updatedAt: baseDate,
    deletedAt: null,
    category,
    seeker,
    ...rest,
  } as unknown as ServiceRequestForProvider;
}

function makeMocks(
  args: {
    profile?: ProviderProfileWithCategories | null;
    rows?: ServiceRequestForProvider[];
    detailRow?: ServiceRequestForProvider | null;
    bidCounts?: Map<string, number>;
    catalog?: ServiceCategory[];
  } = {},
) {
  return {
    providers: {
      findByUserIdWithCategories: jest
        .fn()
        .mockResolvedValue(args.profile === undefined ? makeProfile([]) : args.profile),
    } as unknown as ProviderProfileRepository,
    requests: {
      listAvailableForProvider: jest.fn().mockResolvedValue(args.rows ?? []),
      findAvailableForProvider: jest
        .fn()
        .mockResolvedValue(args.detailRow === undefined ? null : args.detailRow),
    } as unknown as ServiceRequestRepository,
    bids: {
      countActiveByRequestIds: jest.fn().mockResolvedValue(args.bidCounts ?? new Map()),
    } as unknown as BidRepository,
    categories: {
      findById: jest.fn(
        async (id: string) => (args.catalog ?? []).find((c) => c.id === id) ?? null,
      ),
    } as unknown as ServiceCategoryRepository,
  };
}

function makeService(m: ReturnType<typeof makeMocks>) {
  return new AvailableRequestsService(m.providers, m.requests, m.bids, m.categories);
}

describe('AvailableRequestsService.list', () => {
  it('returns the page + nextCursor with bidsCount', async () => {
    const cat = makeCategory();
    const r1 = makeRequest('r1', cat);
    const r2 = makeRequest('r2', cat);
    const m = makeMocks({
      profile: makeProfile([cat]),
      rows: [r1, r2],
      bidCounts: new Map([
        ['r1', 3],
        ['r2', 0],
      ]),
      catalog: [cat],
    });
    const out = await makeService(m).list('user-provider-1', { limit: 50 });
    expect(out.items).toHaveLength(2);
    expect(out.nextCursor).toBeNull();
    expect(out.items[0]).toMatchObject({ id: 'r1', bidsCount: 3 });
  });

  it('emits nextCursor when more rows exist beyond the page', async () => {
    const cat = makeCategory();
    const rows = ['a', 'b', 'c'].map((id) => makeRequest(id, cat));
    const m = makeMocks({ profile: makeProfile([cat]), rows, catalog: [cat] });
    const out = await makeService(m).list('user-provider-1', { limit: 2 });
    expect(out.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(out.nextCursor).toBe('b');
  });

  it('passes excludeBidsByProviderId so already-bid rows are filtered server-side', async () => {
    const cat = makeCategory();
    const m = makeMocks({ profile: makeProfile([cat]), catalog: [cat] });
    await makeService(m).list('user-provider-1', {});
    expect(m.requests.listAvailableForProvider).toHaveBeenCalledWith(
      expect.objectContaining({ excludeBidsByProviderId: 'pp-provider-1' }),
    );
  });

  it('uses explicit category filter over the implicit profile categories', async () => {
    const plumbing = makeCategory({ id: 'cat-plumbing' });
    const electrical = makeCategory({
      id: 'cat-electrical',
      slug: 'electrical',
      labelEn: 'Electrical',
      labelAr: 'كهرباء',
    });
    const m = makeMocks({
      profile: makeProfile([plumbing]),
      catalog: [plumbing, electrical],
    });
    await makeService(m).list('user-provider-1', { category: 'cat-electrical' });
    expect(m.requests.listAvailableForProvider).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: ['cat-electrical'] }),
    );
  });

  it('falls back to provider categories when no category filter is supplied', async () => {
    const a = makeCategory({ id: 'cat-a' });
    const b = makeCategory({ id: 'cat-b', slug: 'b', labelEn: 'B', labelAr: 'B' });
    const m = makeMocks({ profile: makeProfile([a, b]), catalog: [a, b] });
    await makeService(m).list('user-provider-1', {});
    expect(m.requests.listAvailableForProvider).toHaveBeenCalledWith(
      expect.objectContaining({ categoryIds: ['cat-a', 'cat-b'] }),
    );
  });

  it('rejects an unknown / inactive category with VALIDATION_ERROR', async () => {
    const m = makeMocks({ profile: makeProfile([]), catalog: [] });
    await expect(
      makeService(m).list('user-provider-1', { category: 'cat-bogus' }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('clamps an out-of-bounds limit and asks the repo for take + 1', async () => {
    const cat = makeCategory();
    const m = makeMocks({ profile: makeProfile([cat]), catalog: [cat] });
    await makeService(m).list('user-provider-1', { limit: 9999 });
    expect(m.requests.listAvailableForProvider).toHaveBeenCalledWith(
      expect.objectContaining({ take: 101 }),
    );
  });

  it('strips line1 and seekerUserId from the wire DTO (security projection)', async () => {
    const cat = makeCategory();
    const sensitive = makeRequest('r-secret', cat, {
      seeker: makeSeeker({ id: 'user-seeker-secret' }),
    });
    const m = makeMocks({
      profile: makeProfile([cat]),
      rows: [sensitive],
      catalog: [cat],
    });
    const out = await makeService(m).list('user-provider-1', {});
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

  it('returns 404 if the provider profile vanished post-guard', async () => {
    const m = makeMocks({ profile: null });
    await expect(makeService(m).list('user-provider-1', {})).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  // Sprint 7.x — strict-mode regression tests.
  it('STRICT mode: no provider categories AND no explicit category → empty page (no repo call)', async () => {
    const m = makeMocks({ profile: makeProfile([]), rows: [] });
    const out = await makeService(m).list('user-provider-1', {});
    expect(out).toEqual({ items: [], nextCursor: null });
    expect(m.requests.listAvailableForProvider).not.toHaveBeenCalled();
  });

  it('STRICT mode: provider has no serviceAreaCity AND no explicit `near` → empty page', async () => {
    const cat = makeCategory();
    const profile = makeProfile([cat], { serviceAreaCity: null });
    const m = makeMocks({ profile, rows: [] });
    const out = await makeService(m).list('user-provider-1', {});
    expect(out).toEqual({ items: [], nextCursor: null });
    expect(m.requests.listAvailableForProvider).not.toHaveBeenCalled();
  });

  // Sprint 6 — the repository now takes a ServiceArea, not a bare city
  // string. The normalisation contract is unchanged and still asserted; only
  // the field it arrives in has moved.
  it('STRICT mode: provider profile city is normalised before the repo filter', async () => {
    const cat = makeCategory();
    const profile = makeProfile([cat], { serviceAreaCity: 'Jeddah' });
    const m = makeMocks({ profile, rows: [] });
    await makeService(m).list('user-provider-1', {});
    expect(m.requests.listAvailableForProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceArea: expect.objectContaining({ cityKey: 'jeddah' }),
      }),
    );
  });

  it('STRICT mode: explicit `near` query overrides the provider city (also normalised)', async () => {
    const cat = makeCategory();
    const m = makeMocks({ profile: makeProfile([cat]), rows: [] });
    await makeService(m).list('user-provider-1', { near: 'Mecca' });
    expect(m.requests.listAvailableForProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceArea: expect.objectContaining({ cityKey: 'mecca' }),
      }),
    );
  });

  it('case-insensitive: aleppo / Aleppo / ALEPPO all reach the repo as ONE key', async () => {
    const cat = makeCategory();
    const calls: Array<string | null> = [];
    const m = makeMocks({ profile: makeProfile([cat]), rows: [] });
    (m.requests.listAvailableForProvider as jest.Mock).mockImplementation(
      async (args: { serviceArea: { cityKey: string | null } }) => {
        calls.push(args.serviceArea.cityKey);
        return [];
      },
    );

    for (const casing of ['aleppo', 'Aleppo', 'ALEPPO']) {
      await makeService(m).list('user-provider-1', { near: casing });
    }
    expect(calls).toEqual(['aleppo', 'aleppo', 'aleppo']);
  });

  // Sprint 6 — the radius must actually reach the repository. It was a dead
  // column for a whole sprint precisely because nothing asserted this.
  it('passes the provider service-area centre and radius to the repository', async () => {
    const cat = makeCategory();
    const profile = makeProfile([cat], {
      serviceAreaLat: 36.2021,
      serviceAreaLng: 37.1343,
      serviceAreaRadiusKm: 25,
    });
    const m = makeMocks({ profile, rows: [] });
    await makeService(m).list('user-provider-1', {});
    expect(m.requests.listAvailableForProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceArea: expect.objectContaining({
          lat: 36.2021,
          lng: 37.1343,
          radiusKm: 25,
        }),
      }),
    );
  });

  // A provider who dropped a map pin but never typed a city name is fully
  // onboarded for matching. Under the pre-Sprint-6 city-only check they got
  // an empty feed forever with no indication why.
  it('serves a feed to a provider with coordinates but no city', async () => {
    const cat = makeCategory();
    const profile = makeProfile([cat], {
      serviceAreaCity: null,
      serviceAreaLat: 36.2021,
      serviceAreaLng: 37.1343,
      serviceAreaRadiusKm: 25,
    });
    const m = makeMocks({ profile, rows: [] });
    await makeService(m).list('user-provider-1', {});
    expect(m.requests.listAvailableForProvider).toHaveBeenCalled();
  });

  // The other direction still holds: nothing configured → empty page, never
  // the global feed.
  it('returns an empty page when neither a city nor a service-area centre is set', async () => {
    const cat = makeCategory();
    const profile = makeProfile([cat], {
      serviceAreaCity: null,
      serviceAreaLat: null,
      serviceAreaLng: null,
      serviceAreaRadiusKm: null,
    });
    const m = makeMocks({ profile, rows: [] });
    const res = await makeService(m).list('user-provider-1', {});
    expect(res.items).toEqual([]);
    expect(m.requests.listAvailableForProvider).not.toHaveBeenCalled();
  });

  it('exposes mediaUrls on the wire as `media` (empty array fallback)', async () => {
    const cat = makeCategory();
    const withMedia = makeRequest('r-with-media', cat, {
      mediaUrls: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
    } as Partial<ServiceRequest> & { mediaUrls: string[] });
    const noMedia = makeRequest('r-no-media', cat);
    const m = makeMocks({
      profile: makeProfile([cat]),
      rows: [withMedia, noMedia],
      catalog: [cat],
    });
    const out = await makeService(m).list('user-provider-1', {});
    expect(out.items[0].media).toEqual(['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg']);
    expect(out.items[1].media).toEqual([]);
  });

  // ─── Sprint 7.4 — privacy-safe summary projection ─────────────────────

  it('SHAPE: every summary carries the Sprint 7.4 wire fields (distanceKm, budget, seeker)', async () => {
    const cat = makeCategory();
    const row = makeRequest('r-shape', cat);
    const m = makeMocks({
      profile: makeProfile([cat]),
      rows: [row],
      catalog: [cat],
    });
    const out = await makeService(m).list('user-provider-1', {});
    const dto = out.items[0];
    expect(dto).toHaveProperty('distanceKm');
    expect(dto).toHaveProperty('budget');
    expect(dto.budget).toEqual({
      amountMin: null,
      amountMax: null,
      currency: null,
      label: null,
    });
    expect(dto).toHaveProperty('seeker');
    expect(dto.seeker).toMatchObject({ publicLabel: expect.any(String) });
    // rating is optional-nullable — explicit null today.
    expect(dto.seeker.rating).toBeNull();
  });

  it('SEEKER LABEL: privacy-safe label is first name + last initial', async () => {
    const cat = makeCategory();
    const row = makeRequest('r1', cat, {
      seeker: makeSeeker({ firstName: 'Layla', lastName: 'Mansour' }),
    });
    const m = makeMocks({ profile: makeProfile([cat]), rows: [row], catalog: [cat] });
    const out = await makeService(m).list('user-provider-1', {});
    expect(out.items[0].seeker.publicLabel).toBe('Layla M.');
  });

  it('SEEKER LABEL: missing last name → first name only', async () => {
    const cat = makeCategory();
    const row = makeRequest('r1', cat, {
      seeker: makeSeeker({ firstName: 'Layla', lastName: '' }),
    });
    const m = makeMocks({ profile: makeProfile([cat]), rows: [row], catalog: [cat] });
    const out = await makeService(m).list('user-provider-1', {});
    expect(out.items[0].seeker.publicLabel).toBe('Layla');
  });

  it('SEEKER LABEL: empty first AND last → neutral "Customer" fallback', async () => {
    const cat = makeCategory();
    const row = makeRequest('r1', cat, { seeker: makeSeeker({ firstName: '', lastName: '' }) });
    const m = makeMocks({ profile: makeProfile([cat]), rows: [row], catalog: [cat] });
    const out = await makeService(m).list('user-provider-1', {});
    expect(out.items[0].seeker.publicLabel).toBe('Customer');
  });

  // PRIVACY: no PII field reaches the wire — even when the eager-loaded
  // seeker row carries it, the mapper drops everything except first
  // name + last initial. This pin catches a future mapper change that
  // accidentally spreads `row.seeker`.
  it('PRIVACY: seeker last name / email / phone / userId NEVER appear on the wire', async () => {
    const cat = makeCategory();
    // Use realistic PII-shaped values so a substring leak is obvious.
    const row = makeRequest('r-pii', cat, {
      seeker: makeSeeker({
        id: 'user-seeker-private-cuid-abc123',
        firstName: 'Layla',
        lastName: 'Al-Hashemi-VerySpecific',
      }),
    });
    const m = makeMocks({ profile: makeProfile([cat]), rows: [row], catalog: [cat] });
    const out = await makeService(m).list('user-provider-1', {});
    const wire = JSON.stringify(out);
    expect(wire).not.toContain('user-seeker-private-cuid-abc123');
    expect(wire).not.toContain('Al-Hashemi-VerySpecific');
    // Last initial alone is acceptable — the wire is allowed to ship "A."
    // (the leading letter). The full last name must not appear.
    expect(out.items[0].seeker.publicLabel).toBe('Layla A.');
  });

  it('DISTANCE: null when the provider has no service-area coords', async () => {
    const cat = makeCategory();
    const profile = makeProfile([cat], { serviceAreaLat: null, serviceAreaLng: null });
    const row = makeRequest('r-no-prov', cat); // snapshot HAS coords
    const m = makeMocks({ profile, rows: [row], catalog: [cat] });
    const out = await makeService(m).list('user-provider-1', {});
    expect(out.items[0].distanceKm).toBeNull();
  });

  it('DISTANCE: null when the snapshot has no coords', async () => {
    const cat = makeCategory();
    const profile = makeProfile([cat], { serviceAreaLat: 24.7, serviceAreaLng: 46.7 });
    const row = makeRequest('r-no-snap', cat, {
      addressSnapshotOverrides: { lat: null, lng: null },
    });
    const m = makeMocks({ profile, rows: [row], catalog: [cat] });
    const out = await makeService(m).list('user-provider-1', {});
    expect(out.items[0].distanceKm).toBeNull();
  });

  it('DISTANCE: identical coordinates → 0 km (NOT null — 0 is a real value)', async () => {
    const cat = makeCategory();
    const profile = makeProfile([cat], { serviceAreaLat: 24.7, serviceAreaLng: 46.7 });
    const row = makeRequest('r-zero', cat, {
      addressSnapshotOverrides: { lat: 24.7, lng: 46.7 },
    });
    const m = makeMocks({ profile, rows: [row], catalog: [cat] });
    const out = await makeService(m).list('user-provider-1', {});
    expect(out.items[0].distanceKm).toBe(0);
  });

  it('DISTANCE: computes Haversine between two distinct points and rounds to one decimal', async () => {
    // Reference: Riyadh KKIA (24.9578, 46.6989) → city centre (24.7136, 46.6753)
    // ≈ 27.3 km. The exact value is sensitive to the Earth-radius constant;
    // we accept ±0.3 km to cover both 6371 and 6378.137 conventions.
    const cat = makeCategory();
    const profile = makeProfile([cat], { serviceAreaLat: 24.9578, serviceAreaLng: 46.6989 });
    const row = makeRequest('r-far', cat, {
      addressSnapshotOverrides: { lat: 24.7136, lng: 46.6753 },
    });
    const m = makeMocks({ profile, rows: [row], catalog: [cat] });
    const out = await makeService(m).list('user-provider-1', {});
    const km = out.items[0].distanceKm!;
    expect(km).not.toBeNull();
    expect(km).toBeGreaterThan(25);
    expect(km).toBeLessThan(30);
    // One decimal place — the round() in the helper means the
    // mantissa is always a multiple of 0.1.
    expect(Math.round(km * 10)).toBe(km * 10);
  });

  it('DISTANCE: out-of-range coordinates → null (defensive against malformed snapshot)', async () => {
    const cat = makeCategory();
    const profile = makeProfile([cat], { serviceAreaLat: 24.7, serviceAreaLng: 46.7 });
    const row = makeRequest('r-bad', cat, {
      addressSnapshotOverrides: { lat: 999, lng: 999 },
    });
    const m = makeMocks({ profile, rows: [row], catalog: [cat] });
    const out = await makeService(m).list('user-provider-1', {});
    expect(out.items[0].distanceKm).toBeNull();
  });
});

describe('AvailableRequestsService.detail', () => {
  it('returns the detail when the request is visible to the provider', async () => {
    const cat = makeCategory();
    const row = makeRequest('r1', cat);
    const m = makeMocks({
      profile: makeProfile([cat]),
      detailRow: row,
      bidCounts: new Map([['r1', 2]]),
      catalog: [cat],
    });
    const out = await makeService(m).detail('user-provider-1', 'r1');
    expect(out.id).toBe('r1');
    expect(out.bidsCount).toBe(2);
    // Sprint 7.4 — detail carries the same enriched shape.
    expect(out.seeker.publicLabel).toBe('Layla M.');
    expect(out.budget).toMatchObject({ amountMin: null, amountMax: null });
  });

  it('returns 404 when the request is not visible (foreign / deleted / cancelled / category mismatch / already-bid)', async () => {
    const cat = makeCategory();
    const m = makeMocks({
      profile: makeProfile([cat]),
      detailRow: null,
      catalog: [cat],
    });
    await expect(makeService(m).detail('user-provider-1', 'r-foreign')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('returns 404 when the provider profile is missing', async () => {
    const m = makeMocks({ profile: null });
    await expect(makeService(m).detail('user-provider-1', 'r1')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('passes excludeBidsByProviderId on the detail lookup', async () => {
    const cat = makeCategory();
    const m = makeMocks({
      profile: makeProfile([cat]),
      detailRow: null,
      catalog: [cat],
    });
    await expect(makeService(m).detail('user-provider-1', 'r-foo')).rejects.toMatchObject({
      status: 404,
    });
    expect(m.requests.findAvailableForProvider).toHaveBeenCalledWith(
      'r-foo',
      expect.objectContaining({ excludeBidsByProviderId: 'pp-provider-1' }),
    );
  });
});

// Standalone unit tests for the Haversine helper so the rounding /
// validation branches are pinned independently of the service layer.
describe('computeDistanceKm', () => {
  it('returns null when any coordinate is null', () => {
    expect(computeDistanceKm(null, 46.7, 24.7, 46.7)).toBeNull();
    expect(computeDistanceKm(24.7, null, 24.7, 46.7)).toBeNull();
    expect(computeDistanceKm(24.7, 46.7, null, 46.7)).toBeNull();
    expect(computeDistanceKm(24.7, 46.7, 24.7, null)).toBeNull();
  });

  it('returns null on out-of-range coordinates', () => {
    expect(computeDistanceKm(91, 46.7, 24.7, 46.7)).toBeNull();
    expect(computeDistanceKm(24.7, 181, 24.7, 46.7)).toBeNull();
  });

  it('returns 0 when the two points are identical', () => {
    expect(computeDistanceKm(24.7, 46.7, 24.7, 46.7)).toBe(0);
  });

  it('returns a one-decimal-rounded km value for distinct points', () => {
    const km = computeDistanceKm(24.7136, 46.6753, 24.9578, 46.6989)!;
    expect(km).not.toBeNull();
    expect(Math.round(km * 10)).toBe(km * 10);
  });
});
