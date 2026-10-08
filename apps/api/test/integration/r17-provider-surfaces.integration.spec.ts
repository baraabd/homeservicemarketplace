import { hash as hashPassword } from 'argon2';

import { normaliseCityKey } from '../../src/shared/geo/service-area';
import { disputeHttpApp, httpSession, type DisputeHttpApp } from '../support/dispute-http-app';

// R17-E — Provider surface authority through the real AppModule: real
// password/OTP sessions, real JWT/Roles/capability/CSRF guards, real
// PostgreSQL and Redis. Nothing between the HTTP request and the database is
// stubbed; fixtures are test-owned rows under one prefix, and no assertion
// counts a whole table.
//
// docs/production-readiness/r17/R17_E_PROVIDER_SURFACES.md
const enabled = process.env.RUN_DB_INTEGRATION === '1';
(enabled ? describe : describe.skip)('R17-E provider surfaces over real HTTP', () => {
  jest.setTimeout(240_000);
  let h: DisputeHttpApp;
  type Session = Awaited<ReturnType<ReturnType<typeof httpSession>['login']>>;
  let seeker: Session, admin: Session;
  let p0: Session, p1: Session, p2: Session, p3: Session;

  const X = 'it-r17e-';
  const CITY = 'R17E Town';
  const KEY = normaliseCityKey(CITY)!;
  const ELSEWHERE = 'R17E Elsewhere';
  const cat = { a: `${X}cat-a`, b: `${X}cat-b`, c: `${X}cat-c` };
  // p0: no categories · p1: A · p2: A+B · p3: A (booking/race/restriction work)
  const prov = {
    p0: { user: `${X}p0`, profile: `${X}p0-pp`, cats: [] as string[] },
    p1: { user: `${X}p1`, profile: `${X}p1-pp`, cats: [cat.a] },
    p2: { user: `${X}p2`, profile: `${X}p2-pp`, cats: [cat.a, cat.b] },
    p3: { user: `${X}p3`, profile: `${X}p3-pp`, cats: [cat.a] },
  };
  const req = {
    a: `${X}req-a`,
    b: `${X}req-b`,
    c: `${X}req-c`,
    outside: `${X}req-outside`,
    own: `${X}req-own`,
    closed: `${X}req-closed`,
  };
  const ALL_REQ = Object.values(req);
  let seq = 0;

  async function clean() {
    const { db } = h.fixture;
    const ids = { startsWith: X };
    await db.notification.deleteMany({ where: { userId: { startsWith: X } } });
    await db.notification.deleteMany({
      where: {
        userId: h.fixture.users.seeker,
        metadata: { path: ['requestId'], string_starts_with: X },
      },
    });
    await db.bookingEvent.deleteMany({ where: { booking: { requestId: ids } } });
    await db.booking.deleteMany({ where: { requestId: ids } });
    await db.bid.deleteMany({ where: { requestId: ids } });
    await db.serviceRequestEvent.deleteMany({ where: { requestId: ids } });
    await db.serviceRequest.deleteMany({ where: { id: ids } });
    await db.auditEvent.deleteMany({ where: { userId: { startsWith: X } } });
    await db.providerProfileServiceCategory.deleteMany({ where: { providerProfileId: ids } });
    await db.providerProfile.deleteMany({ where: { id: ids } });
    await db.serviceCategory.deleteMany({ where: { id: ids } });
    await db.session.deleteMany({ where: { userId: ids } });
    await db.userRole.deleteMany({ where: { userId: ids } });
    await db.user.deleteMany({ where: { id: ids } });
  }

  async function openRequest(
    id: string,
    categoryId: string | null,
    opts: { city?: string; seekerUserId?: string; status?: 'OPEN_FOR_BIDS' | 'CANCELLED' } = {},
  ) {
    const city = opts.city ?? CITY;
    await h.fixture.db.serviceRequest.create({
      data: {
        id,
        seekerUserId: opts.seekerUserId ?? h.fixture.users.seeker,
        categoryId,
        customServiceText: categoryId ? null : 'R17-E custom',
        description: `R17-E fixture ${id}`,
        scheduleType: 'ASAP',
        status: opts.status ?? 'OPEN_FOR_BIDS',
        addressSnapshot: {
          city,
          country: 'SY',
          lat: null,
          lng: null,
          cityKey: normaliseCityKey(city),
        },
        locationCityKey: normaliseCityKey(city),
      },
    });
  }

  /** A fresh OPEN request in category A inside the area, for one case. */
  async function freshRequest() {
    const id = `${X}req-n${++seq}`;
    await openRequest(id, cat.a);
    return id;
  }

  async function submitBid(s: Session, requestId: string, amount = 120) {
    return s.request<{ bid: { id: string; currency: string; pricingType: string } }>(
      '/v1/provider/bids',
      { method: 'POST', body: { requestId, amount, pricingType: 'HOURLY' } },
    );
  }

  async function accept(requestId: string, bidId: string) {
    return seeker.request<{ booking: { id: string; priceAmount: number; currency: string } }>(
      `/v1/me/requests/${requestId}/bids/${bidId}/accept`,
      { method: 'POST', body: {} },
    );
  }

  /** request → p3 bid → seeker accept → SCHEDULED booking id. */
  async function scheduledBooking(amount = 150) {
    const requestId = await freshRequest();
    const bid = await submitBid(p3, requestId, amount);
    expect(bid.status).toBe(201);
    const accepted = await accept(requestId, bid.body.bid.id);
    expect(accepted.status).toBe(200);
    return { requestId, bidId: bid.body.bid.id, bookingId: accepted.body.booking.id };
  }

  const setStanding = (
    who: keyof typeof prov,
    standingState: 'GOOD' | 'RESTRICTED',
    status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
  ) =>
    h.fixture.db.providerProfile.update({
      where: { id: prov[who].profile },
      data: { standingState, status },
    });

  const feedIds = (body: { items: { id: string }[] }) => body.items.map((i) => i.id);
  const legacy = (s: Session, q = '') =>
    s.request<{ items: { id: string }[] }>(`/v1/me/provider/jobs/available${q}`);
  const canonical = (s: Session, q = '') =>
    s.request<{ items: { id: string }[] }>(`/v1/provider/available-requests${q}`);
  const allowed = async (s: Session) =>
    (await s.request<{ allowed: string[] }>('/v1/me/provider/capabilities')).body.allowed;

  beforeAll(async () => {
    h = await disputeHttpApp();
    const { db } = h.fixture;
    await clean();
    const passwordHash = await hashPassword(h.fixture.password!);
    const providerRole = await db.role.findUniqueOrThrow({ where: { name: 'provider' } });
    for (const [i, id] of Object.values(cat).entries())
      await db.serviceCategory.create({
        data: {
          id,
          slug: id,
          labelEn: `R17-E ${i}`,
          labelAr: `ر١٧ ${i}`,
          icon: 'wrench',
          isLeaf: true,
        },
      });
    for (const [key, p] of Object.entries(prov)) {
      await db.user.create({
        data: {
          id: p.user,
          email: `${p.user}@example.test`,
          firstName: 'R17E',
          lastName: key,
          status: 'ACTIVE',
          isActive: true,
          emailVerifiedAt: new Date(),
          passwordHash,
        },
      });
      await db.userRole.create({ data: { userId: p.user, roleId: providerRole.id } });
      await db.providerProfile.create({
        data: {
          id: p.profile,
          userId: p.user,
          displayName: `R17E ${key}`,
          initials: 'RE',
          status: 'ACTIVE',
          onboardingState: 'ACCEPTED',
          standingState: 'GOOD',
          verificationState: 'VERIFIED',
          serviceAreaCity: CITY,
          serviceAreaCityKey: KEY,
        },
      });
      for (const c of p.cats)
        await db.providerProfileServiceCategory.create({
          data: { providerProfileId: p.profile, serviceCategoryId: c },
        });
      h.enrol(p.user);
    }
    await openRequest(req.a, cat.a);
    await openRequest(req.b, cat.b);
    await openRequest(req.c, cat.c);
    await openRequest(req.outside, cat.a, { city: ELSEWHERE });
    await openRequest(req.own, cat.a, { seekerUserId: prov.p1.user });
    await openRequest(req.closed, cat.a, { status: 'CANCELLED' });

    seeker = await httpSession(h).login(h.fixture.users.seeker);
    admin = await httpSession(h).login(h.fixture.users.reviewer);
    p0 = await httpSession(h).login(prov.p0.user);
    p1 = await httpSession(h).login(prov.p1.user);
    p2 = await httpSession(h).login(prov.p2.user);
    p3 = await httpSession(h).login(prov.p3.user);
  });
  afterAll(async () => {
    if (h) await clean();
    await h?.dispose();
  });

  // ─── Feed category authority (E-1, E-2) ─────────────────────────────────

  it('P01 legacy feed: a provider with zero categories receives no work at all', async () => {
    const res = await legacy(p0);
    expect(res.status).toBe(200);
    expect(feedIds(res.body)).toEqual([]);
    // An explicit filter cannot manufacture authority either.
    const filtered = await legacy(p0, `?categoryId=${cat.a}`);
    expect(filtered.status).toBe(200);
    expect(feedIds(filtered.body)).toEqual([]);
  });

  it('P02 canonical feed: zero categories is empty, with or without a category query', async () => {
    for (const q of ['', `?category=${cat.a}`]) {
      const res = await canonical(p0, q);
      expect(res.status).toBe(200);
      expect(feedIds(res.body)).toEqual([]);
    }
  });

  it('P03 an authorized category narrows both feeds; no query applies all provider categories', async () => {
    for (const feed of [legacy, canonical]) {
      const all = feedIds((await feed(p2)).body).filter((id) => ALL_REQ.includes(id));
      // req.own belongs to p1's account, so it is ordinary work for p2.
      expect(all.sort()).toEqual([req.a, req.b, req.own].sort());
      const param = feed === legacy ? 'categoryId' : 'category';
      const onlyB = feedIds((await feed(p2, `?${param}=${cat.b}`)).body).filter((id) =>
        ALL_REQ.includes(id),
      );
      expect(onlyB).toEqual([req.b]);
    }
  });

  it('P04 legacy feed: a foreign active category cannot broaden authority; unknown is 400', async () => {
    const foreign = await legacy(p1, `?categoryId=${cat.c}`);
    expect(foreign.status).toBe(200);
    expect(feedIds(foreign.body)).toEqual([]);
    expect((await legacy(p1, `?categoryId=${X}no-such-category`)).status).toBe(400);
  });

  it('P05 canonical feed: a foreign active category cannot broaden authority; unknown is 400', async () => {
    const foreign = await canonical(p1, `?category=${cat.c}`);
    expect(foreign.status).toBe(200);
    expect(feedIds(foreign.body)).toEqual([]);
    expect((await canonical(p1, `?category=${X}no-such-category`)).status).toBe(400);
  });

  it('P06 the service area still applies: an outside-area request never appears', async () => {
    for (const s of [p1, p2]) {
      expect(feedIds((await legacy(s)).body)).not.toContain(req.outside);
      expect(feedIds((await canonical(s, `?category=${cat.a}`)).body)).not.toContain(req.outside);
    }
    expect((await p1.request(`/v1/provider/available-requests/${req.outside}`)).status).toBe(404);
  });

  it('P07 own requests and closed requests are excluded', async () => {
    for (const feed of [legacy, canonical]) {
      const ids = feedIds((await feed(p1)).body);
      expect(ids).toContain(req.a);
      expect(ids).not.toContain(req.own);
      expect(ids).not.toContain(req.closed);
    }
  });

  it('P08 detail agrees with the feed: a guessed id outside authority is 404', async () => {
    expect((await p1.request(`/v1/provider/available-requests/${req.a}`)).status).toBe(200);
    for (const id of [req.b, req.c, req.own, req.closed])
      expect((await p1.request(`/v1/provider/available-requests/${id}`)).status).toBe(404);
    expect((await p0.request(`/v1/provider/available-requests/${req.a}`)).status).toBe(404);
  });

  // ─── Capability and bids ────────────────────────────────────────────────

  it('P09 a suspended provider is refused feed and bid authority at the server', async () => {
    await setStanding('p1', 'GOOD', 'SUSPENDED');
    try {
      expect((await legacy(p1)).status).toBe(403);
      expect((await canonical(p1)).status).toBe(403);
      expect((await submitBid(p1, req.a)).status).toBe(403);
      expect(
        await h.fixture.db.bid.count({ where: { requestId: req.a, providerId: prov.p1.profile } }),
      ).toBe(0);
    } finally {
      await setStanding('p1', 'GOOD');
    }
  });

  it('P10 bid submit lands once with a seeker notification; a second active bid is 409', async () => {
    const requestId = await freshRequest();
    const first = await submitBid(p1, requestId, 95);
    expect(first.status).toBe(201);
    expect((await submitBid(p1, requestId, 96)).status).toBe(409);
    const { db } = h.fixture;
    expect(await db.bid.count({ where: { requestId, providerId: prov.p1.profile } })).toBe(1);
    expect(
      await db.notification.count({
        where: {
          userId: h.fixture.users.seeker,
          type: 'BID_RECEIVED',
          resourceId: first.body.bid.id,
        },
      }),
    ).toBe(1);
    // Read-back: the bid is in the provider's list and the request left their feed.
    const mine = await p1.request<{ items: { id: string }[] }>('/v1/provider/bids');
    expect(mine.body.items.map((b) => b.id)).toContain(first.body.bid.id);
    expect(feedIds((await canonical(p1)).body)).not.toContain(requestId);
  });

  it('P11 a bid on a request outside the provider authority is 404 and writes nothing', async () => {
    for (const id of [req.c, req.b, req.outside, req.own, req.closed]) {
      expect((await submitBid(p1, id)).status).toBe(404);
      expect(
        await h.fixture.db.bid.count({ where: { requestId: id, providerId: prov.p1.profile } }),
      ).toBe(0);
    }
    expect((await submitBid(p0, req.a)).status).toBe(404);
  });

  it('P12 withdrawal: owner only, pending only, idempotent-conflict on repeat, resubmittable', async () => {
    const requestId = await freshRequest();
    const bid = await submitBid(p2, requestId);
    const id = bid.body.bid.id;
    expect(
      (await p1.request(`/v1/provider/bids/${id}/withdraw`, { method: 'POST', body: {} })).status,
    ).toBe(404);
    const [a, b] = await Promise.all([
      p2.request(`/v1/provider/bids/${id}/withdraw`, { method: 'POST', body: {} }),
      p2.request(`/v1/provider/bids/${id}/withdraw`, { method: 'POST', body: {} }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await h.fixture.db.bid.findUniqueOrThrow({ where: { id } })).status).toBe('WITHDRAWN');
    expect(
      await h.fixture.db.serviceRequestEvent.count({
        where: { requestId, metadata: { path: ['withdrawnBidId'], equals: id } },
      }),
    ).toBe(1);
    expect(
      (await p2.request(`/v1/provider/bids/${id}/withdraw`, { method: 'POST', body: {} })).status,
    ).toBe(409);
    // Withdrawn bids do not block a fresh offer, and the request is back in the feed.
    expect(feedIds((await canonical(p2)).body)).toContain(requestId);
    expect((await submitBid(p2, requestId)).status).toBe(201);
    // An accepted bid cannot be withdrawn.
    const booked = await scheduledBooking();
    expect(
      (await p3.request(`/v1/provider/bids/${booked.bidId}/withdraw`, { method: 'POST', body: {} }))
        .status,
    ).toBe(409);
  });

  it('P13 stale pending bid (POLICY_BLOCKED): observes, does not decide, acceptance after restriction', async () => {
    // No approved rule says whether a PENDING bid survives a loss of new-work
    // authority (R17_E_PROVIDER_POLICY.md, decision E-3). This records what the
    // server does today so a future policy change is a visible diff, and pins
    // the part that IS approved: a booking that exists follows MANAGE_BOOKINGS.
    const requestId = await freshRequest();
    const bid = await submitBid(p3, requestId);
    await setStanding('p3', 'RESTRICTED');
    try {
      expect(await allowed(p3)).not.toContain('SUBMIT_BID');
      // A restricted provider cannot retract the offer (withdraw needs SUBMIT_BID)…
      expect(
        (
          await p3.request(`/v1/provider/bids/${bid.body.bid.id}/withdraw`, {
            method: 'POST',
            body: {},
          })
        ).status,
      ).toBe(403);
      // …and the seeker can still accept it today.
      const accepted = await accept(requestId, bid.body.bid.id);
      expect(accepted.status).toBe(200);
      // The resulting booking is an existing obligation the provider can manage.
      expect((await p3.request(`/v1/provider/bookings/${accepted.body.booking.id}`)).status).toBe(
        200,
      );
    } finally {
      await setStanding('p3', 'GOOD');
    }
  });

  // ─── Bookings ───────────────────────────────────────────────────────────

  it('P15 a booking is invisible and immutable to any other provider', async () => {
    const { bookingId } = await scheduledBooking();
    for (const path of ['', '/timeline'])
      expect((await p2.request(`/v1/provider/bookings/${bookingId}${path}`)).status).toBe(404);
    for (const action of ['start', 'complete', 'cancel'])
      expect(
        (
          await p2.request(`/v1/provider/bookings/${bookingId}/${action}`, {
            method: 'POST',
            body: {},
          })
        ).status,
      ).toBe(404);
    expect(
      (await h.fixture.db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status,
    ).toBe('SCHEDULED');
  });

  it('P16/P17 start then complete: one event each, seeker notified, timeline and reputation read back', async () => {
    const { bookingId } = await scheduledBooking();
    const { db } = h.fixture;
    const before = (await db.providerProfile.findUniqueOrThrow({ where: { id: prov.p3.profile } }))
      .completedJobs;
    expect(
      (
        await p3.request(`/v1/provider/bookings/${bookingId}/complete`, {
          method: 'POST',
          body: {},
        })
      ).status,
    ).toBe(409);
    const started = await p3.request<{ booking: { status: string } }>(
      `/v1/provider/bookings/${bookingId}/start`,
      { method: 'POST', body: {} },
    );
    expect(started.status).toBe(200);
    expect(started.body.booking.status).toBe('IN_PROGRESS');
    expect(
      (await p3.request(`/v1/provider/bookings/${bookingId}/start`, { method: 'POST', body: {} }))
        .status,
    ).toBe(409);
    const done = await p3.request<{ booking: { status: string } }>(
      `/v1/provider/bookings/${bookingId}/complete`,
      { method: 'POST', body: {} },
    );
    expect(done.status).toBe(200);
    expect(done.body.booking.status).toBe('COMPLETED');
    const timeline = await p3.request<{ items: { type: string; metadata?: { to?: string } }[] }>(
      `/v1/provider/bookings/${bookingId}/timeline`,
    );
    expect(timeline.status).toBe(200);
    expect(timeline.body.items.map((e) => e.metadata?.to ?? e.type)).toEqual([
      'BOOKING_CREATED',
      'IN_PROGRESS',
      'COMPLETED',
    ]);
    expect(
      await db.notification.count({ where: { resourceId: bookingId, type: 'BOOKING_COMPLETED' } }),
    ).toBe(1);
    expect(
      (await db.providerProfile.findUniqueOrThrow({ where: { id: prov.p3.profile } }))
        .completedJobs,
    ).toBe(before + 1);
    // Seeker read-back of the same booking.
    const seen = await seeker.request<{ status: string }>(`/v1/me/bookings/${bookingId}`);
    expect(seen.status).toBe(200);
    expect(JSON.stringify(seen.body)).toContain('COMPLETED');
  });

  it('P18 cancel: allowed from SCHEDULED once; later transitions are honest conflicts', async () => {
    const { bookingId } = await scheduledBooking();
    const res = await p3.request<{ booking: { status: string } }>(
      `/v1/provider/bookings/${bookingId}/cancel`,
      { method: 'POST', body: {} },
    );
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('CANCELLED');
    for (const action of ['cancel', 'start', 'complete'])
      expect(
        (
          await p3.request(`/v1/provider/bookings/${bookingId}/${action}`, {
            method: 'POST',
            body: {},
          })
        ).status,
      ).toBe(409);
    expect(
      await h.fixture.db.bookingEvent.count({ where: { bookingId, type: 'BOOKING_CANCELLED' } }),
    ).toBe(1);
    expect(
      await h.fixture.db.notification.count({
        where: { resourceId: bookingId, type: 'BOOKING_CANCELLED' },
      }),
    ).toBe(1);
  });

  it('P19 concurrent transitions: exactly one wins, the loser gets 409, no duplicate effects', async () => {
    const post = (id: string, action: string) =>
      p3.request(`/v1/provider/bookings/${id}/${action}`, { method: 'POST', body: {} });
    const { db } = h.fixture;
    const pairs: [string, string, string][] = [
      ['start', 'start', 'SCHEDULED'],
      ['start', 'cancel', 'SCHEDULED'],
      ['complete', 'cancel', 'IN_PROGRESS'],
      ['complete', 'complete', 'IN_PROGRESS'],
    ];
    for (const [x, y, from] of pairs) {
      const { bookingId } = await scheduledBooking();
      if (from === 'IN_PROGRESS') expect((await post(bookingId, 'start')).status).toBe(200);
      const eventsBefore = await db.bookingEvent.count({ where: { bookingId } });
      const statuses = (await Promise.all([post(bookingId, x), post(bookingId, y)])).map(
        (r) => r.status,
      );
      expect(statuses.sort()).toEqual([200, 409]);
      expect(await db.bookingEvent.count({ where: { bookingId } })).toBe(eventsBefore + 1);
      expect(
        await db.notification.count({
          where: {
            resourceId: bookingId,
            type: { in: ['BOOKING_COMPLETED', 'BOOKING_CANCELLED'] },
          },
        }),
      ).toBeLessThanOrEqual(1);
    }
  });

  it('P20 a provider start whose COMMIT is rejected leaves no transition, event or effect; retry lands once', async () => {
    const { bookingId } = await scheduledBooking();
    const { db } = h.fixture;
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION r17e_booking_commit_trap() RETURNS trigger AS $$
      BEGIN
        IF NEW."bookingId" = '${bookingId}' THEN
          RAISE EXCEPTION 'r17e: rejected at commit' USING ERRCODE = 'P0001';
        END IF;
        RETURN NULL;
      END $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER r17e_booking_commit_trap_t
      AFTER INSERT ON "BookingEvent" DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION r17e_booking_commit_trap()`);
    const eventsBefore = await db.bookingEvent.count({ where: { bookingId } });
    const notesBefore = await db.notification.count({ where: { resourceId: bookingId } });
    let failed: Awaited<ReturnType<Session['request']>>;
    try {
      failed = await p3.request(`/v1/provider/bookings/${bookingId}/start`, {
        method: 'POST',
        body: {},
      });
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS r17e_booking_commit_trap_t ON "BookingEvent"',
      );
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS r17e_booking_commit_trap()');
    }
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(failed.body)).not.toMatch(/r17e|trigger|P0001|prisma/i);
    expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe(
      'SCHEDULED',
    );
    expect(await db.bookingEvent.count({ where: { bookingId } })).toBe(eventsBefore);
    expect(await db.notification.count({ where: { resourceId: bookingId } })).toBe(notesBefore);
    const retry = await p3.request(`/v1/provider/bookings/${bookingId}/start`, {
      method: 'POST',
      body: {},
    });
    expect(retry.status).toBe(200);
    expect(await db.bookingEvent.count({ where: { bookingId } })).toBe(eventsBefore + 1);
  });

  it('P21 a RESTRICTED provider loses new work but keeps existing bookings', async () => {
    const { bookingId } = await scheduledBooking();
    await setStanding('p3', 'RESTRICTED');
    try {
      expect((await canonical(p3)).status).toBe(403);
      expect((await legacy(p3)).status).toBe(403);
      expect((await submitBid(p3, req.a)).status).toBe(403);
      const list = await p3.request<{ items: { id: string }[] }>('/v1/provider/bookings');
      expect(list.status).toBe(200);
      expect(list.body.items.map((b) => b.id)).toContain(bookingId);
      expect((await p3.request(`/v1/provider/bookings/${bookingId}/timeline`)).status).toBe(200);
      expect(
        (await p3.request(`/v1/provider/bookings/${bookingId}/start`, { method: 'POST', body: {} }))
          .status,
      ).toBe(200);
    } finally {
      await setStanding('p3', 'GOOD');
    }
  });

  it('P22 capabilities read back the current server state within the same session', async () => {
    expect(await allowed(p2)).toEqual(
      expect.arrayContaining(['VIEW_MARKETPLACE', 'SUBMIT_BID', 'MANAGE_BOOKINGS']),
    );
    const suspended = await admin.request(`/v1/admin/providers/${prov.p2.profile}/suspend`, {
      method: 'POST',
      body: { reason: 'R17-E capability read-back' },
    });
    expect(suspended.status).toBe(200);
    try {
      const now = await allowed(p2);
      expect(now).not.toContain('VIEW_MARKETPLACE');
      expect(now).not.toContain('SUBMIT_BID');
      // The same, still-open session is refused at the server regardless of UI.
      expect((await canonical(p2)).status).toBe(403);
      expect((await submitBid(p2, req.a)).status).toBe(403);
    } finally {
      const back = await admin.request(`/v1/admin/providers/${prov.p2.profile}/reactivate`, {
        method: 'POST',
        body: {},
      });
      expect(back.status).toBe(200);
    }
    expect(await allowed(p2)).toContain('SUBMIT_BID');
  });

  it('P23 privacy: seekers see an allowlisted provider projection; owner preview stays owner-scoped', async () => {
    const requestId = await freshRequest();
    await submitBid(p1, requestId);
    const bids = await seeker.request<{ items: { provider: Record<string, unknown> }[] }>(
      `/v1/me/requests/${requestId}/bids`,
    );
    expect(bids.status).toBe(200);
    expect(Object.keys(bids.body.items[0]!.provider).sort()).toEqual(
      [
        'avatarUrl',
        'completedJobs',
        'displayName',
        'id',
        'initials',
        'ratingAvg',
        'reviewCount',
        'topPro',
        'verified',
      ].sort(),
    );
    expect(JSON.stringify(bids.body)).not.toMatch(/example\.test|phone|userId|adminNote|evidence/i);
    expect((await seeker.request('/v1/me/provider/public-profile/preview')).status).toBe(403);
    expect((await p1.request('/v1/me/provider/public-profile/preview')).status).toBe(200);
  });

  it('P24 price honesty: the wire carries amount, currency and pricing type end to end; no badge is fabricated', async () => {
    const requestId = await freshRequest();
    const bid = await submitBid(p3, requestId, 210);
    expect(bid.body.bid).toMatchObject({ currency: 'USD', pricingType: 'HOURLY' });
    const seen = await seeker.request<{
      items: { amount: number; currency: string; pricingType: string; badge: unknown }[];
    }>(`/v1/me/requests/${requestId}/bids`);
    expect(seen.body.items[0]).toMatchObject({
      amount: 210,
      currency: 'USD',
      pricingType: 'HOURLY',
      badge: null,
    });
    const accepted = await accept(requestId, bid.body.bid.id);
    expect(accepted.body.booking).toMatchObject({ priceAmount: 210, currency: 'USD' });
    const detail = await p3.request<Record<string, unknown>>(
      `/v1/provider/bookings/${accepted.body.booking.id}`,
    );
    expect(detail.body).toMatchObject({ priceAmount: 210, currency: 'USD' });
  });

  it('E-6 profile PATCH: omitting categoryIds changes no categories; additions are refused', async () => {
    const links = () =>
      h.fixture.db.providerProfileServiceCategory
        .findMany({
          where: { providerProfileId: prov.p2.profile },
          select: { serviceCategoryId: true },
        })
        .then((r) => r.map((l) => l.serviceCategoryId).sort());
    const before = await links();
    expect(
      (
        await p2.request('/v1/me/provider/profile', {
          method: 'PATCH',
          body: { headline: 'R17-E headline' },
        })
      ).status,
    ).toBe(200);
    expect(await links()).toEqual(before);
    const add = await p2.request('/v1/me/provider/profile', {
      method: 'PATCH',
      body: { categoryIds: [...before, cat.c] },
    });
    expect(add.status).toBe(403);
    expect(await links()).toEqual(before);
  });
});
