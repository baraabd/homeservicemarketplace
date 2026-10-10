import { fork, spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { hash as hashPassword } from 'argon2';

import { normaliseCityKey } from '../../src/shared/geo/service-area';
import { disputeHttpApp, httpSession, type DisputeHttpApp } from '../support/dispute-http-app';

// R17-E post-merge closure (CLOSURE-1) — every provider booking is reachable
// in a real browser: real Vite, real password/OTP login, the real AppModule,
// PostgreSQL and Redis, both work-access axes armed. Every page the screen
// shows is a real API response; one labelled fault step fails a real page-2
// request at the network layer to prove retry, and substitutes nothing.
// Database reads and the standing changes an admin workflow would make cross
// a private IPC pipe to the browser child.
//
// Same gate as the R17-E browser journey: set by the CI step that provides
// Chromium and the web app.
const enabled = process.env.RUN_PROVIDER_BROWSER === '1';
(enabled ? describe : describe.skip)('R17-E closure: provider bookings pagination browser', () => {
  jest.setTimeout(1_200_000);
  let h: DisputeHttpApp;
  let vite: ChildProcess | undefined;
  let directory: string;
  const X = 'it-r17xb-';
  const CITY = 'R17XB Town';
  const KEY = normaliseCityKey(CITY)!;
  const CATEGORY = `${X}cat`;
  const PROVIDER = { user: `${X}p`, profile: `${X}p-pp` };
  const PAGE = 50;
  const OWNED = 2 * PAGE + 5;

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

  it('reaches every provider booking page by page, through failure, restriction and sign-out', async () => {
    h = await disputeHttpApp({
      env: { WORK_ACCESS_ENFORCED: 'true', VERIFICATION_ENFORCED: 'true' },
    });
    const { db } = h.fixture;
    await clean();
    directory = await mkdtemp(join(tmpdir(), 'r17x-browser-'));
    const webRoot = resolve(__dirname, '../../..', 'web');
    const port = Number(process.env.R17X_TEST_WEB_PORT ?? 14241),
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

    // ── Fixtures: one provider with three pages of accepted work ─────────
    const passwordHash = await hashPassword(h.fixture.password!);
    const role = await db.role.findUniqueOrThrow({ where: { name: 'provider' } });
    await db.serviceCategory.create({
      data: {
        id: CATEGORY,
        slug: CATEGORY,
        labelEn: 'R17X Plumbing',
        labelAr: 'سباكة ر١٧',
        icon: 'wrench',
        isLeaf: true,
      },
    });
    await db.user.create({
      data: {
        id: PROVIDER.user,
        email: `${PROVIDER.user}@example.test`,
        firstName: 'R17XB',
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
        displayName: 'R17XB Provider',
        initials: 'RB',
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
        reason: 'R17-E closure browser fixture',
        grantedAt: new Date(Date.now() - 60_000),
      },
    });
    h.enrol(PROVIDER.user);
    // Ties on scheduledAt and createdAt, and ASAP bookings that sort last, so
    // the page boundaries fall across every ordering key.
    const base = Date.UTC(2026, 10, 1, 9);
    const tags = Array.from({ length: OWNED }, (_, i) => `${X}${String(i).padStart(3, '0')}`);
    await db.serviceRequest.createMany({
      data: tags.map((tag, i) => ({
        id: `${tag}-req`,
        seekerUserId: h.fixture.users.seeker,
        categoryId: CATEGORY,
        description: `R17X booking ${i}`,
        scheduleType: i % 3 === 2 ? ('ASAP' as const) : ('LATER' as const),
        status: 'BOOKED' as const,
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
        status: 'ACCEPTED' as const,
      })),
    });
    await db.booking.createMany({
      data: tags.map((tag, i) => ({
        id: `${tag}-bk`,
        requestId: `${tag}-req`,
        bidId: `${tag}-bid`,
        seekerUserId: h.fixture.users.seeker,
        providerId: PROVIDER.profile,
        status: 'SCHEDULED' as const,
        scheduledAt: i % 3 === 2 ? null : new Date(base + Math.floor(i / 4) * 3_600_000),
        priceAmount: 100 + i,
        createdAt: new Date(base - Math.floor(i / 2) * 60_000),
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
    const output = resolve(process.env.R17X_BROWSER_OUTPUT ?? join(directory, 'evidence'));
    await mkdir(output, { recursive: true });

    const profile = (data: {
      standingState?: 'GOOD' | 'RESTRICTED';
      status?: 'ACTIVE' | 'SUSPENDED';
    }) => db.providerProfile.update({ where: { id: PROVIDER.profile }, data });

    const child = fork(join(webRoot, 'e2e/support/r17-e-closure-browser.cjs'), [], {
      cwd: webRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const childLogs: string[] = [];
    child.stdout?.on('data', (x) => childLogs.push(String(x)));
    child.stderr?.on('data', (x) => childLogs.push(String(x)));
    const progress: string[] = [];
    try {
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
              // The repository's ORDER BY, read in one query: ground truth.
              data = (
                await db.booking.findMany({
                  where: { providerId: PROVIDER.profile, deletedAt: null },
                  orderBy: [
                    { scheduledAt: { sort: 'desc', nulls: 'last' } },
                    { createdAt: 'desc' },
                    { id: 'desc' },
                  ],
                  select: { id: true },
                })
              ).map((b) => b.id);
            else if (m.kind === 'restrict') await profile({ standingState: 'RESTRICTED' });
            else if (m.kind === 'unrestrict') await profile({ standingState: 'GOOD' });
            else if (m.kind === 'suspend') await profile({ status: 'SUSPENDED' });
            else if (m.kind === 'unsuspend') await profile({ status: 'ACTIVE' });
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
    } finally {
      await profile({ standingState: 'GOOD', status: 'ACTIVE' }).catch(() => undefined);
    }
    // Every step ran: a skipped or short-circuited step is not acceptance.
    expect(progress).toHaveLength(10);
  });
});
