/* eslint-disable @typescript-eslint/no-explicit-any --
 * Lazily loaded Prisma client; see outbox.integration.spec.ts. */
// R22 — independent outbox worker PROCESSES against real Postgres.
//
// In-process tests cannot prove crash recovery: a jest "crash" leaves the
// connection, its open transaction and the event loop alive. Here each worker
// is a separate Node process running the COMPILED worker
// (r22-support/outbox-worker-child.cjs), and a crash is a hard kill, which
// drops its database connection and with it any open delivery transaction.
//
// Gated twice: RUN_DB_INTEGRATION=1 (real Postgres) AND
// RUN_R22_WORKER_PROCESS=1 (requires `pnpm --filter @homeservicemarketplace/api
// build` first, like the dispute worker process suite). Requested as a CI job
// in docs/production-readiness/r22/shared-change-requests/CR-04-ci-job.md.

export {};

import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';

import { acquireAdvisoryLock, type HeldLock } from '../support/db-isolation';
import {
  cleanup,
  effectsFor,
  ensureUser,
  loadOutbox,
  R22_AGGREGATE,
  R22_PREFIX,
  waitFor,
} from './r22-support/outbox-harness';

const enabled =
  process.env.RUN_DB_INTEGRATION === '1' && process.env.RUN_R22_WORKER_PROCESS === '1';
const d = enabled ? describe : describe.skip;

jest.setTimeout(180_000);

interface Child {
  proc: ChildProcess;
  lines: any[];
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

d('R22 outbox worker processes (real Postgres, compiled worker)', () => {
  let prisma: any;
  let repo: any;
  let lock: HeldLock;
  const userId = `${R22_PREFIX}process-user`;
  const children = new Set<ChildProcess>();
  const childScript = join(__dirname, 'r22-support', 'outbox-worker-child.cjs');

  function start(label: string, env: Record<string, string> = {}): Child {
    const proc = spawn(process.execPath, [childScript], {
      cwd: join(__dirname, '..', '..'),
      // Narrow environment: the database URL and what Node needs to run. No
      // application secrets are inherited from the jest process.
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
        NODE_ENV: 'test',
        DATABASE_URL: process.env.DATABASE_URL,
        R22_WORKER_LABEL: label,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    children.add(proc);
    const lines: any[] = [];
    let buffer = '';
    proc.stdout?.on('data', (chunk) => {
      buffer += String(chunk);
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('{"t"')) lines.push(JSON.parse(line));
      }
    });
    let stderr = '';
    proc.stderr?.on('data', (chunk) => (stderr += String(chunk)));
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      proc.once('exit', (code, signal) => {
        children.delete(proc);
        if (code !== 0 && signal === null && stderr) process.stderr.write(stderr);
        resolve({ code, signal });
      }),
    );
    return { proc, lines, exited };
  }

  async function ready(child: Child) {
    await waitFor(async () => child.lines.some((l) => l.t === 'ready'), 'worker never ready');
  }

  async function enqueueMany(n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const e = await repo.enqueue({
        aggregateType: R22_AGGREGATE,
        aggregateId: 'agg-r22-process',
        eventType: 'r22.process',
        payload: { userId },
        availableAt: new Date(Date.now() - 1_000),
      });
      ids.push(e.id);
    }
    return ids;
  }

  async function statuses(ids: string[]) {
    const rows = await prisma.outboxEvent.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, claimedBy: true, attempts: true },
    });
    return rows;
  }

  async function allProcessed(ids: string[]) {
    const rows = await statuses(ids);
    return rows.length === ids.length && rows.every((r: any) => r.status === 'PROCESSED');
  }

  beforeAll(async () => {
    await access(
      join(__dirname, '..', '..', 'dist', 'infrastructure', 'outbox', 'outbox.worker.js'),
    );
    lock = await acquireAdvisoryLock('outbox', 'exclusive');
    const loaded = loadOutbox();
    prisma = loaded.prisma;
    repo = new loaded.OutboxRepository({ client: prisma });
    await cleanup(prisma);
    await ensureUser(prisma, userId);
  });

  afterEach(async () => {
    for (const child of children) child.kill('SIGKILL');
    await cleanup(prisma);
  });

  afterAll(async () => {
    for (const child of children) child.kill('SIGKILL');
    await cleanup(prisma);
    await prisma.user.deleteMany({ where: { id: { startsWith: R22_PREFIX } } });
    await lock?.release();
  });

  it('a worker killed mid-dispatch loses no committed intent and duplicates no effect', async () => {
    const ids = await enqueueMany(5);
    // A claims the whole batch and stalls inside the first delivery.
    const a = start('a', { R22_HANDLER_SLEEP_MS: '5000', R22_CLAIM_TIMEOUT_MS: '3000' });
    await ready(a);
    await waitFor(async () => a.lines.some((l) => l.t === 'handling'), 'A never dispatched');
    const claimedByA = (await statuses(ids)).filter((r: any) => r.status === 'PROCESSING');
    expect(claimedByA.length).toBe(5);

    // Crash: the delivery transaction dies with A's connection.
    a.proc.kill('SIGKILL');
    await a.exited;

    const b = start('b', { R22_CLAIM_TIMEOUT_MS: '3000' });
    await ready(b);
    await waitFor(() => allProcessed(ids), 'restarted worker never recovered the batch', 60_000);

    for (const id of ids) expect(await effectsFor(prisma, id)).toBe(1);
    // Crash recovery charges no attempt.
    for (const r of await statuses(ids)) expect(r.attempts).toBe(0);
    b.proc.send('shutdown');
    expect(await b.exited).toEqual({ code: 0, signal: null });
  });

  it('two concurrent worker processes drain one backlog with exactly one effect per event', async () => {
    const ids = await enqueueMany(40);
    const a = start('a', { R22_BATCH_SIZE: '5', R22_HANDLER_SLEEP_MS: '20' });
    const b = start('b', { R22_BATCH_SIZE: '5', R22_HANDLER_SLEEP_MS: '20' });
    await Promise.all([ready(a), ready(b)]);
    await waitFor(() => allProcessed(ids), 'backlog never drained', 90_000);

    const counts = await Promise.all(ids.map((id) => effectsFor(prisma, id)));
    expect(counts.every((n) => n === 1)).toBe(true);
    const handledByA = a.lines.filter((l) => l.t === 'handling').length;
    const handledByB = b.lines.filter((l) => l.t === 'handling').length;
    // Every event entered a handler exactly once across both processes.
    expect(handledByA + handledByB).toBe(40);
    // Both processes did real work (the claim spreads the backlog).
    expect(handledByA).toBeGreaterThan(0);
    expect(handledByB).toBeGreaterThan(0);

    a.proc.send('shutdown');
    b.proc.send('shutdown');
    expect(await a.exited).toEqual({ code: 0, signal: null });
    expect(await b.exited).toEqual({ code: 0, signal: null });
  });

  it('graceful shutdown hands its batch back at once and a restarted worker finishes it', async () => {
    const ids = await enqueueMany(6);
    // Claim timeout far above the test's runtime: recovery must come from the
    // explicit release, not from the visibility timeout.
    const a = start('a', { R22_HANDLER_SLEEP_MS: '800', R22_CLAIM_TIMEOUT_MS: '600000' });
    await ready(a);
    await waitFor(async () => a.lines.some((l) => l.t === 'handling'), 'A never dispatched');

    if (process.platform === 'win32') a.proc.send('shutdown');
    else a.proc.kill('SIGTERM');
    expect(await a.exited).toEqual({ code: 0, signal: null });
    expect(a.lines.some((l) => l.t === 'stopped')).toBe(true);

    const afterStop = await statuses(ids);
    expect(afterStop.filter((r: any) => r.status === 'PROCESSING')).toEqual([]);
    const done = afterStop.filter((r: any) => r.status === 'PROCESSED').length;
    expect(done).toBeGreaterThanOrEqual(1);
    expect(done).toBeLessThan(6);

    const b = start('b', { R22_CLAIM_TIMEOUT_MS: '600000' });
    await ready(b);
    await waitFor(() => allProcessed(ids), 'restarted worker never finished the batch', 30_000);
    for (const id of ids) expect(await effectsFor(prisma, id)).toBe(1);
    b.proc.send('shutdown');
    expect(await b.exited).toEqual({ code: 0, signal: null });
  });
});
