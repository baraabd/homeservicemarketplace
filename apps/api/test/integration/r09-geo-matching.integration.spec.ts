/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * Lazy Prisma requires: with RUN_DB_INTEGRATION unset this spec is skipped, and
 * a top-level import would still open the client's pool on every hermetic run.
 * `any` on the Prisma and service handles for the same reason.
 */

export {};

import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';
import { exactDistanceKm, haversineKm } from '../../src/shared/geo/service-area';

// R09 — one geographic rule for the feed, the detail, the bid and the
// announcement, proved at its boundaries against real Postgres with the real
// services, repositories, outbox worker and handlers.
//
// The rule (ADR 0003, `shared/geo/service-area.ts`):
//
//   provider has a point and a radius, request has a point
//       -> distance <= radius. The city is not consulted.
//   otherwise
//       -> the normalised city keys must be equal.
//
// Distance is great-circle distance on a 6371 km sphere, compared UNROUNDED
// and inclusively (distance <= radius). The 0.1 km rounding the provider sees
// is display only: a request 10.04 km away reads "10.0 km" nowhere, because a
// 10 km provider cannot see it at all.
//
// The expectations come from an oracle written in this file (the spherical law
// of cosines, a different formula from the production Haversine), so the suite
// does not grade the production function with itself. All coordinates are
// synthetic.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(240_000);

// A synthetic centre in Aleppo and one in Damascus.
const CENTRE = { lat: 36.2, lng: 37.16 };
const DAMASCUS = { lat: 33.51, lng: 36.28 };
const RADIUS_KM = 10;
const KM_PER_DEGREE = (2 * Math.PI * 6371) / 360;

/** A point `north` and `east` kilometres from the centre. */
/** The oracle: spherical law of cosines, unrounded. */
function oracleKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const cosine =
    Math.sin(rad(a.lat)) * Math.sin(rad(b.lat)) +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return 6371 * Math.acos(Math.min(1, Math.max(-1, cosine)));
}

function offset(north: number, east = 0): { lat: number; lng: number } {
  return {
    lat: CENTRE.lat + north / KM_PER_DEGREE,
    lng: CENTRE.lng + east / (KM_PER_DEGREE * Math.cos((CENTRE.lat * Math.PI) / 180)),
  };
}

interface Site {
  key: string;
  city: string;
  point: { lat: number; lng: number } | null;
}

const SITES: Site[] = [
  { key: 'inside-5km', city: 'Aleppo', point: offset(5) },
  { key: 'inside-9.9km', city: 'Aleppo', point: offset(9.9) },
  { key: 'inside-9.99km', city: 'Aleppo', point: offset(9.99) },
  { key: 'outside-10.01km', city: 'Aleppo', point: offset(10.01) },
  // Displays as "10.0 km" when rounded; it is nevertheless outside.
  { key: 'outside-10.04km', city: 'Aleppo', point: offset(10.04) },
  // Inside the bounding box the SQL uses, outside the circle.
  { key: 'box-corner', city: 'Aleppo', point: offset(9, 9) },
  // Labelled with the same city, but far away.
  { key: 'far-same-city-name', city: 'Aleppo', point: offset(300) },
  { key: 'damascus-geocoded', city: 'Damascus', point: DAMASCUS },
  { key: 'aleppo-no-point', city: 'Aleppo', point: null },
  { key: 'damascus-no-point', city: 'Damascus', point: null },
];

d('R09 — geographic matching is one rule on every path (real Postgres)', () => {
  let prisma: any;
  let requests: any;
  let providerBids: any;
  let feed: any;
  let makeWorker: () => { runOnce: () => Promise<number> };

  const P = fixturePrefix('r09-match');
  const SEEKER = `${P}seeker`;
  const CATEGORY = `${P}category`;
  const OTHER_CATEGORY = `${P}other-category`;

  interface Provider {
    user: string;
    profile: string;
    category: string;
    city: string;
    lat: number | null;
    lng: number | null;
    radiusKm: number | null;
  }
  const provider = (key: string, over: Partial<Provider>): Provider => ({
    user: `${P}${key}-user`,
    profile: `${P}${key}`,
    category: CATEGORY,
    city: 'Aleppo',
    lat: CENTRE.lat,
    lng: CENTRE.lng,
    radiusKm: RADIUS_KM,
    ...over,
  });

  const RADIUS = provider('radius', {});
  // The point is in Aleppo; the typed city says Damascus.
  const CITY_DISAGREES = provider('disagrees', { city: 'Damascus' });
  const CITY_ONLY = provider('cityonly', { lat: null, lng: null, radiusKm: null });
  // A point without a radius is not a service area.
  const NO_RADIUS = provider('noradius', { radiusKm: null });
  const WRONG_CATEGORY = provider('wrongcat', { category: OTHER_CATEGORY });
  const PROVIDERS = [RADIUS, CITY_DISAGREES, CITY_ONLY, NO_RADIUS, WRONG_CATEGORY];
  const USERS = [SEEKER, ...PROVIDERS.map((p) => p.user)];

  /** The rule, restated from the ADR in the test's own words. */
  function expected(p: Provider, site: Site): boolean {
    if (p.category !== CATEGORY) return false;
    const usesRadius = p.lat !== null && p.lng !== null && p.radiusKm !== null;
    if (usesRadius && site.point) {
      return oracleKm({ lat: p.lat as number, lng: p.lng as number }, site.point) <= p.radiusKm!;
    }
    return p.city.toLowerCase() === site.city.toLowerCase();
  }

  const requestIds = new Map<string, string>();
  const idOf = (key: string) => requestIds.get(key) as string;
  let locks: HeldLock | undefined;

  const announcements = (userId: string, requestId: string) =>
    prisma.notification.count({
      where: { userId, type: 'REQUEST_AVAILABLE', resourceId: requestId },
    });

  async function listedIds(p: Provider): Promise<string[]> {
    const page = await feed.list(p.user, { limit: 100 });
    return page.items.map((i: any) => i.id);
  }
  async function opens(p: Provider, requestId: string): Promise<boolean> {
    return feed.detail(p.user, requestId).then(
      () => true,
      (e: any) => {
        expect(e).toMatchObject({ status: 404 });
        return false;
      },
    );
  }

  async function drain(): Promise<void> {
    const worker = makeWorker();
    for (let i = 0; i < 40; i += 1) {
      const claimed = await worker.runOnce();
      if (claimed === 0) {
        const due = await prisma.outboxEvent.count({ where: { status: 'PENDING' } });
        if (due === 0) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    throw new Error('outbox did not drain');
  }

  async function wipe(): Promise<void> {
    const owned = await prisma.serviceRequest.findMany({
      where: { seekerUserId: SEEKER },
      select: { id: true },
    });
    const ids = owned.map((r: { id: string }) => r.id);
    await prisma.outboxHandlerRun
      .deleteMany({
        where: { event: { aggregateType: 'ServiceRequest', aggregateId: { in: ids } } },
      })
      .catch(() => undefined);
    await prisma.outboxEvent.deleteMany({
      where: { aggregateType: 'ServiceRequest', aggregateId: { in: ids } },
    });
    await prisma.notification.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.bid.deleteMany({ where: { requestId: { in: ids } } });
    await prisma.serviceRequest.deleteMany({ where: { id: { in: ids } } });
    await prisma.providerProfile.deleteMany({
      where: { id: { in: PROVIDERS.map((p) => p.profile) } },
    });
    await prisma.serviceCategory.deleteMany({
      where: { id: { in: [CATEGORY, OTHER_CATEGORY] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: USERS } } });
  }

  beforeAll(async () => {
    // EXCLUSIVE on the outbox: this suite RUNS the worker, which claims
    // whatever is pending and would otherwise deliver other suites' events.
    locks = await acquireAdvisoryLocks([
      { resource: 'providerLifecycle' as const, mode: 'shared' as const },
      { resource: 'outbox' as const, mode: 'exclusive' as const },
      { resource: 'serviceRequests' as const, mode: 'shared' as const },
    ]);

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    const prismaSvc = { client: prisma };

    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const {
      AddressRepository,
    } = require('../../src/infrastructure/persistence/addresses/address.repository');
    const {
      ServiceCategoryRepository,
    } = require('../../src/infrastructure/persistence/services/service-category.repository');
    const {
      ServiceRequestRepository,
    } = require('../../src/infrastructure/persistence/requests/service-request.repository');
    const {
      ServiceRequestEventRepository,
    } = require('../../src/infrastructure/persistence/requests/service-request-event.repository');
    const {
      ProviderProfileRepository,
    } = require('../../src/infrastructure/persistence/bids/provider-profile.repository');
    const { BidRepository } = require('../../src/infrastructure/persistence/bids/bid.repository');
    const {
      NotificationRepository,
    } = require('../../src/infrastructure/persistence/notifications/notification.repository');
    const { OutboxRepository } = require('../../src/infrastructure/outbox/outbox.repository');
    const { OutboxWorker } = require('../../src/infrastructure/outbox/outbox.worker');
    const { RequestsService } = require('../../src/modules/requests/requests.service');
    const { RequestMediaService } = require('../../src/modules/media/request-media.service');
    const {
      RequestAvailableAudience,
      RequestAvailableBatchHandler,
      RequestAvailableDispatchHandler,
    } = require('../../src/modules/requests/outbox/request-available.handler');
    const {
      ProviderCapabilityService,
    } = require('../../src/modules/provider/capability/provider-capability.service');
    const {
      NotificationsService,
    } = require('../../src/modules/notifications/notifications.service');
    const {
      ProviderBidsService,
    } = require('../../src/modules/provider/bids/provider-bids.service');
    const {
      AvailableRequestsService,
    } = require('../../src/modules/provider/available-requests/available-requests.service');

    // Realtime is a best-effort side channel; it is not what is under test.
    const realtime = new Proxy({}, { get: () => () => undefined });
    const throwingStorage = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error('R09 cases must not touch attachment storage');
        },
      },
    );
    const settings: Record<string, unknown> = {
      JWT_ACCESS_SECRET: makeTestSecret('r09-geo-matching'),
      OUTBOX_WORKER_ENABLED: false,
      OUTBOX_BATCH_SIZE: 50,
      OUTBOX_POLL_INTERVAL_MS: 1_000,
      OUTBOX_CLAIM_TIMEOUT_MS: 120_000,
      OUTBOX_RETRY_BASE_MS: 1,
      OUTBOX_RETRY_CAP_MS: 5,
      OUTBOX_RETENTION_HOURS: 72,
      OUTBOX_CLEANUP_INTERVAL_MS: 3_600_000,
      OUTBOX_FANOUT_BATCH_SIZE: 200,
    };
    const config = { get: (k: string) => settings[k] };
    const metrics = () => {
      const noop = { inc: jest.fn(), set: jest.fn(), reset: jest.fn() };
      return {
        outboxEventsProcessedTotal: { inc: jest.fn() },
        outboxEventDurationSeconds: { startTimer: jest.fn(() => jest.fn()) },
        outboxQueueDepth: noop,
        outboxOldestPendingAgeSeconds: noop,
        outboxClaimedTotal: { inc: jest.fn() },
        outboxReclaimedTotal: { inc: jest.fn() },
      };
    };

    const tx = new TransactionRunner(prismaSvc);
    const requestRepo = new ServiceRequestRepository(prismaSvc);
    const requestEvents = new ServiceRequestEventRepository(prismaSvc);
    const providerRepo = new ProviderProfileRepository(prismaSvc);
    const bidRepo = new BidRepository(prismaSvc);
    const categoryRepo = new ServiceCategoryRepository(prismaSvc);
    const notificationRepo = new NotificationRepository(prismaSvc);
    const outbox = new OutboxRepository(prismaSvc);
    const notifications = new NotificationsService(notificationRepo, realtime);

    requests = new RequestsService(
      requestRepo,
      requestEvents,
      new AddressRepository(prismaSvc),
      categoryRepo,
      tx,
      outbox,
      new RequestMediaService(prismaSvc, config, throwingStorage),
    );
    providerBids = new ProviderBidsService(
      providerRepo,
      bidRepo,
      requestRepo,
      requestEvents,
      notifications,
      tx,
    );
    feed = new AvailableRequestsService(providerRepo, requestRepo, bidRepo, categoryRepo);
    // R17-E closure — recipients are decided by the provider capability
    // service, as the feed is (E-13).
    const capabilities = new ProviderCapabilityService(prismaSvc, config);
    const audience = new RequestAvailableAudience(providerRepo, capabilities);
    makeWorker = () =>
      new OutboxWorker(outbox, prismaSvc, config, metrics(), [
        new RequestAvailableDispatchHandler(audience, outbox, config, requestRepo),
        new RequestAvailableBatchHandler(
          notificationRepo,
          realtime,
          requestRepo,
          audience,
          capabilities,
          bidRepo,
        ),
      ]);

    await wipe();
    for (const id of USERS) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@r09-match.invalid`,
          passwordHash: 'x',
          firstName: 'R09',
          lastName: 'Fixture',
          // A provider with a PENDING_VERIFICATION account holds no provider
          // capability (rank 0), so the feed refuses it and, since R17-E's
          // closure, so does the fan-out.
          status: 'ACTIVE',
        },
      });
    }
    for (const id of [CATEGORY, OTHER_CATEGORY]) {
      await prisma.serviceCategory.create({
        data: {
          id,
          slug: id,
          labelEn: 'R09 category',
          labelAr: 'R09 category',
          icon: 'wrench',
          isActive: true,
          isLeaf: true,
        },
      });
    }
    for (const p of PROVIDERS) {
      await prisma.providerProfile.create({
        data: {
          id: p.profile,
          userId: p.user,
          displayName: `R09 ${p.profile}`,
          initials: 'R9',
          status: 'ACTIVE',
          serviceAreaCity: p.city,
          serviceAreaCityKey: p.city.toLowerCase(),
          serviceAreaLat: p.lat,
          serviceAreaLng: p.lng,
          serviceAreaRadiusKm: p.radiusKm,
          serviceCategories: { create: [{ serviceCategoryId: p.category }] },
        },
      });
    }

    // Every request is created through the real service, so its promoted
    // location columns and its outbox event are the production ones.
    for (const site of SITES) {
      const created = await requests.create(SEEKER, {
        categoryId: CATEGORY,
        customServiceText: null,
        description: `R09 ${site.key}`,
        scheduleType: 'ASAP',
        scheduledAt: null,
        manualAddress: {
          line1: '1 Test Street',
          city: site.city,
          country: 'SY',
          ...(site.point ?? {}),
        },
      });
      requestIds.set(site.key, created.id);
    }
    await drain();
  });

  afterAll(async () => {
    if (prisma) await wipe();
    await locks?.release();
  });

  it('the fixtures sit where the boundary cases say they do', () => {
    const km = (key: string) =>
      oracleKm(CENTRE, SITES.find((s) => s.key === key)!.point as { lat: number; lng: number });
    expect(km('inside-5km')).toBeCloseTo(5, 3);
    expect(km('inside-9.9km')).toBeCloseTo(9.9, 3);
    expect(km('inside-9.99km')).toBeCloseTo(9.99, 3);
    expect(km('outside-10.01km')).toBeCloseTo(10.01, 3);
    expect(km('outside-10.04km')).toBeCloseTo(10.04, 3);
    // The production DISPLAY value rounds that last one down to the radius...
    expect(
      haversineKm(CENTRE, SITES.find((s) => s.key === 'outside-10.04km')!.point as never),
    ).toBe(10);
    // ...and the production DECISION does not.
    expect(
      exactDistanceKm(CENTRE, SITES.find((s) => s.key === 'outside-10.04km')!.point as never),
    ).toBeGreaterThan(RADIUS_KM);
    // Within 10 km on each axis, so inside the SQL bounding box; farther than
    // 10 km on the diagonal, so outside the circle.
    expect(km('box-corner')).toBeGreaterThan(RADIUS_KM);
    expect(km('box-corner')).toBeLessThan(13);
    expect(km('far-same-city-name')).toBeCloseTo(300, 2);
  });

  it('stores the request location the matching query reads', async () => {
    const edge = await prisma.serviceRequest.findUnique({ where: { id: idOf('inside-9.99km') } });
    const point = SITES.find((s) => s.key === 'inside-9.99km')!.point!;
    expect(edge.locationLat).toBeCloseTo(point.lat, 10);
    expect(edge.locationLng).toBeCloseTo(point.lng, 10);
    expect(edge.locationCityKey).toBe('aleppo');
    const noPoint = await prisma.serviceRequest.findUnique({
      where: { id: idOf('aleppo-no-point') },
    });
    expect(noPoint).toMatchObject({
      locationLat: null,
      locationLng: null,
      locationCityKey: 'aleppo',
    });
  });

  describe.each(PROVIDERS.map((p) => [p.profile.replace(P, ''), p] as const))(
    'provider "%s"',
    (_label, p) => {
      it('is announced exactly the requests the rule allows', async () => {
        for (const site of SITES) {
          expect([site.key, await announcements(p.user, idOf(site.key))]).toEqual([
            site.key,
            expected(p, site) ? 1 : 0,
          ]);
        }
      });

      it('sees in the feed exactly the requests the rule allows', async () => {
        const listed = await listedIds(p);
        for (const site of SITES) {
          expect([site.key, listed.includes(idOf(site.key))]).toEqual([
            site.key,
            expected(p, site),
          ]);
        }
      });

      it('can open exactly the requests the feed shows', async () => {
        for (const site of SITES) {
          expect([site.key, await opens(p, idOf(site.key))]).toEqual([site.key, expected(p, site)]);
        }
      });
    },
  );

  it('the city is not consulted when both ends have a point', () => {
    // The two providers differ only in the city they typed.
    for (const site of SITES.filter((s) => s.point)) {
      expect([site.key, expected(CITY_DISAGREES, site)]).toEqual([
        site.key,
        expected(RADIUS, site),
      ]);
    }
    // ...and the typed city decides only the requests that have no point.
    const noPoint = (key: string) => SITES.find((s) => s.key === key)!;
    expect(expected(RADIUS, noPoint('aleppo-no-point'))).toBe(true);
    expect(expected(CITY_DISAGREES, noPoint('aleppo-no-point'))).toBe(false);
    expect(expected(CITY_DISAGREES, noPoint('damascus-no-point'))).toBe(true);
  });

  it('never returns a distance for a request the provider cannot open, and returns one when both have points', async () => {
    const page = await feed.list(RADIUS.user, { limit: 100 });
    const byId = new Map(page.items.map((i: any) => [i.id, i]));
    expect((byId.get(idOf('inside-5km')) as any).distanceKm).toBe(5);
    // Shown rounded to 0.1 km.
    expect((byId.get(idOf('inside-9.99km')) as any).distanceKm).toBe(10);
    expect((byId.get(idOf('aleppo-no-point')) as any).distanceKm).toBeNull();
    expect(byId.has(idOf('outside-10.01km'))).toBe(false);
  });

  describe('a changed service area changes what the provider can reach', () => {
    afterAll(async () => {
      await prisma.providerProfile.update({
        where: { id: RADIUS.profile },
        data: {
          serviceAreaLat: RADIUS.lat,
          serviceAreaLng: RADIUS.lng,
          serviceAreaRadiusKm: RADIUS.radiusKm,
        },
      });
    });

    it('a wider radius takes in the request just outside the old one', async () => {
      const outside = idOf('outside-10.01km');
      expect(await listedIds(RADIUS)).not.toContain(outside);
      await prisma.providerProfile.update({
        where: { id: RADIUS.profile },
        data: { serviceAreaRadiusKm: 11 },
      });
      expect(await listedIds(RADIUS)).toContain(outside);
      expect(await opens(RADIUS, outside)).toBe(true);
      // The diagonal corner is 12.7 km away and still outside.
      expect(await opens(RADIUS, idOf('box-corner'))).toBe(false);
    });

    it('a moved point leaves the old area and enters the new one, with no stale match', async () => {
      await prisma.providerProfile.update({
        where: { id: RADIUS.profile },
        data: { serviceAreaLat: DAMASCUS.lat, serviceAreaLng: DAMASCUS.lng },
      });
      const listed = await listedIds(RADIUS);
      expect(listed).toContain(idOf('damascus-geocoded'));
      expect(listed).not.toContain(idOf('inside-5km'));
      expect(await opens(RADIUS, idOf('inside-5km'))).toBe(false);
      expect(await opens(RADIUS, idOf('damascus-geocoded'))).toBe(true);
      // The typed city is still Aleppo, so it still decides the request that
      // has no point.
      expect(listed).toContain(idOf('aleppo-no-point'));
    });
  });

  // Last: a bid removes the request from that provider's own feed.
  describe('a bid is accepted exactly where the request can be opened', () => {
    it.each(PROVIDERS.map((p) => [p.profile.replace(P, ''), p] as const))(
      'provider "%s"',
      async (_label, p) => {
        for (const site of SITES) {
          const requestId = idOf(site.key);
          const attempt = await providerBids
            .submit(p.user, { requestId, amount: 10_000, pricingType: 'FIXED' })
            .then(
              () => 'accepted',
              (e: any) => e,
            );
          if (expected(p, site)) {
            expect([site.key, attempt]).toEqual([site.key, 'accepted']);
          } else {
            expect(attempt).toMatchObject({ status: 404 });
            // A refused bid discloses nothing about the request.
            expect(JSON.stringify(attempt)).not.toContain(`R09 ${site.key}`);
          }
          expect([
            site.key,
            await prisma.bid.count({ where: { requestId, providerId: p.profile } }),
          ]).toEqual([site.key, expected(p, site) ? 1 : 0]);
        }
      },
    );
  });
});
