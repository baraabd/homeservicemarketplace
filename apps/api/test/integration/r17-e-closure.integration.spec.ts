import { hash as hashPassword } from 'argon2';
import { ProviderCapability } from '@homeservicemarketplace/contracts';

import { OutboxRepository } from '../../src/infrastructure/outbox/outbox.repository';
import { OutboxEventType } from '../../src/infrastructure/outbox/outbox.tokens';
import { ProviderCapabilityService } from '../../src/modules/provider/capability/provider-capability.service';
import { RealtimeEventsPublisher } from '../../src/modules/realtime/realtime-events.publisher';
import {
  RequestAvailableBatchHandler,
  RequestAvailableDispatchHandler,
} from '../../src/modules/requests/outbox/request-available.handler';
import { normaliseCityKey } from '../../src/shared/geo/service-area';
import { disputeHttpApp, httpSession, type DisputeHttpApp } from '../support/dispute-http-app';

// R17-E post-merge closure — the two findings left open when #147 merged:
//
//   CLOSURE-1  provider bookings beyond the first page (review on #147): the
//              list API pages by cursor; every page must be reachable, stable,
//              owner-scoped and refused once the session or capability goes.
//   CLOSURE-2  E-13: the request-available fan-out chose recipients by the
//              legacy profile status, not by the capability the provider feed
//              and detail routes enforce (VIEW_MARKETPLACE). A notification
//              may be narrower than the feed, never broader — at the
//              dispatcher AND when each slice is written.
//
// Real AppModule, real password/OTP sessions, real guards, PostgreSQL and
// Redis; both Sprint 9 work-access axes armed, as production requires. The
// outbox stages run through the real handlers and the real once-per-handler
// marker (OutboxRepository.claimHandlerRun), exactly as OutboxWorker drives
// them, without claiming other suites' events. Every row is prefixed and
// every assertion is scoped to this suite's ids.
//
// docs/production-readiness/r17/R17_E_POSTMERGE_CLOSURE.md
const enabled = process.env.RUN_DB_INTEGRATION === '1';
(enabled ? describe : describe.skip)('R17-E post-merge closure over real HTTP', () => {
  jest.setTimeout(240_000);
  let h: DisputeHttpApp;
  type Session = Awaited<ReturnType<ReturnType<typeof httpSession>['login']>>;

  const X = 'it-r17x-';
  // Bookings providers live in their own town so the fan-out cases see only
  // the providers they were built for.
  const BOOK_CITY = 'R17X Bookings';
  const FAN_CITY = 'R17X Fanout';
  const ELSEWHERE = 'R17X Elsewhere';
  const cat = { a: `${X}cat-a`, b: `${X}cat-b` };
  const PAGE = 50; // the API's default page size (provider-bookings.service)
  const OWNED = 2 * PAGE + 5; // three pages, two boundaries
  const SCHEDULED_OWNED = 60; // a status filter that also spans a boundary

  type Fixture = {
    user: string;
    profile: string;
    cats: string[];
    city: string;
    account?: 'ACTIVE' | 'SUSPENDED';
    standing?: 'GOOD' | 'RESTRICTED';
    verification?: 'VERIFIED' | 'PENDING';
    grant?: boolean;
  };
  const p = (key: string, over: Partial<Fixture> = {}): Fixture => ({
    user: `${X}${key}`,
    profile: `${X}${key}-pp`,
    cats: [cat.a],
    city: FAN_CITY,
    ...over,
  });
  const prov = {
    // CLOSURE-1
    owner: p('owner', { city: BOOK_CITY }),
    other: p('other', { city: BOOK_CITY }),
    // CLOSURE-2 — the canonical surface allows these two …
    ok: p('ok'),
    ok2: p('ok2'),
    // … and refuses these four, whose legacy status is still ACTIVE.
    noGrant: p('nogrant', { grant: false }),
    unverified: p('unverified', { verification: 'PENDING' }),
    account: p('account', { account: 'SUSPENDED' }),
    restricted: p('restricted', { standing: 'RESTRICTED' }),
    // Allowed to work, but not on this request.
    wrongCat: p('wrongcat', { cats: [cat.b] }),
    outside: p('outside', { city: ELSEWHERE }),
    dual: p('dual'), // seeker of the fan-out requests on their own account
    late: p('late', { grant: false }), // gains access after the dispatcher ran
  };
  const sessions: Partial<Record<keyof typeof prov, Session>> = {};
  const s = (k: keyof typeof prov) => sessions[k]!;
  let seq = 0;

  async function clean() {
    const { db } = h.fixture;
    const ids = { startsWith: X };
    const notes = { userId: ids };
    const noteIds = (await db.notification.findMany({ where: notes, select: { id: true } })).map(
      (n) => n.id,
    );
    // The R17-B announce of each notification is keyed by the notification id.
    const events = await db.outboxEvent.findMany({
      where: {
        OR: [{ aggregateType: 'Notification', aggregateId: { in: noteIds } }, { aggregateId: ids }],
      },
      select: { id: true },
    });
    const eventIds = events.map((e) => e.id);
    await db.outboxHandlerRun.deleteMany({ where: { eventId: { in: eventIds } } });
    await db.outboxEvent.deleteMany({ where: { id: { in: eventIds } } });
    await db.notification.deleteMany({ where: notes });
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

  const grant = (who: keyof typeof prov) =>
    h.fixture.db.providerWorkAccessGrant.create({
      data: {
        id: `${prov[who].profile}-grant-${++seq}`,
        providerProfileId: prov[who].profile,
        status: 'ACTIVE',
        source: 'MANUAL_OVERRIDE',
        reason: 'R17-E closure fixture',
        grantedAt: new Date(Date.now() - 60_000),
      },
    });
  const revoke = (who: keyof typeof prov) =>
    h.fixture.db.providerWorkAccessGrant.updateMany({
      where: { providerProfileId: prov[who].profile, revokedAt: null },
      data: { revokedAt: new Date(), status: 'REVOKED' },
    });

  type Page = { items: { id: string; status: string }[]; nextCursor: string | null };
  const listPage = (who: Session, q: Record<string, string | number> = {}) =>
    who.request<Page>(
      `/v1/provider/bookings?${new URLSearchParams(
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

  /** The server's own order for this provider, read in one query: the
   *  repository's ORDER BY, with no cursor. Ground truth for every walk. */
  async function groundTruth(providerId: string, status?: 'SCHEDULED') {
    const rows = await h.fixture.db.booking.findMany({
      where: { providerId, deletedAt: null, ...(status ? { status } : {}) },
      orderBy: [
        { scheduledAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** `count` bookings for a provider, inserted as accepted work with a
   *  realistic spread of ordering keys: ties on scheduledAt, ties on
   *  createdAt (so the id tiebreak decides), and ASAP bookings with no
   *  scheduledAt that sort last — the page boundaries fall across all three. */
  async function seedBookings(who: keyof typeof prov, count: number, scheduled: number) {
    const { db } = h.fixture;
    const base = Date.UTC(2026, 10, 1, 9);
    const requests = [];
    const bids = [];
    const bookings = [];
    for (let i = 0; i < count; i++) {
      const tag = `${X}${who}-${String(i).padStart(3, '0')}`;
      const createdAt = new Date(base - Math.floor(i / 2) * 60_000);
      const scheduledAt = i % 3 === 2 ? null : new Date(base + Math.floor(i / 4) * 3_600_000);
      requests.push({
        id: `${tag}-req`,
        seekerUserId: h.fixture.users.seeker,
        categoryId: cat.a,
        description: `R17-E closure ${tag}`,
        scheduleType: scheduledAt ? ('LATER' as const) : ('ASAP' as const),
        status: 'BOOKED' as const,
        addressSnapshot: { city: BOOK_CITY, country: 'SY', cityKey: normaliseCityKey(BOOK_CITY) },
        locationCityKey: normaliseCityKey(BOOK_CITY),
      });
      bids.push({
        id: `${tag}-bid`,
        requestId: `${tag}-req`,
        providerId: prov[who].profile,
        amount: 100 + i,
        pricingType: 'FIXED' as const,
        status: 'ACCEPTED' as const,
      });
      bookings.push({
        id: `${tag}-bk`,
        requestId: `${tag}-req`,
        bidId: `${tag}-bid`,
        seekerUserId: h.fixture.users.seeker,
        providerId: prov[who].profile,
        status: i < scheduled ? ('SCHEDULED' as const) : ('COMPLETED' as const),
        scheduledAt,
        priceAmount: 100 + i,
        createdAt,
      });
    }
    await db.serviceRequest.createMany({ data: requests });
    await db.bid.createMany({ data: bids });
    await db.booking.createMany({ data: bookings });
    return bookings.map((b) => b.id);
  }

  // ─── fan-out plumbing ─────────────────────────────────────────────────────

  async function openRequest(seekerUserId: string, categoryId = cat.a) {
    const id = `${X}req-fan-${++seq}`;
    await h.fixture.db.serviceRequest.create({
      data: {
        id,
        seekerUserId,
        categoryId,
        description: `R17-E closure fan-out ${id}`,
        scheduleType: 'ASAP',
        status: 'OPEN_FOR_BIDS',
        addressSnapshot: { city: FAN_CITY, country: 'SY', cityKey: normaliseCityKey(FAN_CITY) },
        locationCityKey: normaliseCityKey(FAN_CITY),
      },
    });
    return id;
  }

  /** The `request.available` event RequestsService writes at creation. */
  async function enqueueAvailable(requestId: string, seekerUserId: string) {
    const outbox = h.app.get(OutboxRepository);
    const event = await outbox.enqueue({
      aggregateType: 'ServiceRequest',
      aggregateId: requestId,
      eventType: OutboxEventType.REQUEST_AVAILABLE,
      payload: {
        requestId,
        seekerUserId,
        categoryId: cat.a,
        categoryLabel: 'R17-E closure A',
        city: FAN_CITY,
        cityKey: normaliseCityKey(FAN_CITY),
        lat: null,
        lng: null,
      },
      dedupeKey: `${requestId}:available`,
    });
    return event!.id;
  }

  /** Deliver one event the way OutboxWorker.processEvent does: one
   *  transaction, the handler's once-only marker first, afterCommit after. */
  async function deliver(eventId: string) {
    const { db } = h.fixture;
    const outbox = h.app.get(OutboxRepository);
    const event = await db.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
    const handler =
      event.eventType === OutboxEventType.REQUEST_AVAILABLE
        ? h.app.get(RequestAvailableDispatchHandler)
        : h.app.get(RequestAvailableBatchHandler);
    let after: (() => Promise<void>) | undefined;
    const stats = await db.$transaction(
      async (tx) => {
        if (!(await outbox.claimHandlerRun(event.id, handler.name, tx as never))) return 'skipped';
        const result = await handler.handle(event, tx as never);
        after = result.afterCommit;
        return result.stats ?? {};
      },
      { timeout: 30_000 },
    );
    await after?.();
    return stats;
  }

  const batchesOf = (requestId: string) =>
    h.fixture.db.outboxEvent.findMany({
      where: { aggregateId: requestId, eventType: OutboxEventType.REQUEST_AVAILABLE_BATCH },
      orderBy: { createdAt: 'asc' },
    });
  const recipientsOf = async (requestId: string) =>
    (await batchesOf(requestId))
      .flatMap((e) => (e.payload as { recipientUserIds: string[] }).recipientUserIds)
      .sort();
  const notifiedFor = async (requestId: string) =>
    (
      await h.fixture.db.notification.findMany({
        where: { resourceId: requestId, type: 'REQUEST_AVAILABLE', userId: { startsWith: X } },
        select: { userId: true },
      })
    )
      .map((n) => n.userId)
      .sort();
  const users = (...keys: (keyof typeof prov)[]) => keys.map((k) => prov[k].user).sort();
  const detail = (who: keyof typeof prov, requestId: string) =>
    s(who).request(`/v1/provider/available-requests/${requestId}`);

  beforeAll(async () => {
    // The harness fixture holds seed/providerLifecycle EXCLUSIVE and
    // outbox/serviceRequests SHARED for the whole suite (see R17-E).
    h = await disputeHttpApp({
      env: { WORK_ACCESS_ENFORCED: 'true', VERIFICATION_ENFORCED: 'true' },
    });
    const { db } = h.fixture;
    await clean();
    const passwordHash = await hashPassword(h.fixture.password!);
    const providerRole = await db.role.findUniqueOrThrow({ where: { name: 'provider' } });
    for (const [i, id] of Object.values(cat).entries())
      await db.serviceCategory.create({
        data: {
          id,
          slug: id,
          labelEn: `R17-E closure ${i}`,
          labelAr: `إغلاق ${i}`,
          icon: 'wrench',
          isLeaf: true,
        },
      });
    for (const [key, f] of Object.entries(prov)) {
      await db.user.create({
        data: {
          id: f.user,
          email: `${f.user}@example.test`,
          firstName: 'R17X',
          lastName: key,
          status: f.account ?? 'ACTIVE',
          isActive: true,
          emailVerifiedAt: new Date(),
          passwordHash,
        },
      });
      await db.userRole.create({ data: { userId: f.user, roleId: providerRole.id } });
      await db.providerProfile.create({
        data: {
          id: f.profile,
          userId: f.user,
          displayName: `R17X ${key}`,
          initials: 'RX',
          // Every fan-out fixture is ACTIVE on the legacy column: that column
          // is what the recipient query read before this closure.
          status: 'ACTIVE',
          onboardingState: 'ACCEPTED',
          standingState: f.standing ?? 'GOOD',
          verificationState: f.verification ?? 'VERIFIED',
          serviceAreaCity: f.city,
          serviceAreaCityKey: normaliseCityKey(f.city),
        },
      });
      for (const c of f.cats)
        await db.providerProfileServiceCategory.create({
          data: { providerProfileId: f.profile, serviceCategoryId: c },
        });
      if (f.grant !== false) await grant(key as keyof typeof prov);
      h.enrol(f.user);
    }
    await seedBookings('owner', OWNED, SCHEDULED_OWNED);
    await seedBookings('other', 3, 3);
    // Log in only the accounts a case drives over HTTP (login is rate-limited).
    for (const key of ['owner', 'other', 'ok', 'noGrant', 'wrongCat', 'outside'] as const)
      sessions[key] = await httpSession(h).login(prov[key].user);
  });
  afterAll(async () => {
    if (h) await clean();
    await h?.dispose();
  });

  // ─── CLOSURE-1 provider bookings pagination ──────────────────────────────

  it('C01 every owned booking is reachable by cursor: 50 + 50 + 5, stable order, no gap, no repeat', async () => {
    const truth = await groundTruth(prov.owner.profile);
    expect(truth).toHaveLength(OWNED);
    const pages = await walk(s('owner'));
    expect(pages.map((pg) => pg.items.length)).toEqual([PAGE, PAGE, OWNED - 2 * PAGE]);
    const seen = pages.flatMap((pg) => pg.items.map((i) => i.id));
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(truth);
    expect(pages.at(-1)!.nextCursor).toBeNull();
    // A smaller page size walks the same sequence across six boundaries.
    const small = (await walk(s('owner'), { limit: 20 })).flatMap((pg) =>
      pg.items.map((i) => i.id),
    );
    expect(small).toEqual(truth);
  });

  it('C02 a status filter holds on every page and its last cursor is null', async () => {
    const truth = await groundTruth(prov.owner.profile, 'SCHEDULED');
    expect(truth).toHaveLength(SCHEDULED_OWNED);
    const pages = await walk(s('owner'), { status: 'SCHEDULED' });
    expect(pages.map((pg) => pg.items.length)).toEqual([PAGE, SCHEDULED_OWNED - PAGE]);
    const items = pages.flatMap((pg) => pg.items);
    expect(items.every((i) => i.status === 'SCHEDULED')).toBe(true);
    expect(items.map((i) => i.id)).toEqual(truth);
  });

  it('C03 owner isolation: another provider never reads these rows, even holding a cursor', async () => {
    const mine = (await walk(s('other'))).flatMap((pg) => pg.items.map((i) => i.id));
    expect(mine.sort()).toEqual((await groundTruth(prov.other.profile)).sort());
    const ownerFirst = (await listPage(s('owner'))).body;
    const foreign = await listPage(s('other'), { cursor: ownerFirst.nextCursor! });
    // A cursor is a position in the caller's own list. One naming another
    // provider's booking is refused rather than used as an oracle.
    expect(foreign.status).toBe(400);
    expect(JSON.stringify(foreign.body)).not.toContain(prov.owner.profile);
    const unknown = await listPage(s('owner'), { cursor: `${X}no-such-booking` });
    expect(unknown.status).toBe(400);
  });

  it('C04 restricted keeps every obligation on every page; suspended is refused at page 2', async () => {
    const { db } = h.fixture;
    const truth = await groundTruth(prov.owner.profile);
    const first = await listPage(s('owner'));
    try {
      await db.providerProfile.update({
        where: { id: prov.owner.profile },
        data: { standingState: 'RESTRICTED' },
      });
      const caps = await s('owner').request<{ allowed: string[] }>('/v1/me/provider/capabilities');
      expect(caps.body.allowed).toContain('MANAGE_BOOKINGS');
      expect(caps.body.allowed).not.toContain('VIEW_MARKETPLACE');
      const seen = (await walk(s('owner'))).flatMap((pg) => pg.items.map((i) => i.id));
      expect(seen).toEqual(truth);

      await db.providerProfile.update({
        where: { id: prov.owner.profile },
        data: { standingState: 'GOOD', status: 'SUSPENDED' },
      });
      const refused = await listPage(s('owner'), { cursor: first.body.nextCursor! });
      expect(refused.status).toBe(403);
      expect((refused.body as unknown as { items?: unknown }).items).toBeUndefined();
    } finally {
      await db.providerProfile.update({
        where: { id: prov.owner.profile },
        data: { standingState: 'GOOD', status: 'ACTIVE' },
      });
    }
  });

  it('C05 a session revoked elsewhere between pages cannot fetch the next one', async () => {
    const session = await httpSession(h).login(prov.owner.user);
    const first = await listPage(session);
    expect(first.status).toBe(200);
    expect(first.body.nextCursor).toBeTruthy();
    // Sign out everywhere from a second device; this one keeps its cookies.
    const elsewhere = await httpSession(h).login(prov.owner.user);
    expect(
      (await elsewhere.request('/v1/auth/logout-all', { method: 'POST', body: {} })).status,
    ).toBe(204);
    const after = await listPage(session, { cursor: first.body.nextCursor! });
    expect(after.status).toBe(401);
    expect((after.body as unknown as { items?: unknown }).items).toBeUndefined();
  });

  // ─── CLOSURE-2 request-available fan-out authority (E-13) ────────────────

  it('C10 the dispatcher selects exactly the providers the canonical surface lets open the request', async () => {
    const requestId = await openRequest(prov.dual.user);
    const stats = await deliver(await enqueueAvailable(requestId, prov.dual.user));
    expect(stats).not.toBe('skipped');
    // Positive control first: the two GOOD/VERIFIED/granted providers.
    expect(await recipientsOf(requestId)).toEqual(users('ok', 'ok2'));
    // Parity, case by case, through the real routes.
    expect((await detail('ok', requestId)).status).toBe(200);
    expect((await detail('noGrant', requestId)).status).toBe(403); // ACTIVE, no live grant
    expect((await detail('wrongCat', requestId)).status).toBe(404);
    expect((await detail('outside', requestId)).status).toBe(404);
    // unverified / account / restricted are refused VIEW_MARKETPLACE by the
    // same decision the route guard takes (a suspended account cannot sign in).
    const capabilities = h.app.get(ProviderCapabilityService);
    for (const key of ['unverified', 'account', 'restricted', 'noGrant', 'late'] as const)
      expect(await capabilities.can(prov[key].user, ProviderCapability.ViewMarketplace)).toBe(
        false,
      );
    for (const key of ['ok', 'ok2', 'wrongCat', 'outside', 'dual'] as const)
      expect(await capabilities.can(prov[key].user, ProviderCapability.ViewMarketplace)).toBe(true);
  });

  it('C11 a slice re-decides authority when it is written; realtime follows the written rows', async () => {
    const requestId = await openRequest(prov.dual.user);
    await deliver(await enqueueAvailable(requestId, prov.dual.user));
    expect(await recipientsOf(requestId)).toEqual(users('ok', 'ok2'));
    // Between the stages: ok2 loses its grant, late gains one.
    await revoke('ok2');
    await grant('late');
    const realtime = h.app.get(RealtimeEventsPublisher);
    const published = jest.spyOn(realtime, 'publishFor');
    try {
      for (const batch of await batchesOf(requestId)) await deliver(batch.id);
      expect(await notifiedFor(requestId)).toEqual(users('ok'));
      const announced = published.mock.calls
        .filter(
          ([, type, body]) =>
            type === 'request.available' &&
            (body as { requestId?: string })?.requestId === requestId,
        )
        .map(([userId]) => userId)
        .sort();
      expect(announced).toEqual(users('ok'));
    } finally {
      published.mockRestore();
      await grant('ok2');
      await revoke('late');
    }
    // `late` was not chosen by the dispatcher: the notification is narrower
    // than the feed here, never broader. The feed already shows it the job.
  });

  it('C12 a slice whose request closed or changed category before delivery writes nothing stale', async () => {
    const { db } = h.fixture;
    const closed = await openRequest(prov.dual.user);
    await deliver(await enqueueAvailable(closed, prov.dual.user));
    await db.serviceRequest.update({ where: { id: closed }, data: { status: 'CANCELLED' } });
    for (const batch of await batchesOf(closed)) await deliver(batch.id);
    expect(await notifiedFor(closed)).toEqual([]);

    const moved = await openRequest(prov.dual.user);
    await deliver(await enqueueAvailable(moved, prov.dual.user));
    await db.serviceRequest.update({ where: { id: moved }, data: { categoryId: cat.b } });
    for (const batch of await batchesOf(moved)) await deliver(batch.id);
    // ok/ok2 hold only A; the provider who holds B was never in the slice.
    expect(await notifiedFor(moved)).toEqual([]);
  });

  it('C13 replays and two workers deliver each durable notification exactly once', async () => {
    const requestId = await openRequest(prov.dual.user);
    const dispatchEvent = await enqueueAvailable(requestId, prov.dual.user);
    await deliver(dispatchEvent);
    expect(await deliver(dispatchEvent)).toBe('skipped');
    const batches = await batchesOf(requestId);
    expect(batches).toHaveLength(1);
    const results = await Promise.all([deliver(batches[0].id), deliver(batches[0].id)]);
    expect(results.filter((r) => r === 'skipped')).toHaveLength(1);
    expect(await deliver(batches[0].id)).toBe('skipped');
    expect(await notifiedFor(requestId)).toEqual(users('ok', 'ok2'));
  });

  it('C14 a slice that meets an in-flight suspension waits for it, then leaves that provider out', async () => {
    const { db } = h.fixture;
    const requestId = await openRequest(prov.dual.user);
    await deliver(await enqueueAvailable(requestId, prov.dual.user));
    const [batch] = await batchesOf(requestId);
    let pending: Promise<unknown> | undefined;
    try {
      await db.$transaction(
        async (t) => {
          await t.$executeRaw`UPDATE "ProviderProfile" SET "status" = 'SUSPENDED' WHERE "id" = ${prov.ok2.profile}`;
          const [{ pid }] = await t.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          pending = deliver(batch.id);
          for (let i = 0; ; i++) {
            const [{ n }] = await t.$queryRaw<{ n: bigint }[]>`
              SELECT COUNT(*)::bigint AS n FROM pg_stat_activity
              WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`;
            if (n > 0n) break;
            if (i > 200) throw new Error('the slice never waited on the in-flight suspension');
            await new Promise((r) => setTimeout(r, 25));
          }
        },
        { timeout: 30_000 },
      );
      await pending;
      expect(await notifiedFor(requestId)).toEqual(users('ok'));
    } finally {
      await pending?.catch(() => undefined);
      await db.providerProfile.update({
        where: { id: prov.ok2.profile },
        data: { status: 'ACTIVE' },
      });
    }
  });

  it('C15 the delivered deep link opens for the recipient and stays closed to a guess', async () => {
    const requestId = await openRequest(prov.dual.user);
    await deliver(await enqueueAvailable(requestId, prov.dual.user));
    for (const batch of await batchesOf(requestId)) await deliver(batch.id);
    const note = await h.fixture.db.notification.findFirstOrThrow({
      where: { resourceId: requestId, userId: prov.ok.user },
    });
    expect(note.deepLink).toBe(`/provider/requests/${requestId}`);
    // Narrow payload: no seeker identity, address or coordinates.
    expect(Object.keys(note.metadata as object).sort()).toEqual([
      'categoryId',
      'city',
      'requestId',
    ]);
    expect((await detail('ok', requestId)).status).toBe(200);
    expect((await detail('noGrant', requestId)).status).toBe(403);
    expect((await detail('wrongCat', requestId)).status).toBe(404);
  });

  it('C16 a provider who bid before the slice is written is not pointed at a request their detail now hides', async () => {
    const requestId = await openRequest(prov.dual.user);
    await deliver(await enqueueAvailable(requestId, prov.dual.user));
    expect(await recipientsOf(requestId)).toEqual(users('ok', 'ok2'));
    // ok found the job in the feed and bid before the slice ran.
    const bid = await s('ok').request('/v1/provider/bids', {
      method: 'POST',
      body: { requestId, amount: 140, pricingType: 'FIXED' },
    });
    expect(bid.status).toBe(201);
    expect((await detail('ok', requestId)).status).toBe(404);
    for (const batch of await batchesOf(requestId)) await deliver(batch.id);
    expect(await notifiedFor(requestId)).toEqual(users('ok2'));
  });
});
