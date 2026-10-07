import { fork, spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { disputeHttpApp, httpSession, type DisputeHttpApp } from '../support/dispute-http-app';

// R17-D — Admin operations in a real browser against the real AppModule and
// PostgreSQL: settings authority and honesty, per-currency analytics, audit
// paging, user status with a revoked grant, Arabic layouts, and a session
// revoked while the screen is open. Same harness shape as the dispute browser
// specs. Test-only database actions run here, in the parent, over IPC.
// Its own gate: set only by the CI step that provides Chromium and the web app.
const enabled = process.env.RUN_ADMIN_BROWSER === '1';
(enabled ? describe : describe.skip)('R17-D admin operations browser (real API/DB)', () => {
  jest.setTimeout(900_000);
  let h: DisputeHttpApp;
  let vite: ChildProcess | undefined;
  let directory: string;
  let restoreSetting: (() => Promise<void>) | undefined;
  afterAll(async () => {
    await restoreSetting?.();
    if (vite?.pid && vite.exitCode === null && vite.signalCode === null) {
      vite.kill('SIGTERM');
      await Promise.race([
        new Promise((r) => vite!.once('exit', r)),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
    }
    await h?.dispose();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('keeps admin settings, analytics, audit and user status honest and authorized', async () => {
    h = await disputeHttpApp();
    const { db, users, prefix } = h.fixture;
    directory = await mkdtemp(join(tmpdir(), 'r17d-browser-'));
    const webRoot = resolve(__dirname, '../../..', 'web');
    const port = Number(process.env.R17D_TEST_WEB_PORT ?? 14238),
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
    for (let tries = 0; ; tries++) {
      if (vite.exitCode !== null)
        throw new Error(`Vite boot failed: ${logs.join('').slice(-2000)}`);
      try {
        if ((await fetch(web)).ok) break;
      } catch {
        /* The bounded loop retries until the local server is ready. */
      }
      if (tries === 99) throw new Error('Vite did not become ready');
      await new Promise((r) => setTimeout(r, 200));
    }
    const output = resolve(process.env.R17D_BROWSER_OUTPUT ?? join(directory, 'evidence'));
    await mkdir(output, { recursive: true });

    // ── Fixtures (synthetic, test-owned ids) ──────────────────────────
    const settingKey = 'verification_policy_max_documents';
    const before = await db.platformSetting.findUnique({ where: { key: settingKey } });
    restoreSetting = async () => {
      if (before)
        await db.platformSetting.update({
          where: { key: settingKey },
          data: { value: before.value as never, updatedBy: before.updatedBy },
        });
      else await db.platformSetting.deleteMany({ where: { key: settingKey } });
    };
    const profile = await db.providerProfile.findFirstOrThrow({
      where: { userId: users.provider },
    });
    // Completed yesterday (inside the dashboard's default 30-day range), in
    // two ISO test currencies with distinctive values: a cross-currency sum
    // (1,801) would be visible in the rendered text.
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    for (const [tag, currency, amount] of [
      ['xts', 'XTS', 123_400],
      ['xxx', 'XXX', 56_700],
    ] as const) {
      const id = `${prefix}r17d-browser-${tag}`;
      await db.serviceRequest.create({
        data: {
          id: `${id}-request`,
          seekerUserId: users.seeker,
          scheduleType: 'ASAP',
          addressSnapshot: {},
          status: 'COMPLETED',
        },
      });
      await db.bid.create({
        data: {
          id: `${id}-bid`,
          requestId: `${id}-request`,
          providerId: profile.id,
          amount: amount,
          pricingType: 'FIXED',
          status: 'ACCEPTED',
        },
      });
      await db.booking.create({
        data: {
          id,
          requestId: `${id}-request`,
          bidId: `${id}-bid`,
          seekerUserId: users.seeker,
          providerId: profile.id,
          priceAmount: amount,
          currency,
          status: 'COMPLETED',
        },
      });
      await db.bookingEvent.create({
        data: {
          bookingId: id,
          type: 'BOOKING_STATUS_CHANGED',
          metadata: { from: 'IN_PROGRESS', to: 'COMPLETED' },
          createdAt: yesterday,
        },
      });
    }
    // 60 audit rows for one actor: one full page and a partial second page.
    await db.auditEvent.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        userId: users.reader,
        type: 'ADMIN_SETTING_UPDATED' as const,
        createdAt: new Date(Date.parse('2026-03-01T00:00:00Z') + i * 1000),
        metadata: { key: `r17d-browser-${i}`, password: 'not-for-display' },
      })),
    });

    const adminGrant = await db.rolePermission.findFirstOrThrow({
      where: { role: { name: 'admin' }, permission: { key: 'user:write:any' } },
    });
    let grantRevoked = false;

    const child = fork(join(webRoot, 'e2e/support/r17-admin-operations-browser.cjs'), [], {
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
        }, 780_000);
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
            if (m.kind === 'otp') data = h.otp(m.payload!.email);
            else if (m.kind === 'setting')
              data =
                (await db.platformSetting.findUnique({ where: { key: m.payload!.key } }))?.value ??
                null;
            else if (m.kind === 'userStatus')
              data = (await db.user.findUniqueOrThrow({ where: { id: m.payload!.id } })).status;
            else if (m.kind === 'revokeWriteGrant') {
              await db.rolePermission.delete({
                where: {
                  roleId_permissionId: {
                    roleId: adminGrant.roleId,
                    permissionId: adminGrant.permissionId,
                  },
                },
              });
              grantRevoked = true;
            } else if (m.kind === 'restoreWriteGrant') {
              await db.rolePermission.create({
                data: { roleId: adminGrant.roleId, permissionId: adminGrant.permissionId },
              });
              grantRevoked = false;
            } else if (m.kind === 'logoutAll') {
              const elsewhere = await httpSession(h).login(users.reviewer);
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
            admin: { email: `${users.reviewer}@example.test`, password: h.fixture.password },
            target: { id: users.outsider, email: `${users.outsider}@example.test` },
            auditActor: users.reader,
            auditRows: 60,
            settingBefore: (before?.value as number | undefined) ?? 10,
            expect: { xts: '1,234', xxx: '567' },
          },
        });
      });
    } finally {
      if (grantRevoked)
        await db.rolePermission.create({
          data: { roleId: adminGrant.roleId, permissionId: adminGrant.permissionId },
        });
    }
    // Every step ran: a skipped or short-circuited step is not acceptance.
    expect(progress).toHaveLength(7);
  });
});
