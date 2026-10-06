import { fork, spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { disputeHttpApp, httpSession, type DisputeHttpApp } from '../support/dispute-http-app';

// R17-C — the legacy admin dispute surface in a real browser against the real
// AppModule and PostgreSQL: decision wording, a concurrent decision refused
// with an honest conflict and read-back, reload persistence, and the Arabic
// responsive matrix. Same harness shape as the C-7 workspace journey
// (dispute-workspace-browser.integration.spec.ts), which this does not replace.
const enabled = process.env.RUN_DISPUTE_BROWSER === '1';
(enabled ? describe : describe.skip)('R17-C legacy admin dispute browser (real API/DB)', () => {
  jest.setTimeout(600_000);
  let h: DisputeHttpApp;
  let vite: ChildProcess | undefined;
  let directory: string;
  afterAll(async () => {
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

  it('refuses a concurrent decision honestly and shows truthful EN/AR decision labels', async () => {
    h = await disputeHttpApp();
    directory = await mkdtemp(join(tmpdir(), 'r17c-browser-'));
    const webRoot = resolve(__dirname, '../../..', 'web');
    const port = Number(process.env.R17C_TEST_WEB_PORT ?? 14236),
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
        env: { ...process.env, VITE_API_URL: h.url, VITE_DISPUTE_INTAKE_V1: 'true' },
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
    const output = resolve(process.env.R17C_BROWSER_OUTPUT ?? join(directory, 'evidence'));
    await mkdir(output, { recursive: true });

    const { users, db } = h.fixture;
    const otherAdmin = await httpSession(h).login(users.independent);
    const reason = 'R17-C browser ticket';
    const opened = await otherAdmin.request<{ dispute: { id: string } }>('/v1/admin/disputes', {
      method: 'POST',
      body: { bookingId: await h.fixture.booking(), openedById: users.seeker, reason },
    });
    expect(opened.status).toBe(201);
    const ticketId = opened.body.dispute.id;

    const child = fork(join(webRoot, 'e2e/support/r17-legacy-dispute-browser.cjs'), [], {
      cwd: webRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const childLogs: string[] = [];
    child.stdout?.on('data', (x) => childLogs.push(String(x)));
    child.stderr?.on('data', (x) => childLogs.push(String(x)));
    const progress: string[] = [];
    const completed = new Promise<void>((resolveDone, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Browser acceptance exceeded its bounded timeout'));
      }, 420_000);
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
          else if (m.kind === 'decideElsewhere') {
            const decided = await otherAdmin.request(`/v1/admin/disputes/${ticketId}/resolve`, {
              method: 'POST',
              body: { status: 'RESOLVED_DENIED', resolution: 'Decided by the other admin' },
            });
            expect(decided.status).toBe(200);
          } else if (m.kind === 'verifyOneDecision') {
            const row = await db.dispute.findUniqueOrThrow({ where: { id: ticketId } });
            expect(row.status).toBe('RESOLVED_DENIED');
            expect(row.resolvedById).toBe(users.independent);
            expect(
              await db.disputeEvent.count({ where: { disputeId: ticketId, type: 'RESOLVED' } }),
            ).toBe(1);
            expect(
              await db.notification.count({
                where: {
                  userId: users.seeker,
                  metadata: { path: ['disputeId'], equals: ticketId },
                },
              }),
            ).toBe(1);
          } else throw new Error('Unsupported private test operation');
          child.send({ reply: m.id, data });
        } catch {
          child.send({ reply: m.id, error: 'Private acceptance assertion failed' });
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
    });
    child.send({
      kind: 'start',
      data: {
        api: h.url,
        web,
        output,
        ticketId,
        reason,
        admin: { email: `${users.reviewer}@example.test`, password: h.fixture.password },
      },
    });
    await completed;
    // Every step ran: a skipped or short-circuited step is not acceptance.
    expect(progress).toHaveLength(5);
  });
});
