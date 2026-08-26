/* eslint-disable @typescript-eslint/no-require-imports --
 * The Prisma client and the units under test are required LAZILY, inside
 * beforeAll, on purpose: with RUN_DB_INTEGRATION unset this whole spec is
 * skipped, and a top-level import would still load the generated Prisma
 * client (and open its connection pool) on every hermetic test run.
 * The sibling integration specs use the same pattern.
 */
// Sprint 6 — service-area matching and fan-out, against a REAL Postgres.
//
// service-area.spec.ts proves the RULE in memory. This proves the SQL agrees
// with it: that the bounding box, the exact-radius trim, the city-fallback
// arm, and the over-fetch all compose into the same answer once a real query
// planner is involved. A unit test cannot catch a `where` fragment that is
// valid TypeScript and wrong SQL.
//
// Gated by RUN_DB_INTEGRATION=1.

// No top-level import/export otherwise, so TypeScript would treat this file
// as a global script and collide with the identically-named locals in the
// sibling integration specs.
export {};

import { acquireAdvisoryLock, type HeldLock } from '../support/db-isolation';

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(180_000);

// Aleppo. Offsets below are computed from it so the expected distances are
// arithmetic, not magic numbers.
const CENTRE = { lat: 36.2021, lng: 37.1343 };
const KM_PER_DEG_LAT = 111.195; // 6371 * pi / 180

/** A point `km` due north of the centre — the cleanest way to place a fixture
 *  at an exactly known distance, since latitude degrees are constant. */
function northOf(km: number): { lat: number; lng: number } {
  return { lat: CENTRE.lat + km / KM_PER_DEG_LAT, lng: CENTRE.lng };
}

d('Service-area matching and fan-out (real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let repo: any;
  let providerRepo: any;
  let matchServiceArea: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  let categoryId: string;
  let seekerUserId: string;

  /** Every id this suite invents lives under one of these prefixes, which is
   *  what lets cleanup be a scoped delete. */
  const REQUEST_PREFIX = 'geo-';
  const PROVIDER_PREFIX = 'load-p-';
  const PROVIDER_USER_PREFIX = 'load-u-';

  /**
   * Remove this suite's own rows.
   *
   * This used to be
   *   TRUNCATE "OutboxHandlerRun","OutboxEvent","Bid","ServiceRequest",
   *            "ProviderProfileServiceCategory","ProviderProfile" ... CASCADE
   * — a correct reset only while nothing else is running. Under parallel
   * workers it wiped the OutboxEvent rows outbox.integration was mid-assertion
   * on and the ProviderProfile rows the lifecycle backfill had just written,
   * failing two suites for a defect in neither.
   *
   * Note what is NOT here: Outbox and Bid. This spec never writes either. They
   * were in the TRUNCATE only as FK collateral, and scoped deletes do not need
   * them cleared.
   */
  async function truncate() {
    const providerIds = (
      await prisma.providerProfile.findMany({
        where: { id: { startsWith: PROVIDER_PREFIX } },
        select: { id: true },
      })
    ).map((p: { id: string }) => p.id);

    await prisma.bid.deleteMany({
      where: {
        OR: [
          { requestId: { startsWith: REQUEST_PREFIX } },
          ...(providerIds.length ? [{ providerId: { in: providerIds } }] : []),
        ],
      },
    });
    await prisma.serviceRequest.deleteMany({ where: { id: { startsWith: REQUEST_PREFIX } } });
    if (providerIds.length) {
      await prisma.providerProfileServiceCategory.deleteMany({
        where: { providerProfileId: { in: providerIds } },
      });
      await prisma.providerProfile.deleteMany({ where: { id: { in: providerIds } } });
    }
  }

  /** Just this suite's requests — the per-describe reset. */
  async function clearRequests() {
    await prisma.bid.deleteMany({ where: { requestId: { startsWith: REQUEST_PREFIX } } });
    await prisma.serviceRequest.deleteMany({ where: { id: { startsWith: REQUEST_PREFIX } } });
  }

  /** Insert a request straight through Prisma, writing the promoted columns
   *  the way the repository does. */
  async function makeRequest(
    id: string,
    point: { lat: number | null; lng: number | null },
    cityKey: string | null,
  ) {
    return prisma.serviceRequest.create({
      data: {
        id,
        seekerUserId,
        categoryId,
        status: 'OPEN_FOR_BIDS',
        scheduleType: 'ASAP',
        addressSnapshot: {
          label: null,
          line1: 'x',
          city: cityKey ?? 'unknown',
          cityKey,
          country: 'SY',
          lat: point.lat,
          lng: point.lng,
        },
        locationCityKey: cityKey,
        locationLat: point.lat,
        locationLng: point.lng,
      },
    });
  }

  function area(over: Record<string, unknown> = {}) {
    return { lat: CENTRE.lat, lng: CENTRE.lng, radiusKm: 25, cityKey: 'aleppo', ...over };
  }

  async function listIds(serviceArea: Record<string, unknown>, take = 100): Promise<string[]> {
    const rows = await repo.listAvailableForProvider({
      excludeSeekerUserId: null,
      categoryIds: [categoryId],
      serviceArea,
      take,
    });
    return rows.map((r: { id: string }) => r.id).sort();
  }

  let lifecycleLock: HeldLock;
  let outboxLock: HeldLock;

  beforeAll(async () => {
    // SHARED, not exclusive: this suite writes ProviderProfile rows (600 of
    // them, with NULL lifecycle axes) and so must not overlap the lifecycle
    // backfill, which rewrites that table wholesale and asserts on table-wide
    // totals. Shared locks are mutually compatible, so every other suite that
    // merely writes providers still runs concurrently with this one.
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');

    // SHARED on the outbox, because this suite is a PRODUCER.
    //
    // Creating a request enqueues request.available. outbox.integration.spec.ts
    // runs real workers that claim whatever is PENDING and due — a queue
    // consumer cannot be selective — and asserts on the exact rows it expects
    // back. Left unlocked, its workers claim and dead-letter this suite's
    // events, which surfaces as a stalled drain in THAT suite rather than a
    // failure in this one.
    //
    // That suite takes the same lock EXCLUSIVE, so shared here is exactly the
    // mutual exclusion required: producers may run together, never alongside
    // the consumer.
    outboxLock = await acquireAdvisoryLock('outbox', 'shared');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    repo =
      new (require('../../src/infrastructure/persistence/requests/service-request.repository').ServiceRequestRepository)(
        { client: prisma },
      );
    providerRepo =
      new (require('../../src/infrastructure/persistence/bids/provider-profile.repository').ProviderProfileRepository)(
        { client: prisma },
      );
    matchServiceArea = require('../../src/shared/geo/service-area').matchServiceArea;

    await truncate();

    // Create this spec's OWN seeker and category rather than borrowing
    // whatever the seed left behind.
    //
    // Borrowing was wrong and failed in the full suite: `auth-flow` truncates
    // `"User" ... CASCADE`, which cascades into ServiceRequest and
    // ProviderProfile, so by the time this file ran there were no users at
    // all. A spec that depends on another spec's leftovers passes alone and
    // fails in CI, which is the worst way to find out.
    seekerUserId = 'geo-spec-seeker';
    categoryId = 'geo-spec-category';
    await prisma.user.upsert({
      where: { id: seekerUserId },
      create: {
        id: seekerUserId,
        email: 'geo-spec-seeker@example.test',
        firstName: 'Geo',
        lastName: 'Seeker',
      },
      update: {},
    });
    await prisma.serviceCategory.upsert({
      where: { id: categoryId },
      create: {
        id: categoryId,
        slug: 'geo-spec-category',
        labelEn: 'Geo Spec',
        labelAr: 'Geo Spec',
        icon: 'wrench',
      },
      update: { isActive: true },
    });
  });

  afterAll(async () => {
    await truncate();
    // Remove this spec's own fixtures — they live outside truncate() because
    // User and ServiceCategory are shared tables with other specs.
    await prisma.serviceCategory.deleteMany({ where: { id: categoryId } });
    await prisma.user.deleteMany({
      where: { OR: [{ id: seekerUserId }, { id: { startsWith: PROVIDER_USER_PREFIX } }] },
    });
    await prisma.$disconnect();
    await outboxLock?.release();
    await lifecycleLock.release();
  });

  // ── geographic boundaries ────────────────────────────────────────────────

  describe('geographic boundaries', () => {
    beforeAll(async () => {
      await clearRequests();
      await makeRequest('geo-inside-1', northOf(1), 'aleppo');
      await makeRequest('geo-inside-24', northOf(24), 'aleppo');
      await makeRequest('geo-edge-25', northOf(25), 'aleppo');
      await makeRequest('geo-outside-26', northOf(26), 'aleppo');
      await makeRequest('geo-far-300', northOf(300), 'damascus');
    });

    it('includes everything inside the radius and nothing outside it', async () => {
      const ids = await listIds(area({ cityKey: null, radiusKm: 25 }));
      expect(ids).toEqual(['geo-edge-25', 'geo-inside-1', 'geo-inside-24']);
    });

    it('treats the exact boundary as inside', async () => {
      // The inclusive `<=` reading of "within 25 km", pinned so it cannot
      // drift. Note geo-edge-25 appears above and geo-outside-26 does not.
      const ids = await listIds(area({ cityKey: null, radiusKm: 25 }));
      expect(ids).toContain('geo-edge-25');
      expect(ids).not.toContain('geo-outside-26');
    });

    it('drops the bounding-box corners that the circle excludes', async () => {
      // A point at the box corner is inside the SQL range but ~1.41x the
      // radius away. If the exact-radius trim were missing, this would appear.
      const r = 25;
      const latDelta = r / KM_PER_DEG_LAT;
      const lngDelta = latDelta / Math.cos((CENTRE.lat * Math.PI) / 180);
      await makeRequest(
        'geo-corner',
        { lat: CENTRE.lat + latDelta, lng: CENTRE.lng + lngDelta },
        'aleppo',
      );
      try {
        const ids = await listIds(area({ cityKey: null, radiusKm: r }));
        expect(ids).not.toContain('geo-corner');
      } finally {
        await prisma.serviceRequest.delete({ where: { id: 'geo-corner' } });
      }
    });

    it('matches across a city boundary when inside the radius', async () => {
      // The correction this sprint exists for.
      await makeRequest('geo-other-city', northOf(5), 'some-other-municipality');
      try {
        const ids = await listIds(area({ radiusKm: 25, cityKey: 'aleppo' }));
        expect(ids).toContain('geo-other-city');
      } finally {
        await prisma.serviceRequest.delete({ where: { id: 'geo-other-city' } });
      }
    });

    it('excludes a same-city request that is outside the radius', async () => {
      // The other half: city equality alone is no longer sufficient.
      const ids = await listIds(area({ radiusKm: 25, cityKey: 'aleppo' }));
      expect(ids).not.toContain('geo-outside-26');
    });

    it('includes an UNGEOCODED same-city request via the fallback arm', async () => {
      await makeRequest('geo-nocoords', { lat: null, lng: null }, 'aleppo');
      try {
        const ids = await listIds(area({ radiusKm: 25, cityKey: 'aleppo' }));
        expect(ids).toContain('geo-nocoords');
      } finally {
        await prisma.serviceRequest.delete({ where: { id: 'geo-nocoords' } });
      }
    });

    it('excludes an ungeocoded request from a DIFFERENT city', async () => {
      await makeRequest('geo-nocoords-far', { lat: null, lng: null }, 'damascus');
      try {
        const ids = await listIds(area({ radiusKm: 25, cityKey: 'aleppo' }));
        expect(ids).not.toContain('geo-nocoords-far');
      } finally {
        await prisma.serviceRequest.delete({ where: { id: 'geo-nocoords-far' } });
      }
    });

    it('falls back to pure city equality when the provider has no radius', async () => {
      // The compatibility guarantee: a provider who never set a centre keeps
      // exactly the pre-Sprint-6 feed.
      const ids = await listIds({ lat: null, lng: null, radiusKm: null, cityKey: 'aleppo' });
      expect(ids).toEqual(['geo-edge-25', 'geo-inside-1', 'geo-inside-24', 'geo-outside-26']);
    });

    it('returns nothing when the area constrains nothing', async () => {
      // Must be empty, never the global feed.
      expect(await listIds({ lat: null, lng: null, radiusKm: null, cityKey: null })).toEqual([]);
    });

    it('agrees with the in-memory predicate for every fixture', async () => {
      // The anti-drift assertion: SQL and matchServiceArea must return the
      // same verdict for the same rows.
      const a = area({ cityKey: 'aleppo', radiusKm: 25 });
      const selected = new Set(await listIds(a));
      // Scoped to THIS suite's category, which is what makes the comparison
      // apples-to-apples: listIds() filters by category and matchServiceArea()
      // knows nothing about categories, so an unscoped read compares a
      // category-filtered SQL verdict against a category-blind predicate.
      //
      // Unscoped, this said "for every fixture" while reading every row in the
      // database, and passed only because no other suite happened to create an
      // OPEN_FOR_BIDS request in Aleppo under a different category. Sprint
      // 9B.9 created 25 of them and this went red roughly one run in six.
      const all = await prisma.serviceRequest.findMany({
        where: { categoryId },
        select: { id: true, locationLat: true, locationLng: true, locationCityKey: true },
      });
      for (const row of all) {
        const expected = matchServiceArea(a, {
          lat: row.locationLat,
          lng: row.locationLng,
          cityKey: row.locationCityKey,
        }).matches;
        expect({ id: row.id, viaSql: selected.has(row.id) }).toEqual({
          id: row.id,
          viaSql: expected,
        });
      }
    });

    it('returns a FULL page even when the box over-selected', async () => {
      // Regression guard for the over-fetch. Trimming corners after taking
      // exactly `take` rows would return a short page, which the cursor pager
      // reads as "end of feed" and silently truncates the provider's results.
      await clearRequests();
      for (let i = 0; i < 30; i++) {
        await makeRequest(`geo-page-${i}`, northOf(1 + (i % 20) * 0.5), 'aleppo');
      }
      const ids = await listIds(area({ cityKey: null, radiusKm: 25 }), 10);
      expect(ids).toHaveLength(10);
    });
  });

  // ── fan-out load ─────────────────────────────────────────────────────────

  describe('fan-out load', () => {
    const PROVIDERS = 600;

    beforeAll(async () => {
      await clearRequests();
      await prisma.providerProfile.deleteMany({ where: { id: { startsWith: PROVIDER_PREFIX } } });

      // Each provider needs a real User: fan-out delivers to a userId, and
      // the recipient query filters `userId: { not: null }` precisely so a
      // profile with no account can never be selected.
      const users = [];
      for (let i = 0; i < PROVIDERS; i++) {
        users.push({
          id: `load-u-${i}`,
          email: `load-provider-${i}@example.test`,
          firstName: 'Load',
          lastName: `Provider${i}`,
        });
      }
      await prisma.user.createMany({ data: users, skipDuplicates: true });

      // Spread providers over a wide band so most are OUT of range: the
      // interesting property is that the predicate rejects the majority, not
      // that it accepts everything handed to it.
      const rows = [];
      for (let i = 0; i < PROVIDERS; i++) {
        const km = (i % 100) * 2; // 0..198 km from the centre
        const point = northOf(km);
        rows.push({
          id: `load-p-${i}`,
          userId: `load-u-${i}`,
          displayName: `Load Provider ${i}`,
          initials: 'LP',
          status: 'ACTIVE' as const,
          serviceAreaLat: point.lat,
          serviceAreaLng: point.lng,
          serviceAreaRadiusKm: 25,
          serviceAreaCity: 'Aleppo',
          serviceAreaCityKey: 'aleppo',
        });
      }
      await prisma.providerProfile.createMany({ data: rows });
    });

    afterAll(async () => {
      // These users are outside the truncate list (User is not in it, because
      // the seeded accounts other specs rely on live there), so clean up the
      // ones this block created.
      await prisma.providerProfile.deleteMany({ where: { id: { startsWith: PROVIDER_PREFIX } } });
      await prisma.user.deleteMany({ where: { id: { startsWith: PROVIDER_USER_PREFIX } } });
    });

    it('pages recipients without loading them all at once', async () => {
      const seen = new Set<string>();
      let cursorId: string | undefined;
      let pages = 0;

      for (;;) {
        const page = await providerRepo.listEligibleRecipientsPage({
          categoryId: null,
          location: { lat: CENTRE.lat, lng: CENTRE.lng, cityKey: 'aleppo' },
          excludeSeekerUserId: seekerUserId,
          take: 100,
          cursorId,
        });
        if (page.length === 0) break;
        pages += 1;
        for (const p of page) {
          // Keyset paging must never repeat or skip a row.
          expect(seen.has(p.id)).toBe(false);
          seen.add(p.id);
        }
        if (page.length < 100) break;
        cursorId = page[page.length - 1].id;
      }

      expect(pages).toBeGreaterThan(1); // it really paged
      expect(seen.size).toBe(PROVIDERS);
    });

    it('applies the per-provider radius, rejecting most candidates', async () => {
      // Providers all have a 25 km radius and sit 0..198 km out, so only
      // those within 25 km of the centre should match. The SQL selects a
      // superset; this asserts the exact filter actually narrows it.
      const location = { lat: CENTRE.lat, lng: CENTRE.lng, cityKey: null };
      let matched = 0;
      let scanned = 0;
      let cursorId: string | undefined;

      for (;;) {
        const page = await providerRepo.listEligibleRecipientsPage({
          categoryId: null,
          location,
          excludeSeekerUserId: seekerUserId,
          take: 200,
          cursorId,
        });
        if (page.length === 0) break;
        scanned += page.length;
        for (const p of page) {
          if (
            matchServiceArea(
              {
                lat: p.serviceAreaLat,
                lng: p.serviceAreaLng,
                radiusKm: p.serviceAreaRadiusKm,
                cityKey: p.serviceAreaCityKey,
              },
              location,
            ).matches
          ) {
            matched += 1;
          }
        }
        if (page.length < 200) break;
        cursorId = page[page.length - 1].id;
      }

      // 0, 2, ..., 24 km are inside; 26 km and beyond are not. That is 13 of
      // every 100, repeated 6 times = 78.
      expect(matched).toBe(78);
      expect(matched).toBeLessThan(scanned / 2);
    });

    it('completes a 600-provider scan well inside a request budget', async () => {
      const started = Date.now();
      let cursorId: string | undefined;
      for (;;) {
        const page = await providerRepo.listEligibleRecipientsPage({
          categoryId: null,
          location: { lat: CENTRE.lat, lng: CENTRE.lng, cityKey: 'aleppo' },
          excludeSeekerUserId: seekerUserId,
          take: 500,
          cursorId,
        });
        if (page.length < 500) break;
        cursorId = page[page.length - 1].id;
      }
      const elapsed = Date.now() - started;
      // Generous: this is a smoke bound against a pathological regression
      // (an accidental N+1 or a dropped index), not a benchmark.
      expect(elapsed).toBeLessThan(5_000);
    });
  });
});
