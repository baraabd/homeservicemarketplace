import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { workspaceFixture, type WorkspaceFixture } from '../support/dispute-workspace-fixture';

// The dedicated CI job builds the actual entry point and explicitly enables
// this process gate; importing services in Jest is not process acceptance.
const enabled = process.env.RUN_DISPUTE_WORKER === '1';
jest.setTimeout(120_000);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('worker-test-port-unavailable');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}
async function eventually<T>(
  read: () => Promise<T>,
  check: (value: T) => boolean,
  message: string,
) {
  const deadline = Date.now() + 40_000;
  do {
    const value = await read();
    if (check(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(message);
}
(enabled ? describe : describe.skip)(
  'Compiled dispute worker with real PostgreSQL and objects',
  () => {
    let f: WorkspaceFixture;
    const children = new Set<ChildProcess>();
    beforeAll(async () => {
      await access(join(process.cwd(), 'dist/dispute-maintenance.worker.js'));
      f = await workspaceFixture();
    });
    afterAll(async () => {
      for (const child of children) child.kill('SIGKILL');
      await f?.dispose();
    });
    async function start(mode: 'off' | 'shadow' | 'enforce', overrides: NodeJS.ProcessEnv = {}) {
      const port = await freePort(),
        token = randomUUID() + randomUUID();
      // Only the worker's narrow configuration is passed. No JWT, mail or
      // deployment credentials are inherited from the Jest application fixture.
      const child = spawn(process.execPath, ['dist/dispute-maintenance.worker.js'], {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH,
          NODE_ENV: 'test',
          DATABASE_URL: process.env.DATABASE_URL,
          DISPUTE_WORKER_MODE: mode,
          DISPUTE_WORKER_INTERVAL_MS: '1000',
          DISPUTE_WORKER_BATCH: '1',
          DISPUTE_WORKER_PORT: String(port),
          DISPUTE_PRIVATE_ACTIVE_KEY: String(f.configValues.DISPUTE_PRIVATE_ACTIVE_KEY),
          DISPUTE_PRIVATE_KEYS_JSON: String(f.configValues.DISPUTE_PRIVATE_KEYS_JSON),
          DISPUTE_WORKER_APPROVAL_REF: 'synthetic-process-test-not-production-approval',
          DISPUTE_WORKER_INFRA_REF: 'isolated-test-services',
          METRICS_TOKEN: token,
          STORAGE_DRIVER: 'local',
          RESTRICTED_STORAGE_DIR: f.root,
          EVIDENCE_SCANNER_DRIVER:
            process.env.DISPUTE_TEST_SCANNER === 'clamav' ? 'clamav' : 'test',
          CLAMAV_HOST: String(f.configValues.CLAMAV_HOST),
          CLAMAV_PORT: String(f.configValues.CLAMAV_PORT),
          ...overrides,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.add(child);
      let output = '';
      child.stdout?.on('data', (chunk) => {
        output += String(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        output += String(chunk);
      });
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code, signal) => {
            children.delete(child);
            resolve({ code, signal });
          });
        },
      );
      async function finish(stop = true) {
        if (stop) child.kill('SIGTERM');
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = await Promise.race([
            exited,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                child.kill('SIGKILL');
                reject(new Error('worker-test-shutdown-timeout'));
              }, 10_000);
            }),
          ]);
          expect(result).toEqual({ code: 0, signal: null });
          expect(output).not.toContain(String(f.configValues.DISPUTE_PRIVATE_KEYS_JSON));
          expect(output).not.toContain(token);
          expect(output).not.toContain('My private unsent process draft');
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      async function request(path: string, authorized = false) {
        return fetch(`http://127.0.0.1:${port}${path}`, {
          headers: authorized ? { authorization: `Bearer ${token}` } : {},
          signal: AbortSignal.timeout(2000),
        });
      }
      async function ready() {
        await eventually(
          async () => {
            if (child.exitCode !== null) throw new Error('worker-test-premature-exit');
            try {
              return (await request('/health/ready')).status;
            } catch {
              return 0; /* Boot is bounded by eventually(). */
            }
          },
          (status) => status === 200,
          'worker-test-not-ready',
        );
      }
      return { child, ready, request, finish };
    }
    it('exits in OFF mode without connecting to a database or starting a listener', async () => {
      const worker = await start('off', {
        DATABASE_URL: 'postgresql://invalid@127.0.0.1:1/unused',
      });
      await worker.finish(false);
    });
    it('keeps SHADOW read-only, exposes protected metrics and stops with SIGTERM', async () => {
      const bookingId = await f.booking();
      await f.drafts.save(f.users.seeker, bookingId, {
        version: 0,
        content: {
          issueCode: 'OTHER',
          requestedOutcome: 'REVIEW',
          statement: 'My private unsent process draft',
          step: 1,
        },
      });
      const before = await f.db.disputePrivateDraft.update({
        where: { userId_bookingId: { userId: f.users.seeker, bookingId } },
        data: { expiresAt: new Date(0) },
      });
      const worker = await start('shadow', {
        DISPUTE_PRIVATE_KEYS_JSON: '',
        DISPUTE_PRIVATE_ACTIVE_KEY: '',
      });
      try {
        await worker.ready();
        expect((await worker.request('/metrics')).status).toBe(404);
        const response = await worker.request('/metrics', true);
        expect(response.headers.get('cache-control')).toContain('no-store');
        const text = await response.text();
        expect(text).toContain('dispute_worker_last_success_unixtime');
        expect(text).toContain('dispute_worker_backlog');
        expect(text).not.toContain(bookingId);
        await new Promise((resolve) => setTimeout(resolve, 1200));
        expect(await f.db.disputePrivateDraft.findUnique({ where: { id: before.id } })).toEqual(
          before,
        );
        expect(await f.db.outboxEvent.count({ where: { aggregateId: before.id } })).toBe(0);
      } finally {
        await worker.finish();
      }
      await f.privacy.eraseExpiredDraft();
    });
    it('scans real stored bytes, expires a request, erases the object and commits one receipt', async () => {
      const c = await f.assigned();
      const request = await f.command(c.id, f.users.reviewer, {
        action: 'REQUEST_INFORMATION',
        recipient: 'PROVIDER',
        question: 'Please clarify the completed work.',
      });
      await f.db.disputeInformationRequest.update({
        where: { id: request.entityId! },
        data: { dueAt: new Date(0) },
      });
      const evidence = await f.evidence.upload(
        f.users.seeker,
        c.id,
        { idempotencyKey: randomUUID() },
        { buffer: png, mimetype: 'image/png', size: png.length },
      );
      const original = await f.db.disputeEvidence.findUniqueOrThrow({ where: { id: evidence.id } });
      const worker = await start('enforce');
      try {
        await worker.ready();
        await eventually(
          () => f.db.disputeEvidence.findUniqueOrThrow({ where: { id: evidence.id } }),
          (row) => row.state === 'CLEAN',
          'worker-scan-not-completed',
        );
        expect((await f.evidence.read(f.users.seeker, c.id, evidence.id)).bytes.equals(png)).toBe(
          true,
        );
        expect(
          (
            await f.db.disputeInformationRequest.findUniqueOrThrow({
              where: { id: request.entityId! },
            })
          ).status,
        ).toBe('EXPIRED');
        await f.db.disputeEvidence.update({
          where: { id: evidence.id },
          data: { retainUntil: new Date(0) },
        });
        await eventually(
          () => f.db.disputeEvidence.findUniqueOrThrow({ where: { id: evidence.id } }),
          (row) => row.state === 'ERASED',
          'worker-erasure-not-completed',
        );
        expect(await f.storage.head(original.storageKey!)).toBeNull();
        const receipt = await f.db.disputeWorkspaceEvent.findMany({
          where: { disputeId: c.id, kind: 'EVIDENCE_ERASED' },
        });
        expect(receipt).toHaveLength(1);
        expect(receipt[0].facts).toEqual({
          evidenceId: evidence.id,
          scope: 'PRIMARY_OBJECT_AND_VERSIONS',
        });
        expect(JSON.stringify(receipt)).not.toContain(original.storageKey!);
        expect((await worker.request('/metrics', true)).status).toBe(200);
      } finally {
        await worker.finish();
      }
    });
  },
);
