import { fork, spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { hash as hashPassword } from 'argon2';

import { normaliseCityKey } from '../../src/shared/geo/service-area';
import { disputeHttpApp, httpSession, type DisputeHttpApp } from '../support/dispute-http-app';

// E-18 — every provider bid, and the booking of every accepted bid, is
// reachable in a real browser: real Vite, real password/OTP login, the real
// AppModule, PostgreSQL and Redis, both work-access axes armed. Every page the
// screen shows is a real API response; one labelled fault step fails a real
// page-2 request at the network layer to prove retry, and substitutes
// nothing. Database reads and the session revocation cross a private IPC
// pipe to the browser child.
//
// Same gate as the R17-E browser journeys: set by the CI step that provides
// Chromium and the web app.
const enabled = process.env.RUN_PROVIDER_BROWSER === '1';
(enabled ? describe : describe.skip)('E-18 provider My Bids pagination browser', () => {
  jest.setTimeout(1_200_000);
  let h: DisputeHttpApp;
  let vite: ChildProcess | undefined;
  let directory: string;
  const X = 'it-mybidsb-';
  const CITY = 'MyBidsB Town';
  const KEY = normaliseCityKey(CITY)!;
  const CATEGORY = `${X}cat`;
  const PROVIDER = { user: `${X}p`, profile: `${X}p-pp` };
  const PAGE = 20;
  const ACCEPTED = 60; // more bookings than the first bookings page (50)
  const PENDING = 5;
  const OWNED = ACCEPTED + PENDING;

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

  afterAll(async () => {
    if (vite?.pid && vite.exitCode === null && vite.signalCode === null) {
      vite.kill('SIGTERM');
      await Promise.race([
        new Promise((r) => vite!.once('exit', r)),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    }
    if (h) await clean().catch(() => undefined);
    await h?.dispose();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('reaches every bid and every accepted bid’s booking, page by page, through failure and sign-out', async () => {
    h = await disputeHttpApp({
      env: { WORK_ACCESS_ENFORCED: 'true', VERIFICATION_ENFORCED: 'true' },
    });
    const { db } = h.fixture;
    await clean();
    directory = await mkdtemp(join(tmpdir(), 'mybids-browser-'));
    const webRoot = resolve(__dirname, '../../..', 'web');
    const port = Number(process.env.MYBIDS_TEST_WEB_PORT ?? 14242),
      web = `http://127.0.0.1:${port}`;
    vite = spawn(
      process.execPath,
      [
        join(webRoot, 'node_modules/vite/bin/vite.js'),
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--strictPort',
      ],
      {
        cwd: webRoot,
        env: { ...process.env, VITE_API_URL: h.url },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const logs: string[] = [];
    vite.stdout?.on('data', (x) => logs.push(String(x)));
    vite.stderr?.on('data', (x) => logs.push(String(x)));

    // ── Fixtures: one provider, four pages of bids ───────────────────────
    const passwordHash = await hashPassword(h.fixture.password!);
    const role = await db.role.findUniqueOrThrow({ where: { name: 'provider' } });
    await db.serviceCategory.create({
      data: {
        id: CATEGORY,
        slug: CATEGORY,
        labelEn: 'MyBids Plumbing',
        labelAr: 'سباكة العروض',
        icon: 'wrench',
        isLeaf: true,
      },
    });
    await db.user.create({
      data: {
        id: PROVIDER.user,
        email: `${PROVIDER.user}@example.test`,
        firstName: 'MyBids',
        lastName: 'Provider',
        status: 'ACTIVE',
        isActive: true,
        emailVerifiedAt: new Date(),
        passwordHash,
      },
    });
    await db.userRole.create({ data: { userId: PROVIDER.user, roleId: role.id } });
    await db.providerProfile.create({
      data: {
        id: PROVIDER.profile,
        userId: PROVIDER.user,
        displayName: 'MyBids Provider',
        initials: 'MB',
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
        id: `${PROVIDER.profile}-grant`,
        providerProfileId: PROVIDER.profile,
        status: 'ACTIVE',
        source: 'MANUAL_OVERRIDE',
        reason: 'E-18 browser fixture',
        grantedAt: new Date(Date.now() - 60_000),
      },
    });
    h.enrol(PROVIDER.user);
    // Ties on submittedAt (the id tiebreak decides) across page boundaries.
    // Bookings are scheduled in the opposite order, so the newest accepted
    // bids have the bookings that the first bookings page does not reach.
    const base = Date.UTC(2026, 9, 1, 9);
    const tags = Array.from({ length: OWNED }, (_, i) => `${X}${String(i).padStart(3, '0')}`);
    await db.serviceRequest.createMany({
      data: tags.map((tag, i) => ({
        id: `${tag}-req`,
        seekerUserId: h.fixture.users.seeker,
        categoryId: CATEGORY,
        description: `MyBids ${i}`,
        scheduleType: 'LATER' as const,
        status: i < ACCEPTED ? ('BOOKED' as const) : ('OPEN_FOR_BIDS' as const),
        addressSnapshot: { city: CITY, country: 'SY', cityKey: KEY },
        locationCityKey: KEY,
      })),
    });
    await db.bid.createMany({
      data: tags.map((tag, i) => ({
        id: `${tag}-bid`,
        requestId: `${tag}-req`,
        providerId: PROVIDER.profile,
        amount: 100 + i,
        pricingType: 'FIXED' as const,
        status: i < ACCEPTED ? ('ACCEPTED' as const) : ('PENDING' as const),
        submittedAt: new Date(base - Math.floor(i / 3) * 60_000),
      })),
    });
    await db.booking.createMany({
      data: tags.slice(0, ACCEPTED).map((tag, i) => ({
        id: `${tag}-bk`,
        requestId: `${tag}-req`,
        bidId: `${tag}-bid`,
        seekerUserId: h.fixture.users.seeker,
        providerId: PROVIDER.profile,
        status: 'SCHEDULED' as const,
        scheduledAt: new Date(base + i * 3_600_000),
        priceAmount: 100 + i,
      })),
    });
    // A second device of the same provider, to revoke every session.
    const elsewhere = await httpSession(h).login(PROVIDER.user);

    for (let tries = 0; ; tries++) {
      if (vite.exitCode !== null)
        throw new Error(`Vite boot failed: ${logs.join('').slice(-2000)}`);
      try {
        if ((await fetch(web)).ok) break;
      } catch {
        /* The bounded loop retries until the local server is ready. */
      }
      if (tries === 149) throw new Error('Vite did not become ready');
      await new Promise((r) => setTimeout(r, 200));
    }
    const output = resolve(process.env.MYBIDS_BROWSER_OUTPUT ?? join(directory, 'evidence'));
    await mkdir(output, { recursive: true });

    const child = fork(join(webRoot, 'e2e/support/provider-my-bids-browser.cjs'), [], {
      cwd: webRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const childLogs: string[] = [];
    child.stdout?.on('data', (x) => childLogs.push(String(x)));
    child.stderr?.on('data', (x) => childLogs.push(String(x)));
    const progress: string[] = [];
    await new Promise<void>((resolveDone, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Browser acceptance exceeded its bounded timeout'));
      }, 1_080_000);
      let failure: string | undefined;
      child.on('message', async (message: unknown) => {
        const m = message as {
          id?: number;
          kind: string;
          payload?: Record<string, string>;
          error?: string;
          name?: string;
        };
        if (m.kind === 'failure') {
          failure = m.error;
          return;
        }
        if (m.kind === 'progress') {
          progress.push(m.name!);
          return;
        }
        if (!m.id) return;
        try {
          let data: unknown = true;
          const p = m.payload ?? {};
          if (m.kind === 'otp') data = h.otp(p.email!);
          else if (m.kind === 'truth')
            // The repository's ORDER BY, read in one query: ground truth,
            // with the booking each bid has.
            data = (
              await db.bid.findMany({
                where: { providerId: PROVIDER.profile, deletedAt: null },
                orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
                select: { id: true, booking: { select: { id: true } } },
              })
            ).map((b) => ({ id: b.id, bookingId: b.booking?.id ?? null }));
          else if (m.kind === 'firstBookingsPage')
            // The bid ids whose bookings the first bookings page shows.
            data = (
              await db.booking.findMany({
                where: { providerId: PROVIDER.profile, deletedAt: null },
                orderBy: [
                  { scheduledAt: { sort: 'desc', nulls: 'last' } },
                  { createdAt: 'desc' },
                  { id: 'desc' },
                ],
                take: 50,
                select: { bidId: true },
              })
            ).map((b) => b.bidId);
          else if (m.kind === 'logoutAll') {
            const res = await elsewhere.request('/v1/auth/logout-all', { method: 'POST' });
            if (res.status !== 204) throw new Error(`logout-all ${res.status}`);
          } else throw new Error('Unsupported private test operation');
          child.send({ reply: m.id, data });
        } catch {
          child.send({ reply: m.id, error: 'Private acceptance operation failed' });
        }
      });
      child.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolveDone();
        else
          reject(
            new Error(
              [
                failure ?? `Browser failed ${code}`,
                '--- browser log ---',
                childLogs.join('').slice(-4000),
              ].join('\n'),
            ),
          );
      });
      child.send({
        kind: 'start',
        data: {
          web,
          output,
          owned: OWNED,
          pageSize: PAGE,
          provider: { email: `${PROVIDER.user}@example.test`, password: h.fixture.password },
        },
      });
    });
    // Every step ran: a skipped or short-circuited step is not acceptance.
    expect(progress).toHaveLength(8);
  });
});
