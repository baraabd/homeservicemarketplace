/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * Lazy Prisma requires: with RUN_DB_INTEGRATION unset this spec is skipped, and
 * a top-level import would still open the client's pool on every hermetic run.
 * `any` on the Prisma and service handles for the same reason.
 */

export {};

import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';
import { matchServiceArea } from '../../src/shared/geo/service-area';

// K05 — the radius feed must page through EVERY eligible request.
//
// The defect: the repository selected a bounding box, over-fetched a fixed
// ceil(take * 4/pi) + 1 rows, dropped the box corners in memory, and the
// services read any short page as "end of feed" (nextCursor = null). When the
// newest box rows were corners — inside the square, outside the circle — the
// first page came back empty and the eligible requests behind them were
// unreachable. The web Live Jobs screen fetches only that first page.
//
// Fixture (all coordinates synthetic). The centre and city key are this suite's
// own: geo-fanout counts every ACTIVE provider near ITS centre table-wide, and
// a provider here at the same point showed up in its totals.
//
//   - 30 NEWEST rows in the four box corners (≈11.3 km, radius 10 km)
//   - 10 older valid rows well inside the circle
//   - an equal-timestamp block: 4 valid + 4 corner rows sharing one createdAt
//   - city fallback: 2 ungeocoded same-city rows (visible), 1 other-city (not)
//   - one valid row of each excluded kind: soft-deleted, other category,
//     already bid on by this provider, not OPEN_FOR_BIDS, the provider's own
//
// Rows are inserted directly so createdAt is controlled to the millisecond;
// r09-geo-matching already proves the real create path writes the same
// promoted location columns these rows carry.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(240_000);

const CENTRE = { lat: 24.31, lng: 45.07 };
const CITY = 'K05 Synthetic City';
const CITY_KEY = 'k05 synthetic city';
const RADIUS_KM = 10;
const KM_PER_DEGREE = (2 * Math.PI * 6371) / 360;
const T0 = Date.parse('2026-11-01T00:00:00.000Z');

function offset(north: number, east = 0): { lat: number; lng: number } {
  return {
    lat: CENTRE.lat + north / KM_PER_DEGREE,
    lng: CENTRE.lng + east / (KM_PER_DEGREE * Math.cos((CENTRE.lat * Math.PI) / 180)),
  };
}

/** Oracle: spherical law of cosines — not the production Haversine. */
function oracleKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const cosine =
    Math.sin(rad(a.lat)) * Math.sin(rad(b.lat)) +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return 6371 * Math.acos(Math.min(1, Math.max(-1, cosine)));
}

const CORNERS = [
  [8, 8],
  [8, -8],
  [-8, 8],
  [-8, -8],
] as const;

type Kind =
  | 'valid'
  | 'corner'
  | 'city-same'
  | 'city-other'
  | 'soft-deleted'
  | 'other-category'
  | 'already-bid'
  | 'closed'
  | 'own-request';

interface Fixture {
  id: string;
  kind: Kind;
  createdAt: Date;
  point: { lat: number; lng: number } | null;
  city: string;
}
const OTHER_CITY = 'K05 Other City';

d('K05/R09 — radius feed pagination reaches every eligible request (real Postgres)', () => {
  let prisma: any;
  let repo: any;
  let feed: any;
  let legacy: any;
  let findManyCalls = 0;

  const P = fixturePrefix('k05-geopage');
  const SEEKER = `${P}seeker`;
  const PROVIDER_USER = `${P}provider-user`;
  const PROFILE = `${P}profile`;
  const CATEGORY = `${P}category`;
  const OTHER_CATEGORY = `${P}other-category`;
  const AREA = { lat: CENTRE.lat, lng: CENTRE.lng, radiusKm: RADIUS_KM, cityKey: CITY_KEY };

  const fixtures: Fixture[] = [];
  let seq = 0;
  const add = (kind: Kind, createdAtMs: number, point: Fixture['point'], city = CITY) => {
    seq += 1;
    // Zero-padded so id order inside an equal-timestamp block is predictable
    // to the oracle below without trusting the database's collation.
    const id = `${P}r${String(seq).padStart(3, '0')}-${kind}`;
    fixtures.push({ id, kind, createdAt: new Date(createdAtMs), point, city });
  };

  // 10 valid rows, oldest.
  for (let i = 0; i < 10; i += 1) add('valid', T0 + i * 1_000, offset(1 + (i % 8), (i % 3) - 1));
  // Equal-timestamp block, interleaved kinds.
  for (let i = 0; i < 4; i += 1) {
    add('valid', T0 + 50_000, offset(-2 - i, 2));
    add('corner', T0 + 50_000, offset(...(CORNERS[i] as [number, number])));
  }
  // City fallback rows.
  add('city-same', T0 + 60_000, null);
  add('city-other', T0 + 61_000, null, OTHER_CITY);
  add('city-same', T0 + 62_000, null);
  // One valid-looking row of every excluded kind.
  add('soft-deleted', T0 + 70_000, offset(3));
  add('other-category', T0 + 71_000, offset(3));
  add('already-bid', T0 + 72_000, offset(3));
  add('closed', T0 + 73_000, offset(3));
  add('own-request', T0 + 74_000, offset(3));
  // The 30 NEWEST rows are all square corners.
  for (let i = 0; i < 30; i += 1) {
    add('corner', T0 + 100_000 + i * 1_000, offset(...(CORNERS[i % 4] as [number, number])));
  }

  /** Newest first, id desc as the tie-breaker — the repository's order. */
  const byFeedOrder = (a: Fixture, b: Fixture) =>
    b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

  const eligible = (f: Fixture) =>
    f.kind === 'valid' ||
    f.kind === 'city-same' ||
    (f.kind === 'corner' && oracleKm(CENTRE, f.point!) <= RADIUS_KM);
  const expectedOrder = () =>
    fixtures
      .filter(eligible)
      .sort(byFeedOrder)
      .map((f) => f.id);

  let locks: HeldLock | undefined;

  async function wipe(): Promise<void> {
    await prisma.bid.deleteMany({ where: { providerId: PROFILE } });
    await prisma.serviceRequest.deleteMany({
      where: { seekerUserId: { in: [SEEKER, PROVIDER_USER] } },
    });
    await prisma.providerProfile.deleteMany({ where: { id: PROFILE } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: [CATEGORY, OTHER_CATEGORY] } } });
    await prisma.user.deleteMany({ where: { id: { in: [SEEKER, PROVIDER_USER] } } });
  }

  async function insert(f: Fixture): Promise<void> {
    await prisma.serviceRequest.create({
      data: {
        id: f.id,
        seekerUserId: f.kind === 'own-request' ? PROVIDER_USER : SEEKER,
        categoryId: f.kind === 'other-category' ? OTHER_CATEGORY : CATEGORY,
        description: `K05 ${f.kind}`,
        scheduleType: 'ASAP',
        status: f.kind === 'closed' ? 'CANCELLED' : 'OPEN_FOR_BIDS',
        deletedAt: f.kind === 'soft-deleted' ? new Date(T0) : null,
        createdAt: f.createdAt,
        addressSnapshot: {
          line1: '1 Synthetic Street',
          city: f.city,
          country: 'SY',
          cityKey: f.city.toLowerCase(),
          lat: f.point?.lat ?? null,
          lng: f.point?.lng ?? null,
        },
        locationCityKey: f.city.toLowerCase(),
        locationLat: f.point?.lat ?? null,
        locationLng: f.point?.lng ?? null,
      },
    });
  }

  /** Walk the feed to the end, failing loudly on a loop. */
  async function walk(
    page: (cursor: string | undefined) => Promise<{ ids: string[]; nextCursor: string | null }>,
  ): Promise<{ ids: string[]; pages: string[][] }> {
    const ids: string[] = [];
    const pages: string[][] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 200; i += 1) {
      const res = await page(cursor);
      pages.push(res.ids);
      ids.push(...res.ids);
      if (!res.nextCursor) return { ids, pages };
      expect(res.nextCursor).not.toBe(cursor);
      cursor = res.nextCursor;
    }
    throw new Error('feed did not terminate within 200 pages');
  }

  const feedPage = (limit: number) => async (cursor: string | undefined) => {
    const res = await feed.list(PROVIDER_USER, { limit, ...(cursor ? { cursor } : {}) });
    return { ids: res.items.map((i: any) => i.id), nextCursor: res.nextCursor };
  };

  beforeAll(async () => {
    locks = await acquireAdvisoryLocks([
      { resource: 'providerLifecycle' as const, mode: 'shared' as const },
      { resource: 'serviceRequests' as const, mode: 'shared' as const },
    ]);
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    // Count every ServiceRequest.findMany the repository issues: the query
    // budget is part of the contract, not an implementation detail.
    const countingClient = new Proxy(prisma, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver);
        if (key !== 'serviceRequest') return value;
        return new Proxy(value, {
          get(delegate, method, r) {
            const fn = Reflect.get(delegate, method, r);
            if (method !== 'findMany') return fn;
            return (...args: unknown[]) => {
              findManyCalls += 1;
              return fn.apply(delegate, args);
            };
          },
        });
      },
    });
    const prismaSvc = { client: countingClient };

    const {
      ServiceRequestRepository,
    } = require('../../src/infrastructure/persistence/requests/service-request.repository');
    const {
      ProviderProfileRepository,
    } = require('../../src/infrastructure/persistence/bids/provider-profile.repository');
    const { BidRepository } = require('../../src/infrastructure/persistence/bids/bid.repository');
    const {
      ServiceCategoryRepository,
    } = require('../../src/infrastructure/persistence/services/service-category.repository');
    const {
      AvailableRequestsService,
    } = require('../../src/modules/provider/available-requests/available-requests.service');
    const {
      ProviderJobsService,
    } = require('../../src/modules/provider/feed/provider-jobs.service');

    repo = new ServiceRequestRepository(prismaSvc);
    const providers = new ProviderProfileRepository(prismaSvc);
    const bids = new BidRepository(prismaSvc);
    const categories = new ServiceCategoryRepository(prismaSvc);
    feed = new AvailableRequestsService(providers, repo, bids, categories);
    legacy = new ProviderJobsService(providers, repo, bids, categories);

    await wipe();
    for (const id of [SEEKER, PROVIDER_USER]) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@k05-geopage.invalid`,
          passwordHash: 'x',
          firstName: 'K05',
          lastName: 'Fixture',
          status: 'ACTIVE',
        },
      });
    }
    for (const id of [CATEGORY, OTHER_CATEGORY]) {
      await prisma.serviceCategory.create({
        data: {
          id,
          slug: id,
          labelEn: 'K05 category',
          labelAr: 'K05 category',
          icon: 'wrench',
          isActive: true,
          isLeaf: true,
        },
      });
    }
    await prisma.providerProfile.create({
      data: {
        id: PROFILE,
        userId: PROVIDER_USER,
        displayName: 'K05 provider',
        initials: 'K5',
        status: 'ACTIVE',
        serviceAreaCity: CITY,
        serviceAreaCityKey: CITY_KEY,
        serviceAreaLat: CENTRE.lat,
        serviceAreaLng: CENTRE.lng,
        serviceAreaRadiusKm: RADIUS_KM,
        serviceCategories: { create: [{ serviceCategoryId: CATEGORY }] },
      },
    });
    for (const f of fixtures) await insert(f);
    const bidOn = fixtures.find((f) => f.kind === 'already-bid')!;
    await prisma.bid.create({
      data: {
        requestId: bidOn.id,
        providerId: PROFILE,
        amount: 10000,
        currency: 'SAR',
        amountScale: 2,
        pricingType: 'FIXED',
      },
    });
  });

  afterAll(async () => {
    if (prisma) await wipe();
    await locks?.release();
  });

  it('the fixtures sit where the regression says they do', () => {
    const newest30 = [...fixtures].sort(byFeedOrder).slice(0, 30);
    expect(newest30.every((f) => f.kind === 'corner')).toBe(true);
    for (const f of fixtures.filter((x) => x.kind === 'corner')) {
      const km = oracleKm(CENTRE, f.point!);
      expect(km).toBeGreaterThan(RADIUS_KM);
      // Inside the bounding box on both axes.
      expect(Math.abs(f.point!.lat - CENTRE.lat) * KM_PER_DEGREE).toBeLessThan(RADIUS_KM);
    }
    for (const f of fixtures.filter((x) => x.kind === 'valid')) {
      expect(oracleKm(CENTRE, f.point!)).toBeLessThan(RADIUS_KM);
    }
    expect(expectedOrder()).toHaveLength(16);
  });

  it('the first default page holds every eligible request although the 30 newest box rows are corners', async () => {
    const page = await feed.list(PROVIDER_USER, {});
    expect(page.items.map((i: any) => i.id)).toEqual(expectedOrder());
    expect(page.nextCursor).toBeNull();
  });

  it.each([1, 2, 3, 7, 15, 16, 17])(
    'limit %i pages through every eligible request exactly once, in feed order, with only the last page short',
    async (limit) => {
      const { ids, pages } = await walk(feedPage(limit));
      expect(ids).toEqual(expectedOrder());
      expect(new Set(ids).size).toBe(ids.length);
      for (const p of pages.slice(0, -1)) expect(p).toHaveLength(limit);
    },
  );

  it('the legacy jobs feed applies the same geography (it marks, not hides, own bids)', async () => {
    const res = await legacy.listAvailable(PROVIDER_USER, { limit: 100 });
    const bidOn = fixtures.find((f) => f.kind === 'already-bid')!;
    const expected = fixtures
      .filter((f) => eligible(f) || f.kind === 'already-bid')
      .sort(byFeedOrder)
      .map((f) => f.id);
    expect(res.items.map((i: any) => i.id)).toEqual(expected);
    expect(res.items.find((i: any) => i.id === bidOn.id).hasOwnBid).toBe(true);
    expect(res.nextCursor).toBeNull();
  });

  it('feed, detail (and so bid authorization) and fan-out matching agree row by row', async () => {
    const listed = new Set(expectedOrder());
    for (const f of fixtures) {
      const opens = await feed.detail(PROVIDER_USER, f.id).then(
        () => true,
        (e: any) => {
          expect(e).toMatchObject({ status: 404 });
          return false;
        },
      );
      expect({ id: f.id, opens }).toEqual({ id: f.id, opens: listed.has(f.id) });
      // The fan-out decides recipients with the in-memory twin. Category,
      // status and ownership are applied elsewhere there; geography must agree.
      if (['valid', 'corner', 'city-same', 'city-other'].includes(f.kind)) {
        const geo = matchServiceArea(AREA, {
          lat: f.point?.lat ?? null,
          lng: f.point?.lng ?? null,
          cityKey: f.city.toLowerCase(),
        } as never);
        expect({ id: f.id, matches: geo.matches }).toEqual({ id: f.id, matches: listed.has(f.id) });
      }
    }
  });

  it('a scan budget smaller than the run of corners returns a short page with a truthful continuation, never a false end', async () => {
    const args = {
      excludeSeekerUserId: PROVIDER_USER,
      categoryIds: [CATEGORY],
      serviceArea: AREA,
      excludeBidsByProviderId: PROFILE,
      take: 3,
      scan: { batchSize: 5, maxRounds: 2 },
    };
    findManyCalls = 0;
    const first = await repo.listAvailableForProvider(args);
    // 10 rows scanned, all corners: nothing to show yet, but NOT the end.
    expect(first.rows).toEqual([]);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(findManyCalls).toBeLessThanOrEqual(2);

    let pages = 0;
    const { ids } = await walk(async (cursor) => {
      pages += 1;
      findManyCalls = 0;
      const res = await repo.listAvailableForProvider({ ...args, cursor });
      expect(findManyCalls).toBeLessThanOrEqual(2);
      expect(res.rows.length).toBeLessThanOrEqual(3);
      return { ids: res.rows.map((r: any) => r.id), nextCursor: res.nextCursor };
    });
    expect(ids).toEqual(expectedOrder());
    expect(pages).toBeGreaterThan(5);
  });

  it('the default page stays inside its query budget', async () => {
    findManyCalls = 0;
    await feed.list(PROVIDER_USER, { limit: 20 });
    // 50 rows satisfy the SQL prefilter (34 corners, 14 valid, 2 city
    // fallback): exactly one default batch of scanBatchSize(20) = 50. A full
    // batch cannot prove the end, so one more (empty) query does.
    const { scanBatchSize } = require('../../src/shared/geo/service-area.sql');
    expect(scanBatchSize(20)).toBe(50);
    expect(findManyCalls).toBe(2);
    findManyCalls = 0;
    await walk(async (cursor) => {
      const before = findManyCalls;
      const res = await feedPage(1)(cursor);
      const used = findManyCalls - before;
      const { SCAN_MAX_ROUNDS } = require('../../src/shared/geo/service-area.sql');
      expect(used).toBeLessThanOrEqual(SCAN_MAX_ROUNDS);
      return res;
    });
  });

  it('a request created mid-walk neither duplicates nor hides the rows already being paged', async () => {
    const first = await feed.list(PROVIDER_USER, { limit: 4 });
    const late: Fixture = {
      id: `${P}late-valid`,
      kind: 'valid',
      createdAt: new Date(T0 + 500_000),
      point: offset(2),
      city: CITY,
    };
    await insert(late);
    try {
      const rest = await walk(async (cursor) => feedPage(4)(cursor ?? first.nextCursor));
      const seen = [...first.items.map((i: any) => i.id), ...rest.ids];
      // Keyset paging: the newer row belongs to a fresh first page, not this walk.
      expect(seen).toEqual(
        fixtures
          .filter(eligible)
          .sort(byFeedOrder)
          .map((f) => f.id),
      );
      const fresh = await feed.list(PROVIDER_USER, { limit: 1 });
      expect(fresh.items.map((i: any) => i.id)).toEqual([late.id]);
    } finally {
      await prisma.serviceRequest.delete({ where: { id: late.id } });
    }
  });
});
