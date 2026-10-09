import { fork, spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { hash as hashPassword } from 'argon2';

import { normaliseCityKey } from '../../src/shared/geo/service-area';
import { disputeHttpApp, httpSession, type DisputeHttpApp } from '../support/dispute-http-app';

// R17-E — the provider journey in a real browser against the real AppModule,
// PostgreSQL and Redis, with both work-access axes armed as in production.
// Real Vite, real password/OTP login, no route interception and no mocked API
// response. The seeker's accept, a second provider and the "elsewhere"
// session act over real HTTP from this parent; database reads and the
// standing/grant changes an admin workflow would make cross a private IPC
// pipe to the browser child, which never sees a credential it did not type.
//
// Its own gate: set only by the CI step that provides Chromium and the web app.
const enabled = process.env.RUN_PROVIDER_BROWSER === '1';
(enabled ? describe : describe.skip)('R17-E provider surfaces browser (real API/DB)', () => {
  jest.setTimeout(1_200_000);
  let h: DisputeHttpApp;
  let vite: ChildProcess | undefined;
  let directory: string;
  const X = 'it-r17eb-';
  const CITY = 'R17EB Town';
  const KEY = normaliseCityKey(CITY)!;
  const cat = { a: `${X}cat-a`, foreign: `${X}cat-foreign` };
  const prov = {
    a: { user: `${X}pa`, profile: `${X}pa-pp` },
    b: { user: `${X}pb`, profile: `${X}pb-pp` },
  };
  const req = { match: `${X}req-match`, foreign: `${X}req-foreign` };
  let seq = 0;

  async function clean() {
    const { db } = h.fixture;
    const ids = { startsWith: X };
    // Notifications this suite caused, and the post-commit announce (R17-B)
    // each one enqueued. The announce is keyed by the notification's cuid, not
    // by this prefix, so it is found through the notification; left behind, an
    // exclusive outbox consumer (outbox.integration.spec.ts) would claim it.
    const notes = {
      OR: [
        { userId: { startsWith: X } },
        {
          userId: h.fixture.users.seeker,
          metadata: { path: ['requestId'], string_starts_with: X },
        },
      ],
    };
    const noteIds = (await db.notification.findMany({ where: notes, select: { id: true } })).map(
      (n) => n.id,
    );
    const announces = await db.outboxEvent.findMany({
      where: { aggregateType: 'Notification', aggregateId: { in: noteIds } },
      select: { id: true },
    });
    await db.outboxHandlerRun.deleteMany({
      where: { eventId: { in: announces.map((e) => e.id) } },
    });
    await db.outboxEvent.deleteMany({ where: { id: { in: announces.map((e) => e.id) } } });
    await db.notification.deleteMany({ where: notes });
    // Booking conversations are keyed by booking, request ones by request.
    const conversation = { OR: [{ requestId: ids }, { booking: { requestId: ids } }] };
    await db.message.deleteMany({ where: { conversation } });
    await db.conversationParticipant.deleteMany({ where: { conversation } });
    await db.conversation.deleteMany({ where: conversation });
    await db.bookingEvent.deleteMany({ where: { booking: { requestId: ids } } });
    await db.booking.deleteMany({ where: { requestId: ids } });
    await db.bid.deleteMany({ where: { requestId: ids } });
    await db.serviceRequestEvent.deleteMany({ where: { requestId: ids } });
    await db.serviceRequest.deleteMany({ where: { id: ids } });
    await db.auditEvent.deleteMany({ where: { userId: { startsWith: X } } });
    await db.providerWorkAccessGrant.deleteMany({ where: { providerProfileId: ids } });
    await db.providerProfileServiceCategory.deleteMany({ where: { providerProfileId: ids } });
    await db.providerProfile.deleteMany({ where: { id: ids } });
    await db.serviceCategory.deleteMany({ where: { id: ids } });
    await db.session.deleteMany({ where: { userId: ids } });
    await db.userRole.deleteMany({ where: { userId: ids } });
    await db.user.deleteMany({ where: { id: ids } });
  }

  async function openRequest(id: string, categoryId: string, description: string) {
    await h.fixture.db.serviceRequest.create({
      data: {
        id,
        seekerUserId: h.fixture.users.seeker,
        categoryId,
        description,
        scheduleType: 'ASAP',
        status: 'OPEN_FOR_BIDS',
        addressSnapshot: {
          label: null,
          line1: '7 R17E Street',
          city: CITY,
          country: 'SY',
          lat: null,
          lng: null,
          cityKey: KEY,
        },
        locationCityKey: KEY,
      },
    });
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

  it('keeps provider feed, bids, bookings and capability changes authoritative in the browser', async () => {
    h = await disputeHttpApp({
      env: { WORK_ACCESS_ENFORCED: 'true', VERIFICATION_ENFORCED: 'true' },
    });
    const { db } = h.fixture;
    await clean();
    directory = await mkdtemp(join(tmpdir(), 'r17e-browser-'));
    const webRoot = resolve(__dirname, '../../..', 'web');
    const port = Number(process.env.R17E_TEST_WEB_PORT ?? 14239),
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

    // ── Fixtures: synthetic, test-owned ids ───────────────────────────────
    const passwordHash = await hashPassword(h.fixture.password!);
    const roles = await db.role.findMany({ where: { name: { in: ['provider', 'customer'] } } });
    await db.serviceCategory.create({
      data: {
        id: cat.a,
        slug: cat.a,
        labelEn: 'R17E Plumbing',
        labelAr: 'سباكة ر١٧',
        icon: 'wrench',
        isLeaf: true,
      },
    });
    await db.serviceCategory.create({
      data: {
        id: cat.foreign,
        slug: cat.foreign,
        labelEn: 'R17E Foreign',
        labelAr: 'أجنبي ر١٧',
        icon: 'wrench',
        isLeaf: true,
      },
    });
    for (const [key, p] of Object.entries(prov)) {
      await db.user.create({
        data: {
          id: p.user,
          email: `${p.user}@example.test`,
          firstName: 'R17EB',
          lastName: key,
          status: 'ACTIVE',
          isActive: true,
          emailVerifiedAt: new Date(),
          passwordHash,
        },
      });
      for (const role of roles)
        await db.userRole.create({ data: { userId: p.user, roleId: role.id } });
      await db.providerProfile.create({
        data: {
          id: p.profile,
          userId: p.user,
          displayName: `R17EB ${key}`,
          initials: 'RB',
          status: 'ACTIVE',
          onboardingState: 'ACCEPTED',
          standingState: 'GOOD',
          verificationState: 'VERIFIED',
          serviceAreaCity: CITY,
          serviceAreaCityKey: KEY,
          serviceCategories: { create: [{ serviceCategoryId: cat.a }] },
        },
      });
      await db.providerWorkAccessGrant.create({
        data: {
          id: `${p.profile}-grant`,
          providerProfileId: p.profile,
          status: 'ACTIVE',
          source: 'MANUAL_OVERRIDE',
          reason: 'R17-E browser fixture',
          grantedAt: new Date(Date.now() - 60_000),
        },
      });
      h.enrol(p.user);
    }
    await openRequest(req.match, cat.a, 'R17E kitchen tap leaks under the sink');
    await openRequest(req.foreign, cat.foreign, 'R17E foreign category request');

    // Parent-side real HTTP sessions (seeker accepts; provider B is the
    // foreign actor; provider A "elsewhere" is a second device).
    const seeker = await httpSession(h).login(h.fixture.users.seeker);
    const foreign = await httpSession(h).login(prov.b.user);
    const elsewhere = await httpSession(h).login(prov.a.user);

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
    const output = resolve(process.env.R17E_BROWSER_OUTPUT ?? join(directory, 'evidence'));
    await mkdir(output, { recursive: true });

    const standing = (standingState: 'GOOD' | 'RESTRICTED') =>
      db.providerProfile.update({ where: { id: prov.a.profile }, data: { standingState } });
    const grant = (live: boolean) =>
      db.providerWorkAccessGrant.update({
        where: { id: `${prov.a.profile}-grant` },
        data: live
          ? { status: 'ACTIVE', revokedAt: null }
          : { status: 'REVOKED', revokedAt: new Date() },
      });

    const child = fork(join(webRoot, 'e2e/support/r17-provider-surfaces-browser.cjs'), [], {
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
            else if (m.kind === 'bidStatus')
              data = (await db.bid.findUniqueOrThrow({ where: { id: p.id! } })).status;
            else if (m.kind === 'bookingStatus')
              data = (await db.booking.findUniqueOrThrow({ where: { id: p.id! } })).status;
            else if (m.kind === 'bookingEvents')
              data = await db.bookingEvent.count({ where: { bookingId: p.id! } });
            else if (m.kind === 'accept') {
              const res = await seeker.request<{ booking: { id: string } }>(
                `/v1/me/requests/${p.requestId}/bids/${p.bidId}/accept`,
                { method: 'POST', body: {} },
              );
              if (res.status !== 200) throw new Error(`accept ${res.status}`);
              data = res.body.booking.id;
            } else if (m.kind === 'newBooking') {
              const requestId = `${X}req-n${++seq}`;
              await openRequest(requestId, cat.a, `R17E booking ${seq}`);
              const bid = await elsewhere.request<{ bid: { id: string } }>('/v1/provider/bids', {
                method: 'POST',
                body: { requestId, amount: 90 + seq, pricingType: 'FIXED' },
              });
              if (bid.status !== 201) throw new Error(`bid ${bid.status}`);
              const res = await seeker.request<{ booking: { id: string } }>(
                `/v1/me/requests/${requestId}/bids/${bid.body.bid.id}/accept`,
                { method: 'POST', body: {} },
              );
              if (res.status !== 200) throw new Error(`accept ${res.status}`);
              data = { requestId, bookingId: res.body.booking.id };
            } else if (m.kind === 'cancelElsewhere') {
              const res = await elsewhere.request(`/v1/provider/bookings/${p.id}/cancel`, {
                method: 'POST',
                body: {},
              });
              data = res.status;
            } else if (m.kind === 'foreignAttempts') {
              data = {
                withdraw: (
                  await foreign.request(`/v1/provider/bids/${p.bidId}/withdraw`, {
                    method: 'POST',
                    body: {},
                  })
                ).status,
                read: (await foreign.request(`/v1/provider/bookings/${p.bookingId}`)).status,
                start: (
                  await foreign.request(`/v1/provider/bookings/${p.bookingId}/start`, {
                    method: 'POST',
                    body: {},
                  })
                ).status,
              };
            } else if (m.kind === 'restrict') await standing('RESTRICTED');
            else if (m.kind === 'unrestrict') await standing('GOOD');
            else if (m.kind === 'revokeGrant') await grant(false);
            else if (m.kind === 'restoreGrant') await grant(true);
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
            api: h.url,
            web,
            output,
            provider: { email: `${prov.a.user}@example.test`, password: h.fixture.password },
            requests: req,
            foreignCategory: cat.foreign,
          },
        });
      });
    } finally {
      await standing('GOOD').catch(() => undefined);
      await grant(true).catch(() => undefined);
    }
    // Every step ran: a skipped or short-circuited step is not acceptance.
    expect(progress).toHaveLength(14);
  });
});
