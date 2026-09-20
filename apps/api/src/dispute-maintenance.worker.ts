import 'reflect-metadata';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { PrismaClient } from '@homeservicemarketplace/database';
import { Counter, Gauge, Registry } from 'prom-client';
import type { AppConfigService } from './config/app-config.service';
import type { PrismaService } from './infrastructure/prisma/prisma.service';
import { TransactionRunner } from './infrastructure/prisma/transaction.runner';
import { OutboxRepository } from './infrastructure/outbox/outbox.repository';
import { LocalDiskRestrictedStorageAdapter } from './infrastructure/storage/local-disk-restricted-storage.adapter';
import { S3RestrictedStorageAdapter } from './infrastructure/storage/s3-restricted-storage.adapter';
import type { PermissionResolverService } from './modules/iam/authorization/services/permission-resolver.service';
import { ClamAvMalwareScanner } from './modules/provider/verification/media/clamav-scanner.adapter';
import {
  DeterministicTestScanner,
  UnconfiguredMalwareScanner,
} from './modules/provider/verification/media/malware-scanner.port';
import { WorkspaceRepository } from './modules/disputes/workspace/workspace.repository';
import { WorkspaceCipher } from './modules/disputes/workspace/workspace-cipher.service';
import { WorkspaceEvents } from './modules/disputes/workspace/workspace-events.service';
import { WorkspaceEvidence } from './modules/disputes/workspace/workspace-evidence.service';
import { WorkspaceMaintenance } from './modules/disputes/workspace/workspace-maintenance.service';
import { WorkspacePrivateLifecycle } from './modules/disputes/workspace/workspace-private-lifecycle.service';
import { workspaceWorkerConfig } from './modules/disputes/workspace/workspace-worker.config';

/** A process with no HTTP commands, JWTs, mail credentials or AppModule timers. */
export async function runDisputeWorker(env: NodeJS.ProcessEnv = process.env) {
  const c = workspaceWorkerConfig(env);
  if (c.DISPUTE_WORKER_MODE === 'off') return;
  const values: Record<string, unknown> = {
    ...c,
    S3_FORCE_PATH_STYLE: c.S3_FORCE_PATH_STYLE === 'true',
  };
  const config = {
    get: (key: string) => {
      if (!(key in values)) throw new Error('dispute-worker-unexpected-config');
      return values[key];
    },
  } as AppConfigService;
  const db = new PrismaClient({ datasources: { db: { url: c.DATABASE_URL } }, log: [] });
  const database = { client: db } as PrismaService;
  const tx = new TransactionRunner(database);
  // Worker methods use only locks/queues. An accidental reviewer action in this
  // process is refused, not given a system-wide permission set.
  const denyAll = { resolveFreshForUser: async () => new Set<string>() } satisfies Pick<
    PermissionResolverService,
    'resolveFreshForUser'
  >;
  const repo = new WorkspaceRepository(database, denyAll);
  const cipher = new WorkspaceCipher(config);
  if (c.DISPUTE_WORKER_MODE === 'enforce') cipher.ready();
  const objects =
    c.STORAGE_DRIVER === 's3'
      ? new S3RestrictedStorageAdapter(config)
      : new LocalDiskRestrictedStorageAdapter(config);
  const scanner =
    c.DISPUTE_WORKER_MODE === 'shadow'
      ? new UnconfiguredMalwareScanner()
      : c.EVIDENCE_SCANNER_DRIVER === 'test'
        ? new DeterministicTestScanner()
        : new ClamAvMalwareScanner(config);
  const events = new WorkspaceEvents(new OutboxRepository(database));
  const maintenance = new WorkspaceMaintenance(
    repo,
    tx,
    events,
    new WorkspaceEvidence(repo, tx, cipher, events, objects, scanner),
    new WorkspacePrivateLifecycle(repo, tx, events),
  );
  const registry = new Registry();
  const last = new Gauge({
    name: 'dispute_worker_last_success_unixtime',
    help: 'Last completed maintenance pass',
    registers: [registry],
  });
  const queue = new Gauge({
    name: 'dispute_worker_backlog',
    help: 'Durable queue totals',
    labelNames: ['kind'],
    registers: [registry],
  });
  const failures = new Counter({
    name: 'dispute_worker_failures_total',
    help: 'Pass failures without private detail',
    registers: [registry],
  });
  let stopping = false,
    lastAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = Promise.resolve();
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && req.url === '/health/ready') {
      const ready =
        !stopping &&
        lastAt > 0 &&
        Date.now() - lastAt <
          Math.max(300000, c.DISPUTE_WORKER_INTERVAL_MS * 3 + c.DISPUTE_WORKER_BATCH * 60000);
      res.writeHead(ready ? 200 : 503);
      res.end(ready ? 'ready' : 'not-ready');
      return;
    }
    const actual = Buffer.from(req.headers.authorization ?? ''),
      expected = Buffer.from(`Bearer ${c.METRICS_TOKEN}`);
    if (
      req.method !== 'GET' ||
      req.url !== '/metrics' ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    void registry
      .metrics()
      .then((text) => {
        res.setHeader('Content-Type', registry.contentType);
        res.end(text);
      })
      .catch(() => {
        res.writeHead(503);
        res.end();
      });
  });
  async function loop() {
    try {
      const result = await maintenance.runOnce(
        c.DISPUTE_WORKER_MODE as 'shadow' | 'enforce',
        c.DISPUTE_WORKER_BATCH,
        () => stopping,
      );
      for (const [k, v] of Object.entries(result)) queue.set({ kind: k }, v);
      lastAt = Date.now();
      last.set(lastAt / 1000);
    } catch {
      failures.inc();
    }
    if (!stopping)
      timer = setTimeout(() => {
        active = loop();
      }, c.DISPUTE_WORKER_INTERVAL_MS);
  }
  async function close() {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    await active;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    objects.close();
    await db.$disconnect();
  }
  try {
    await db.$connect();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(c.DISPUTE_WORKER_PORT, '0.0.0.0', () => {
        server.off('error', reject);
        resolve();
      });
    });
    process.once(
      'SIGTERM',
      () =>
        void close().catch(() => {
          process.exitCode = 1;
        }),
    );
    process.once(
      'SIGINT',
      () =>
        void close().catch(() => {
          process.exitCode = 1;
        }),
    );
    active = loop();
  } catch {
    await close();
    throw new Error('dispute-worker-start-failed');
  }
  return { close };
}
if (require.main === module)
  void runDisputeWorker().catch(() => {
    console.error('dispute-worker-start-failed');
    process.exitCode = 1;
  });
