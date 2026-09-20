import { fork, spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { disputeHttpApp, type DisputeHttpApp } from '../support/dispute-http-app';
const enabled = process.env.RUN_DISPUTE_BROWSER === '1';
(enabled ? describe : describe.skip)('Full dispute browser with real API/DB', () => {
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
  it('completes draft -> evidence -> information -> agreement -> decision -> independent appeal -> closure', async () => {
    h = await disputeHttpApp();
    directory = await mkdtemp(join(tmpdir(), 's12-browser-'));
    const webRoot = resolve(__dirname, '../../..', 'web');
    const viteBin = join(webRoot, 'node_modules/vite/bin/vite.js');
    const port = Number(process.env.DISPUTE_TEST_WEB_PORT ?? 14234),
      web = `http://127.0.0.1:${port}`;
    vite = spawn(
      process.execPath,
      [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      {
        cwd: webRoot,
        env: { ...process.env, VITE_API_URL: h.url, VITE_DISPUTE_INTAKE_V1: 'true' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const logs: string[] = [];
    let bootError: Error | undefined;
    vite.on('error', (error) => {
      bootError = error;
    });
    vite.stdout?.on('data', (x) => logs.push(String(x)));
    vite.stderr?.on('data', (x) => logs.push(String(x)));
    for (let tries = 0; tries < 100; tries++) {
      if (bootError) throw bootError;
      if (vite.exitCode !== null)
        throw new Error(`Vite boot failed: ${logs.join('').slice(-2000)}`);
      try {
        if ((await fetch(web)).ok) break;
      } catch {
        /* The bounded loop retries until the local server is ready. */
      }
      await new Promise((r) => setTimeout(r, 200));
      if (tries === 99) throw new Error('Vite did not become ready');
    }
    const output = resolve(process.env.DISPUTE_BROWSER_OUTPUT ?? join(directory, 'evidence'));
    await mkdir(output, { recursive: true });
    const bookingId = await h.fixture.booking();
    const credentials = Object.fromEntries(
      Object.entries(h.fixture.users).map(([role, id]) => [
        role,
        { id, email: `${id}@example.test`, password: h.fixture.password },
      ]),
    );
    const child = fork(join(webRoot, 'e2e/support/dispute-workspace-browser.cjs'), [], {
      cwd: webRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const childLogs: string[] = [];
    child.stdout?.on('data', (x) => childLogs.push(String(x)));
    child.stderr?.on('data', (x) => childLogs.push(String(x)));
    const completed = new Promise<void>((resolveDone, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Browser acceptance exceeded its bounded timeout'));
      }, 480000);
      let failure: string | undefined;
      child.on('message', async (message: unknown) => {
        const m = message as {
          id?: number;
          kind: string;
          payload?: Record<string, string>;
          error?: string;
        };
        if (m.kind === 'failure') {
          failure = m.error;
          return;
        }
        if (!m.id) return;
        try {
          let data: unknown = true;
          if (m.kind === 'otp') data = h.otp(m.payload!.email);
          else if (m.kind === 'scan') data = await h.fixture.evidence.scanOne();
          else if (m.kind === 'caseCreated') {
            const row = await h.fixture.db.disputeStatement.findFirstOrThrow({
              where: { disputeId: m.payload!.caseId },
            });
            expect(row.contentCipher).not.toContain(m.payload!.privateText);
            expect(
              await h.fixture.db.disputePrivateDraft.count({
                where: { bookingId, erasedAt: null },
              }),
            ).toBe(0);
          } else if (m.kind === 'closed') {
            const id = m.payload!.caseId;
            const w = await h.fixture.db.disputeWorkspace.findUniqueOrThrow({
              where: { disputeId: id },
            });
            expect(w.state).toBe('CLOSED');
            const decisions = await h.fixture.db.disputeDecisionRecord.findMany({
              where: { disputeId: id },
              orderBy: { createdAt: 'asc' },
            });
            expect(decisions).toHaveLength(2);
            expect(decisions[1].supersedesId).toBe(decisions[0].id);
            expect(decisions[1].decidedById).not.toBe(decisions[0].decidedById);
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
            new Error(failure ?? `Browser failed ${code}: ${childLogs.join('').slice(-4000)}`),
          );
      });
    });
    child.send({ kind: 'start', data: { api: h.url, web, output, bookingId, credentials } });
    await completed;
  });
});
