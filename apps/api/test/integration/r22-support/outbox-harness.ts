/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports --
 * Loaded lazily from gated suites; the Prisma client is untyped `any` there
 * exactly as in the sibling outbox specs. */
// R22 — shared real-Postgres harness for the outbox reliability suites.
//
// Every row it writes is namespaced: users by `fixturePrefix('r22')`, events by
// aggregateType R22_AGGREGATE. Cleanup is by that namespace, never TRUNCATE,
// so a parallel suite's rows are never touched.

import { fixturePrefix } from '../../support/db-isolation';

export const R22_PREFIX = fixturePrefix('r22');
export const R22_AGGREGATE = 'R22Test';
/** The effect every R22 test handler commits: one Notification row per
 *  delivery, tagged with the event id. A REAL user-visible row, so "exactly one
 *  effect" is asserted on what a user would see, not on a test counter. */
export const R22_EFFECT_TYPE = 'SYSTEM';

export interface Deferred<T = void> {
  promise: Promise<T>;
  resolve(value: T): void;
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

export const BASE_CONFIG: Record<string, unknown> = {
  OUTBOX_WORKER_ENABLED: false,
  OUTBOX_BATCH_SIZE: 50,
  OUTBOX_POLL_INTERVAL_MS: 50,
  OUTBOX_CLAIM_TIMEOUT_MS: 120_000,
  OUTBOX_RETRY_BASE_MS: 1_000,
  OUTBOX_RETRY_CAP_MS: 300_000,
  OUTBOX_RETENTION_HOURS: 72,
  OUTBOX_CLEANUP_INTERVAL_MS: 3_600_000,
  OUTBOX_FANOUT_BATCH_SIZE: 200,
};

export function makeConfig(over: Record<string, unknown> = {}) {
  const merged = { ...BASE_CONFIG, ...over };
  return { get: (k: string) => merged[k] };
}

/** Records every metric call so tests can assert on outcomes. */
export function makeMetrics() {
  const outcomes: string[] = [];
  const noop = { inc: () => undefined, set: () => undefined, reset: () => undefined };
  return {
    outcomes,
    outboxEventsProcessedTotal: {
      inc: (labels: { outcome: string }) => outcomes.push(labels.outcome),
    },
    outboxEventDurationSeconds: { startTimer: () => () => undefined },
    outboxQueueDepth: noop,
    outboxOldestPendingAgeSeconds: noop,
    outboxClaimedTotal: noop,
    outboxReclaimedTotal: noop,
  };
}

export async function ensureUser(prisma: any, id: string): Promise<void> {
  await prisma.user.upsert({
    where: { id },
    update: {},
    create: {
      id,
      email: `${id}@r22.integration.test`,
      firstName: 'R22',
      lastName: 'Fixture',
      emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
      status: 'ACTIVE',
    },
  });
}

/** Wait until the database itself says the row is claimable (see the
 *  identically named helper in outbox.integration.spec.ts for why). */
export async function waitUntilClaimable(prisma: any, id: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM "OutboxEvent"
        WHERE "id" = $1 AND "status" = 'PENDING'::"OutboxStatus" AND "availableAt" <= NOW()`,
      id,
    );
    if (rows.length > 0) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`outbox event ${id} never became claimable`);
}

export async function enqueue(
  prisma: any,
  repo: any,
  eventType: string,
  payload: Record<string, unknown> = {},
  over: Record<string, unknown> = {},
) {
  const row = await repo.enqueue({
    aggregateType: R22_AGGREGATE,
    aggregateId: 'agg-r22',
    eventType,
    payload,
    // Backdated: the client and database clocks differ (see the outbox spec).
    availableAt: new Date(Date.now() - 1_000),
    ...over,
  });
  await waitUntilClaimable(prisma, row.id);
  return row;
}

export async function effectsFor(prisma: any, eventId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Notification"
      WHERE "userId" LIKE $1 AND "metadata"->>'r22EventId' = $2`,
    `${R22_PREFIX}%`,
    eventId,
  );
  return rows[0].n;
}

/** A handler whose committed effect is one Notification row. */
export function effectHandler(
  name: string,
  eventType: string,
  userId: string,
  hooks: { before?: (event: any) => Promise<void>; after?: (event: any) => Promise<void> } = {},
) {
  const runs: string[] = [];
  return {
    name,
    eventTypes: [eventType],
    runs,
    async handle(event: any, tx: any) {
      runs.push(event.id);
      if (hooks.before) await hooks.before(event);
      await tx.notification.create({
        data: {
          userId,
          type: R22_EFFECT_TYPE,
          title: 'R22 effect',
          body: name,
          metadata: { r22EventId: event.id, handler: name },
        },
      });
      if (hooks.after) await hooks.after(event);
    },
  };
}

export async function cleanup(prisma: any): Promise<void> {
  const mine = (
    await prisma.outboxEvent.findMany({
      where: { aggregateType: R22_AGGREGATE },
      select: { id: true },
    })
  ).map((e: { id: string }) => e.id);
  if (mine.length > 0) {
    await prisma.outboxHandlerRun.deleteMany({ where: { eventId: { in: mine } } });
    await prisma.outboxEvent.deleteMany({ where: { id: { in: mine } } });
  }
  await prisma.notification.deleteMany({ where: { userId: { startsWith: R22_PREFIX } } });
}

export async function waitFor(
  check: () => Promise<boolean>,
  message: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(message);
}

export function loadOutbox() {
  const db = require('@homeservicemarketplace/database');
  return {
    prisma: db.prisma,
    OutboxRepository: require('../../../src/infrastructure/outbox/outbox.repository')
      .OutboxRepository,
    OutboxWorker: require('../../../src/infrastructure/outbox/outbox.worker').OutboxWorker,
  };
}
