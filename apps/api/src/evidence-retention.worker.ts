import 'reflect-metadata';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { PrismaClient } from '@homeservicemarketplace/database';
import { Registry, Gauge, Counter } from 'prom-client';
import type { AppConfigService } from './config/app-config.service';
import type { PrismaService } from './infrastructure/prisma/prisma.service';
import { LocalDiskRestrictedStorageAdapter } from './infrastructure/storage/local-disk-restricted-storage.adapter';
import { S3RestrictedStorageAdapter } from './infrastructure/storage/s3-restricted-storage.adapter';
import { OutboxRepository } from './infrastructure/outbox/outbox.repository';
import { EvidenceRetentionRepository } from './modules/provider/verification/retention/retention.repository';
import { EvidenceRetentionService } from './modules/provider/verification/retention/retention.service';
import { retentionWorkerConfig } from './modules/provider/verification/retention/retention-worker.config';

/** Dedicated worker, NOT AppModule: importing the API would also start scan,
 * expiry and Outbox timers and require unrelated service credentials. */
export async function runRetentionWorker(env: NodeJS.ProcessEnv = process.env) {
  const c = retentionWorkerConfig(env);
  if (c.EVIDENCE_RETENTION_MODE === 'off') return;
  const configValues: Record<string, unknown> = {
    ...c,
    S3_FORCE_PATH_STYLE: c.S3_FORCE_PATH_STYLE === 'true',
  };
  const config = {
    get: (key: string) => {
      if (!(key in configValues)) throw new Error('retention-worker-unexpected-config-key');
      return configValues[key];
    },
  } as AppConfigService;
  const db = new PrismaClient({ datasources: { db: { url: c.DATABASE_URL } }, log: [] });
  const storage =
    c.STORAGE_DRIVER === 's3'
      ? new S3RestrictedStorageAdapter(config)
      : new LocalDiskRestrictedStorageAdapter(config);
  const repo = new EvidenceRetentionRepository(
    db,
    new OutboxRepository({ client: db } as PrismaService),
  );
  const service = new EvidenceRetentionService(repo, storage);
  const registry = new Registry();
  const lastRun = new Gauge({
    name: 'evidence_retention_last_success_unixtime',
    help: 'Last completed sweep',
    registers: [registry],
  });
  const backlog = new Gauge({
    name: 'evidence_retention_jobs',
    help: 'Durable queue totals',
    labelNames: ['state'],
    registers: [registry],
  });
  const failures = new Counter({
    name: 'evidence_retention_tick_failures_total',
    help: 'Failed sweeps',
    registers: [registry],
  });
  const operations = new Counter({
    name: 'evidence_retention_operations_total',
    help: 'Bounded sweep outcomes',
    labelNames: ['outcome'],
    registers: [registry],
  });
  let healthyAt = 0;
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> = Promise.resolve();
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && req.url === '/health/ready') {
      const ready =
        !stopping &&
        healthyAt > 0 &&
        Date.now() - healthyAt <
          Math.max(
            300_000,
            c.EVIDENCE_RETENTION_INTERVAL_MS * 3 + c.EVIDENCE_RETENTION_BATCH * 50_000,
          );
      res.writeHead(ready ? 200 : 503);
      res.end(ready ? 'ready' : 'not-ready');
      return;
    }
    const supplied = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${c.METRICS_TOKEN}`);
    if (
      req.method !== 'GET' ||
      req.url !== '/metrics' ||
      !c.METRICS_TOKEN ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
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
  async function tick() {
    try {
      const result = await service.runOnce(
        c.policy,
        c.EVIDENCE_RETENTION_MODE as 'shadow' | 'enforce',
        c.EVIDENCE_RETENTION_BATCH,
        () => stopping,
      );
      for (const [outcome, count] of Object.entries(result)) operations.inc({ outcome }, count);
      const counts = await repo.counts(new Date());
      for (const [state, count] of Object.entries(counts)) backlog.set({ state }, count);
      if (result.failed) failures.inc(result.failed);
      else {
        healthyAt = Date.now();
        lastRun.set(healthyAt / 1000);
      }
    } catch {
      failures.inc();
    }
  }
  async function loop() {
    await tick();
    if (!stopping)
      timer = setTimeout(() => {
        active = loop();
      }, c.EVIDENCE_RETENTION_INTERVAL_MS);
  }
  async function close() {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    await active;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    storage.close();
    await db.$disconnect();
  }
  try {
    await db.$connect();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(c.EVIDENCE_RETENTION_PORT, '0.0.0.0', () => {
        server.off('error', reject);
        resolve();
      });
    });
    process.once('SIGTERM', () => {
      void close().catch(() => {
        process.exitCode = 1;
      });
    });
    process.once('SIGINT', () => {
      void close().catch(() => {
        process.exitCode = 1;
      });
    });
    active = loop();
  } catch {
    await close();
    throw new Error('retention-worker-start-failed');
  }
  return { close };
}

if (require.main === module) {
  void runRetentionWorker().catch(() => {
    // No raw configuration, driver messages, identifiers, or exception stacks.
    console.error('retention-worker-start-failed');
    process.exitCode = 1;
  });
}
