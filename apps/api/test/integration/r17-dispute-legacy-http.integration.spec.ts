import { disputeHttpApp, httpSession, type DisputeHttpApp } from '../support/dispute-http-app';

// R17-C — the legacy admin dispute tickets through the real AppModule: real
// password/OTP sessions, real JWT/Roles/CSRF guards, real PostgreSQL. Nothing
// is stubbed between the HTTP request and the database.
//
// docs/production-readiness/r17/R17_C_DISPUTES.md
const enabled = process.env.RUN_DB_INTEGRATION === '1';
(enabled ? describe : describe.skip)('R17-C legacy admin disputes over real HTTP', () => {
  jest.setTimeout(180_000);
  let h: DisputeHttpApp;
  type Session = Awaited<ReturnType<ReturnType<typeof httpSession>['login']>>;
  let adminA: Session, adminB: Session, seeker: Session, provider: Session, outsider: Session;

  beforeAll(async () => {
    h = await disputeHttpApp();
    const { users } = h.fixture;
    // `reviewer` and `independent` hold the system `admin` role in this fixture.
    adminA = await httpSession(h).login(users.reviewer);
    adminB = await httpSession(h).login(users.independent);
    seeker = await httpSession(h).login(users.seeker);
    provider = await httpSession(h).login(users.provider);
    outsider = await httpSession(h).login(users.outsider);
  });
  afterAll(async () => {
    await h?.dispose();
  });

  async function openTicket(openedById = h.fixture.users.seeker) {
    const bookingId = await h.fixture.booking();
    const opened = await adminA.request<{ dispute: { id: string } }>('/v1/admin/disputes', {
      method: 'POST',
      body: { bookingId, openedById, reason: 'Synthetic legacy ticket' },
    });
    expect(opened.status).toBe(201);
    return { id: opened.body.dispute.id, bookingId };
  }

  async function rows(disputeId: string) {
    const { db, users } = h.fixture;
    return {
      dispute: await db.dispute.findUniqueOrThrow({ where: { id: disputeId } }),
      resolved: await db.disputeEvent.count({ where: { disputeId, type: 'RESOLVED' } }),
      audits: await db.auditEvent.count({
        where: {
          type: 'ADMIN_DISPUTE_RESOLVED',
          metadata: { path: ['disputeId'], equals: disputeId },
        },
      }),
      notices: await db.notification.findMany({
        where: {
          userId: { in: Object.values(users) },
          metadata: { path: ['disputeId'], equals: disputeId },
        },
      }),
    };
  }

  it('refuses anonymous callers, non-admins and requests without CSRF', async () => {
    const t = await openTicket();
    expect((await httpSession(h).request('/v1/admin/disputes')).status).toBe(401);
    for (const s of [seeker, provider, outsider]) {
      expect((await s.request('/v1/admin/disputes')).status).toBe(403);
      expect((await s.request(`/v1/admin/disputes/${t.id}`)).status).toBe(403);
      const forged = await s.request(`/v1/admin/disputes/${t.id}/resolve`, {
        method: 'POST',
        body: { status: 'RESOLVED_REFUND', resolution: 'Not my decision' },
      });
      expect(forged.status).toBe(403);
    }
    const noCsrf = await adminA.request(`/v1/admin/disputes/${t.id}/resolve`, {
      method: 'POST',
      body: { status: 'RESOLVED_DENIED', resolution: 'No CSRF' },
      csrf: false,
    });
    expect(noCsrf.status).toBe(403);
    // Positive control: nothing above decided the ticket, and it still exists.
    const after = await rows(t.id);
    expect(after.dispute.status).toBe('OPEN');
    expect(after.resolved).toBe(0);
  });

  it('refuses a forged opener, an unknown booking and a second active ticket', async () => {
    const bookingId = await h.fixture.booking();
    const forged = await adminA.request('/v1/admin/disputes', {
      method: 'POST',
      body: { bookingId, openedById: h.fixture.users.outsider, reason: 'Forged opener' },
    });
    expect(forged.status).toBe(400);
    const unknown = await adminA.request('/v1/admin/disputes', {
      method: 'POST',
      body: {
        bookingId: `${h.fixture.prefix}missing`,
        openedById: h.fixture.users.seeker,
        reason: 'x',
      },
    });
    expect(unknown.status).toBe(404);
    const first = await adminA.request('/v1/admin/disputes', {
      method: 'POST',
      body: { bookingId, openedById: h.fixture.users.provider, reason: 'Provider ticket' },
    });
    expect(first.status).toBe(201);
    const second = await adminB.request('/v1/admin/disputes', {
      method: 'POST',
      body: { bookingId, openedById: h.fixture.users.seeker, reason: 'Duplicate' },
    });
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).not.toMatch(/prisma|P2002|unique|constraint/i);
    expect(await h.fixture.db.dispute.count({ where: { bookingId } })).toBe(1);
  });

  it('two admins deciding at once: one 200, one 409, one set of side effects; the read-back survives a fresh login', async () => {
    const t = await openTicket();
    const [a, b] = await Promise.all([
      adminA.request(`/v1/admin/disputes/${t.id}/resolve`, {
        method: 'POST',
        body: { status: 'RESOLVED_DENIED', resolution: 'Decision A' },
      }),
      adminB.request(`/v1/admin/disputes/${t.id}/resolve`, {
        method: 'POST',
        body: { status: 'RESOLVED_REFUND', resolution: 'Decision B' },
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? 'RESOLVED_DENIED' : 'RESOLVED_REFUND';
    const after = await rows(t.id);
    expect(after.dispute.status).toBe(winner);
    expect(after.resolved).toBe(1);
    expect(after.audits).toBe(1);
    expect(after.notices).toHaveLength(1);

    // A brand-new session reads the same committed decision.
    const fresh = await httpSession(h).login(h.fixture.users.independent);
    const detail = await fresh.request<{ status: string }>(`/v1/admin/disputes/${t.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe(winner);
  });

  it('the opener’s notice is truthful, lands in their experience, and is invisible to others', async () => {
    const forProvider = await openTicket(h.fixture.users.provider);
    const decided = await adminA.request(`/v1/admin/disputes/${forProvider.id}/resolve`, {
      method: 'POST',
      body: { status: 'RESOLVED_PARTIAL', resolution: 'Partial intent' },
    });
    expect(decided.status).toBe(200);
    type List = { items: { deepLink: string | null; title: string; body: string }[] };
    const mine = await provider.request<List>('/v1/me/notifications?experience=provider');
    const notice = mine.body.items.find(
      (n) => n.deepLink === `/provider/bookings/${forProvider.bookingId}`,
    );
    expect(notice).toBeDefined();
    expect(`${notice!.title} ${notice!.body}`).not.toMatch(/refund|partial|paid|compensat/i);
    expect(notice!.body).toMatch(/does not move money/i);
    for (const other of [seeker, outsider]) {
      const theirs = await other.request<List>('/v1/me/notifications');
      expect(theirs.body.items.some((n) => n.deepLink?.includes(forProvider.bookingId))).toBe(
        false,
      );
    }
  });

  it('legacy tickets cannot read or decide a workspace case', async () => {
    const c = await h.fixture.create();
    expect((await adminA.request(`/v1/admin/disputes/${c.id}`)).status).toBe(404);
    const resolve = await adminA.request(`/v1/admin/disputes/${c.id}/resolve`, {
      method: 'POST',
      body: { status: 'RESOLVED_REFUND', resolution: 'Bypass attempt' },
    });
    expect(resolve.status).toBe(404);
    const w = await h.fixture.db.disputeWorkspace.findUniqueOrThrow({ where: { disputeId: c.id } });
    expect(w.state).toBe('GATHERING');
    expect((await h.fixture.db.dispute.findUniqueOrThrow({ where: { id: c.id } })).status).toBe(
      'OPEN',
    );
  });

  it('a decision whose COMMIT is rejected answers an error, stores nothing, and a retry lands once', async () => {
    const t = await openTicket();
    const db = h.fixture.db;
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION r17c_http_commit_trap() RETURNS trigger AS $$
      BEGIN
        IF NEW."disputeId" = '${t.id}' AND NEW."type" = 'RESOLVED' THEN
          RAISE EXCEPTION 'r17c: rejected at commit' USING ERRCODE = 'P0001';
        END IF;
        RETURN NULL;
      END $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER r17c_http_commit_trap_t
      AFTER INSERT ON "DisputeEvent" DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION r17c_http_commit_trap()`);
    let failed: Awaited<ReturnType<Session['request']>>;
    try {
      failed = await adminA.request(`/v1/admin/disputes/${t.id}/resolve`, {
        method: 'POST',
        body: { status: 'RESOLVED_DENIED', resolution: 'Rejected at commit' },
      });
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS r17c_http_commit_trap_t ON "DisputeEvent"',
      );
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS r17c_http_commit_trap()');
    }
    expect(failed.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(failed.body)).not.toMatch(/r17c|trigger|DisputeEvent|P0001|prisma/i);
    const aborted = await rows(t.id);
    expect(aborted.dispute.status).toBe('OPEN');
    expect(aborted.resolved).toBe(0);
    expect(aborted.audits).toBe(0);
    expect(aborted.notices).toHaveLength(0);

    const retry = await adminA.request(`/v1/admin/disputes/${t.id}/resolve`, {
      method: 'POST',
      body: { status: 'RESOLVED_DENIED', resolution: 'Rejected at commit' },
    });
    expect(retry.status).toBe(200);
    const committed = await rows(t.id);
    expect(committed.resolved).toBe(1);
    expect(committed.audits).toBe(1);
    expect(committed.notices).toHaveLength(1);
  });

  // Last on purpose: it revokes every session of `adminA`'s account. Logins
  // are rate-limited per client IP, so the suite reuses sessions rather than
  // re-authenticating afterwards.
  it('a session revoked while the admin page is open cannot decide', async () => {
    const t = await openTicket();
    const elsewhere = await httpSession(h).login(h.fixture.users.reviewer);
    expect((await elsewhere.request('/v1/auth/logout-all', { method: 'POST' })).status).toBe(204);
    const late = await adminA.request(`/v1/admin/disputes/${t.id}/resolve`, {
      method: 'POST',
      body: { status: 'RESOLVED_DENIED', resolution: 'After revocation' },
    });
    expect(late.status).toBe(401);
    expect((await rows(t.id)).dispute.status).toBe('OPEN');
  });
});
