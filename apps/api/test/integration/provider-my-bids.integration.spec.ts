import { hash as hashPassword } from 'argon2';

import { normaliseCityKey } from '../../src/shared/geo/service-area';
import { disputeHttpApp, httpSession, type DisputeHttpApp } from '../support/dispute-http-app';

// E-18 — My Bids reaches every bid, and every accepted bid reaches its
// booking. Recorded open when R17-E closed (GAP_REGISTER E-18): the screen
// read the first page of GET /v1/provider/bids (20) and linked an accepted
// bid to a booking only when that booking was on the first page of
// GET /v1/provider/bookings (50). The list API pages by cursor; this suite
// proves every page is reachable, stable and owner-scoped, that each accepted
// bid names its own live booking on whichever page it falls, and that a
// cursor is refused once it is not the caller's or the session is gone.
//
// Real AppModule, real password/OTP sessions, real guards, PostgreSQL and
// Redis; both Sprint 9 work-access axes armed, as production requires. Every
// row is prefixed and every assertion is scoped to this suite's ids.
const enabled = process.env.RUN_DB_INTEGRATION === '1';
(enabled ? describe : describe.skip)('E-18 provider My Bids pagination over real HTTP', () => {
  jest.setTimeout(240_000);
  let h: DisputeHttpApp;
  type Session = Awaited<ReturnType<ReturnType<typeof httpSession>['login']>>;

  const X = 'it-mybids-';
  const CITY = 'MyBids Town';
  const KEY = normaliseCityKey(CITY)!;
  const CATEGORY = `${X}cat`;
  const PAGE = 20; // the API's default page size (provider-bids.service)
  const BOOKINGS_PAGE = 50; // provider-bookings.service
  const ACCEPTED = 60; // more bookings than one bookings page
  const OTHERS = 10; // pending, rejected and withdrawn bids
  const OWNED = ACCEPTED + OTHERS; // 20 + 20 + 20 + 10

  const prov = {
    owner: { user: `${X}owner`, profile: `${X}owner-pp` },
    other: { user: `${X}other`, profile: `${X}other-pp` },
  };
  const sessions: Partial<Record<keyof typeof prov, Session>> = {};
  const s = (k: keyof typeof prov) => sessions[k]!;

  async function clean() {
    const { db } = h.fixture;
    const ids = { startsWith: X };
    await db.bookingEvent.deleteMany({ where: { booking: { requestId: ids } } });
    await db.booking.deleteMany({ where: { requestId: ids } });
    await db.bid.deleteMany({ where: { requestId: ids } });
    await db.serviceRequestEvent.deleteMany({ where: { requestId: ids } });
    await db.serviceRequest.deleteMany({ where: { id: ids } });
    await db.auditEvent.deleteMany({ where: { userId: ids } });
    await db.providerWorkAccessGrant.deleteMany({ where: { providerProfileId: ids } });
    await db.providerProfileServiceCategory.deleteMany({ where: { providerProfileId: ids } });
    await db.providerProfile.deleteMany({ where: { id: ids } });
    await db.serviceCategory.deleteMany({ where: { id: ids } });
    await db.session.deleteMany({ where: { userId: ids } });
    await db.userRole.deleteMany({ where: { userId: ids } });
    await db.user.deleteMany({ where: { id: ids } });
  }

  type Item = {
    id: string;
    status: string;
    booking?: { id: string; status: string } | null;
  };
  type Page = { items: Item[]; nextCursor: string | null };
  const listPage = (who: Session, q: Record<string, string | number> = {}) =>
    who.request<Page>(
      `/v1/provider/bids?${new URLSearchParams(
        Object.entries(q).map(([k, v]): [string, string] => [k, String(v)]),
      )}`,
    );

  /** Follows nextCursor to the end; fails on any non-200 or runaway loop. */
  async function walk(who: Session, q: Record<string, string | number> = {}) {
    const pages: Page[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const res = await listPage(who, cursor ? { ...q, cursor } : q);
      expect(res.status).toBe(200);
      pages.push(res.body);
      cursor = res.body.nextCursor;
      if (!cursor) return pages;
    }
    throw new Error('pagination did not terminate');
  }

  /** The repository's ORDER BY for this provider, read in one query. */
  async function groundTruth(providerId: string, status?: 'ACCEPTED') {
    const rows = await h.fixture.db.bid.findMany({
      where: { providerId, deletedAt: null, ...(status ? { status } : {}) },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, booking: { select: { id: true, status: true, deletedAt: true } } },
    });
    return rows;
  }

  /** `accepted` accepted bids with bookings, then `others` bids that have
   *  none. Ties on submittedAt (so the id tiebreak decides) fall across the
   *  page boundaries. Bookings are scheduled in the opposite order to the
   *  bids, so the newest accepted bids have the bookings the first bookings
   *  page does not reach. */
  async function seed(who: keyof typeof prov, accepted: number, others: number) {
    const { db } = h.fixture;
    const base = Date.UTC(2026, 9, 1, 9);
    const total = accepted + others;
    const other = ['PENDING', 'REJECTED', 'WITHDRAWN'] as const;
    const tags = Array.from(
      { length: total },
      (_, i) => `${X}${who}-${String(i).padStart(3, '0')}`,
    );
    await db.serviceRequest.createMany({
      data: tags.map((tag, i) => ({
        id: `${tag}-req`,
        seekerUserId: h.fixture.users.seeker,
        categoryId: CATEGORY,
        description: `E-18 ${tag}`,
        scheduleType: 'LATER' as const,
        status: i < accepted ? ('BOOKED' as const) : ('OPEN_FOR_BIDS' as const),
        addressSnapshot: { city: CITY, country: 'SY', cityKey: KEY },
        locationCityKey: KEY,
      })),
    });
    await db.bid.createMany({
      data: tags.map((tag, i) => ({
        id: `${tag}-bid`,
        requestId: `${tag}-req`,
        providerId: prov[who].profile,
        amount: 100 + i,
        pricingType: 'FIXED' as const,
        status: i < accepted ? ('ACCEPTED' as const) : other[i % 3],
        submittedAt: new Date(base - Math.floor(i / 3) * 60_000),
      })),
    });
    await db.booking.createMany({
      data: tags.slice(0, accepted).map((tag, i) => ({
        id: `${tag}-bk`,
        requestId: `${tag}-req`,
        bidId: `${tag}-bid`,
        seekerUserId: h.fixture.users.seeker,
        providerId: prov[who].profile,
        status: i % 4 === 0 ? ('IN_PROGRESS' as const) : ('SCHEDULED' as const),
        scheduledAt: new Date(base + i * 3_600_000),
        priceAmount: 100 + i,
      })),
    });
  }

  beforeAll(async () => {
    h = await disputeHttpApp({
      env: { WORK_ACCESS_ENFORCED: 'true', VERIFICATION_ENFORCED: 'true' },
    });
    const { db } = h.fixture;
    await clean();
    const passwordHash = await hashPassword(h.fixture.password!);
    const role = await db.role.findUniqueOrThrow({ where: { name: 'provider' } });
    await db.serviceCategory.create({
      data: {
        id: CATEGORY,
        slug: CATEGORY,
        labelEn: 'E-18 Plumbing',
        labelAr: 'سباكة',
        icon: 'wrench',
        isLeaf: true,
      },
    });
    for (const [key, f] of Object.entries(prov)) {
      await db.user.create({
        data: {
          id: f.user,
          email: `${f.user}@example.test`,
          firstName: 'E18',
          lastName: key,
          status: 'ACTIVE',
          isActive: true,
          emailVerifiedAt: new Date(),
          passwordHash,
        },
      });
      await db.userRole.create({ data: { userId: f.user, roleId: role.id } });
      await db.providerProfile.create({
        data: {
          id: f.profile,
          userId: f.user,
          displayName: `E18 ${key}`,
          initials: 'EB',
          status: 'ACTIVE',
          onboardingState: 'ACCEPTED',
          standingState: 'GOOD',
          verificationState: 'VERIFIED',
          serviceAreaCity: CITY,
          serviceAreaCityKey: KEY,
          serviceCategories: { create: [{ serviceCategoryId: CATEGORY }] },
        },
      });
      await db.providerWorkAccessGrant.create({
        data: {
          id: `${f.profile}-grant`,
          providerProfileId: f.profile,
          status: 'ACTIVE',
          source: 'MANUAL_OVERRIDE',
          reason: 'E-18 fixture',
          grantedAt: new Date(Date.now() - 60_000),
        },
      });
      h.enrol(f.user);
    }
    await seed('owner', ACCEPTED, OTHERS);
    await seed('other', 2, 1);
    for (const key of ['owner', 'other'] as const)
      sessions[key] = await httpSession(h).login(prov[key].user);
  });
  afterAll(async () => {
    if (h) await clean();
    await h?.dispose();
  });

  it('M01 every owned bid is reachable by cursor: 20 + 20 + 20 + 10, stable order, no gap, no repeat', async () => {
    const truth = (await groundTruth(prov.owner.profile)).map((b) => b.id);
    expect(truth).toHaveLength(OWNED);
    const pages = await walk(s('owner'));
    expect(pages.map((pg) => pg.items.length)).toEqual([PAGE, PAGE, PAGE, OWNED - 3 * PAGE]);
    const seen = pages.flatMap((pg) => pg.items.map((i) => i.id));
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(truth);
    expect(pages.at(-1)!.nextCursor).toBeNull();
    // Another page size walks the same sequence across other boundaries.
    const small = (await walk(s('owner'), { limit: 7 })).flatMap((pg) => pg.items.map((i) => i.id));
    expect(small).toEqual(truth);
  });

  it('M02 every accepted bid names its own live booking on whichever page it falls', async () => {
    const truth = await groundTruth(prov.owner.profile, 'ACCEPTED');
    expect(truth).toHaveLength(ACCEPTED);
    const pages = await walk(s('owner'), { status: 'ACCEPTED' });
    expect(pages.map((pg) => pg.items.length)).toEqual([PAGE, PAGE, PAGE]);
    const items = pages.flatMap((pg) => pg.items);
    expect(items.every((i) => i.status === 'ACCEPTED')).toBe(true);
    expect(items.map((i) => ({ id: i.id, booking: i.booking }))).toEqual(
      truth.map((b) => ({ id: b.id, booking: { id: b.booking!.id, status: b.booking!.status } })),
    );
    // Positive control for the defect: the first bookings page does not
    // reach the bookings of the newest accepted bids, so a client that maps
    // bids to bookings from that page could not link them.
    const bookingsPage = await s('owner').request<{ items: { id: string; bidId: string }[] }>(
      '/v1/provider/bookings',
    );
    expect(bookingsPage.status).toBe(200);
    expect(bookingsPage.body.items).toHaveLength(BOOKINGS_PAGE);
    const reached = new Set(bookingsPage.body.items.map((b) => b.bidId));
    const firstBidsPage = pages[0].items;
    const unreachable = firstBidsPage.filter((b) => !reached.has(b.id));
    expect(unreachable.length).toBeGreaterThan(0);
    for (const b of unreachable)
      expect(b.booking).toEqual(expect.objectContaining({ id: expect.any(String) }));
  });

  it('M03 a bid without a live booking says so: pending, rejected, withdrawn, deleted booking', async () => {
    const { db } = h.fixture;
    const all = (await walk(s('owner'))).flatMap((pg) => pg.items);
    const others = all.filter((i) => i.status !== 'ACCEPTED');
    expect(others).toHaveLength(OTHERS);
    expect(new Set(others.map((i) => i.status))).toEqual(
      new Set(['PENDING', 'REJECTED', 'WITHDRAWN']),
    );
    expect(others.every((i) => i.booking === null)).toBe(true);

    const target = all.find((i) => i.status === 'ACCEPTED')!;
    try {
      await db.booking.update({
        where: { id: target.booking!.id },
        data: { deletedAt: new Date() },
      });
      const after = (await walk(s('owner'))).flatMap((pg) => pg.items);
      expect(after.find((i) => i.id === target.id)!.booking).toBeNull();
    } finally {
      await db.booking.update({ where: { id: target.booking!.id }, data: { deletedAt: null } });
    }
  });

  it('M04 owner isolation: another provider never reads these bids, even holding a cursor', async () => {
    const mine = (await walk(s('other'))).flatMap((pg) => pg.items.map((i) => i.id));
    expect(mine.sort()).toEqual((await groundTruth(prov.other.profile)).map((b) => b.id).sort());
    const ownerFirst = (await listPage(s('owner'))).body;
    expect(ownerFirst.nextCursor).toBeTruthy();
    // A cursor is a position in the caller's own list. One naming another
    // provider's bid is refused rather than used to position the page.
    const foreign = await listPage(s('other'), { cursor: ownerFirst.nextCursor! });
    expect(foreign.status).toBe(400);
    expect(JSON.stringify(foreign.body)).not.toContain(prov.owner.profile);
    expect(JSON.stringify(foreign.body)).not.toContain(`${X}owner-`);
    const unknown = await listPage(s('owner'), { cursor: `${X}no-such-bid` });
    expect(unknown.status).toBe(400);
  });

  it('M05 losing marketplace access between pages refuses page 2', async () => {
    const { db } = h.fixture;
    const first = await listPage(s('owner'));
    expect(first.body.nextCursor).toBeTruthy();
    try {
      await db.providerWorkAccessGrant.updateMany({
        where: { providerProfileId: prov.owner.profile, revokedAt: null },
        data: { revokedAt: new Date(), status: 'REVOKED' },
      });
      const refused = await listPage(s('owner'), { cursor: first.body.nextCursor! });
      expect(refused.status).toBe(403);
      expect((refused.body as unknown as { items?: unknown }).items).toBeUndefined();
    } finally {
      await db.providerWorkAccessGrant.updateMany({
        where: { providerProfileId: prov.owner.profile },
        data: { revokedAt: null, status: 'ACTIVE' },
      });
    }
    // Positive control: with the grant restored the same cursor works.
    expect((await listPage(s('owner'), { cursor: first.body.nextCursor! })).status).toBe(200);
  });

  it('M06 a session revoked elsewhere between pages cannot fetch the next one', async () => {
    const session = await httpSession(h).login(prov.owner.user);
    const first = await listPage(session);
    expect(first.status).toBe(200);
    expect(first.body.nextCursor).toBeTruthy();
    const elsewhere = await httpSession(h).login(prov.owner.user);
    expect(
      (await elsewhere.request('/v1/auth/logout-all', { method: 'POST', body: {} })).status,
    ).toBe(204);
    const after = await listPage(session, { cursor: first.body.nextCursor! });
    expect(after.status).toBe(401);
    expect((after.body as unknown as { items?: unknown }).items).toBeUndefined();
  });
});
