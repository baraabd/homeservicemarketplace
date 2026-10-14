/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports --
 * Lazily loaded Prisma client and units; see outbox.integration.spec.ts. */
// R22 — operator replay of dead letters against REAL Postgres.
//
// Execution needs AuditEventType.OUTBOX_DEAD_LETTER_REPLAYED, which is a
// coordinator-owned migration (shared-change-requests/CR-01). Until it lands:
//
//   * by default this suite proves execution REFUSES (fail closed) and that
//     dry-run, authorization and scoping work;
//   * with R22_APPLY_CR01_IN_TEST=1, and ONLY against a disposable database,
//     setup applies CR-01's exact enum statement so the execute path, audit row
//     and rate limit are exercised for real. ALTER TYPE ... ADD VALUE cannot be
//     rolled back, which is why it is opt-in and never run on a shared DB.
//
// Locks: `outbox` (queue consumer) then `seed` (the global Permission row this
// suite creates and removes), in db-isolation's documented order.

export {};

import { acquireAdvisoryLocks, type HeldLock } from '../support/db-isolation';
import {
  cleanup,
  effectHandler,
  effectsFor,
  enqueue,
  ensureUser,
  loadOutbox,
  makeConfig,
  makeMetrics,
  R22_PREFIX,
} from './r22-support/outbox-harness';

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const applyCr01 = process.env.R22_APPLY_CR01_IN_TEST === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(120_000);

d('R22 outbox dead-letter replay (real Postgres)', () => {
  let prisma: any;
  let repo: any;
  let OutboxWorker: any;
  let replay: any;
  let svc: any;
  let lock: HeldLock;
  let auditPresent = false;

  const operator = `${R22_PREFIX}operator`;
  const outsider = `${R22_PREFIX}outsider`;
  const suspended = `${R22_PREFIX}suspended`;
  const effectUser = `${R22_PREFIX}effects`;
  const roleId = `${R22_PREFIX}role-replay`;
  let permissionCreated = false;

  async function deadEvent(eventType = 'r22.replay', handlerName?: string) {
    const e = await enqueue(prisma, repo, eventType);
    await prisma.outboxEvent.update({
      where: { id: e.id },
      data: { status: 'DEAD', attempts: 8, lastError: 'Error: vendor down\n    at stack' },
    });
    if (handlerName) {
      await prisma.outboxHandlerRun.create({ data: { eventId: e.id, handler: handlerName } });
    }
    return e;
  }

  const request = (over: Record<string, unknown> = {}) => ({
    operatorUserId: operator,
    reason: 'INC-2210 vendor recovered, redeliver',
    scope: { eventType: 'r22.replay' },
    limit: 10,
    dryRun: true,
    requestId: 'r22-it',
    ...over,
  });

  async function replayAudits(userId = operator) {
    return prisma.$queryRawUnsafe(
      `SELECT "id", "metadata" FROM "AuditEvent"
        WHERE "userId" = $1 AND "type"::text = 'OUTBOX_DEAD_LETTER_REPLAYED' ORDER BY "createdAt"`,
      userId,
    );
  }

  beforeAll(async () => {
    lock = await acquireAdvisoryLocks([
      { resource: 'outbox', mode: 'exclusive' },
      { resource: 'seed', mode: 'exclusive' },
    ]);
    const loaded = loadOutbox();
    prisma = loaded.prisma;
    OutboxWorker = loaded.OutboxWorker;
    repo = new loaded.OutboxRepository({ client: prisma });
    replay = require('../../src/infrastructure/outbox/outbox-replay.service');
    svc = new replay.OutboxReplayService({ client: prisma });

    if (applyCr01) {
      // CR-01's statement, verbatim. Disposable databases only.
      await prisma.$executeRawUnsafe(
        `ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'OUTBOX_DEAD_LETTER_REPLAYED'`,
      );
    }
    const [{ present }] = await prisma.$queryRawUnsafe(
      `SELECT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'AuditEventType' AND e.enumlabel = 'OUTBOX_DEAD_LETTER_REPLAYED') AS present`,
    );
    auditPresent = present;

    await cleanup(prisma);
    for (const id of [operator, outsider, suspended, effectUser]) await ensureUser(prisma, id);
    await prisma.user.update({ where: { id: suspended }, data: { status: 'SUSPENDED' } });

    // The permission is requested for the seed in CR-03 but granted to no role
    // there; this suite creates it (if absent) and a suite-owned role holding it.
    const existing = await prisma.permission.findUnique({ where: { key: 'outbox:replay' } });
    const permission =
      existing ??
      (await prisma.permission.create({
        data: { key: 'outbox:replay', description: 'R22 integration fixture' },
      }));
    permissionCreated = !existing;
    await prisma.role.create({
      data: {
        id: roleId,
        name: `${R22_PREFIX}replay-operators`,
        rolePermissions: { create: { permissionId: permission.id } },
      },
    });
    for (const id of [operator, suspended]) {
      await prisma.userRole.create({ data: { userId: id, roleId } });
    }
  });

  afterEach(async () => {
    await cleanup(prisma);
  });

  afterAll(async () => {
    try {
      await cleanup(prisma);
      await prisma.$executeRawUnsafe(
        `DELETE FROM "AuditEvent" WHERE "userId" LIKE $1`,
        `${R22_PREFIX}%`,
      );
      await prisma.role.deleteMany({ where: { id: roleId } });
      if (permissionCreated)
        await prisma.permission.deleteMany({ where: { key: 'outbox:replay' } });
      await prisma.user.deleteMany({ where: { id: { startsWith: R22_PREFIX } } });
    } finally {
      await lock?.release();
    }
  });

  async function refusal(promise: Promise<unknown>) {
    try {
      await promise;
      return null;
    } catch (err: any) {
      expect(err).toBeInstanceOf(replay.OutboxReplayRefusedError);
      return err.code as string;
    }
  }

  it('refuses a user without the permission, and a suspended holder of it', async () => {
    await deadEvent();
    expect(await refusal(svc.replay(request({ operatorUserId: outsider })))).toBe('unauthorized');
    expect(await refusal(svc.replay(request({ operatorUserId: suspended })))).toBe('unauthorized');
    expect(await refusal(svc.replay(request({ operatorUserId: `${R22_PREFIX}nobody` })))).toBe(
      'unauthorized',
    );
  });

  it('dry-run lists scoped dead letters without writing anything', async () => {
    const a = await deadEvent();
    const other = await deadEvent('r22.other-type');
    const before = await replayAudits();
    const result = await svc.replay(request());
    expect(result.dryRun).toBe(true);
    expect(result.candidates.map((c: any) => c.id)).toEqual([a.id]);
    expect(result.candidates[0].lastErrorSummary).toBe('Error: vendor down');
    expect(JSON.stringify(result)).not.toContain('payload');
    expect((await prisma.outboxEvent.findUnique({ where: { id: a.id } })).status).toBe('DEAD');
    expect((await prisma.outboxEvent.findUnique({ where: { id: other.id } })).status).toBe('DEAD');
    expect(await replayAudits()).toHaveLength(before.length);
  });

  it('never selects a live (non-DEAD) event', async () => {
    const live = await enqueue(prisma, repo, 'r22.replay');
    const result = await svc.replay(request({ scope: { eventIds: [live.id] } }));
    expect(result.candidates).toEqual([]);
  });

  (applyCr01 ? it.skip : it)(
    'execution fails closed while the audit type is not migrated',
    async () => {
      expect(auditPresent).toBe(false);
      const e = await deadEvent();
      expect(await refusal(svc.replay(request({ dryRun: false })))).toBe('audit-unavailable');
      expect((await prisma.outboxEvent.findUnique({ where: { id: e.id } })).status).toBe('DEAD');
    },
  );

  describe('with CR-01 applied', () => {
    const run = applyCr01 ? it : it.skip;

    run(
      'replays only DEAD rows in scope, resets the budget, and audits in the same transaction',
      async () => {
        const e = await deadEvent();
        const result = await svc.replay(request({ dryRun: false }));
        expect(result.replayedIds).toEqual([e.id]);
        const after = await prisma.outboxEvent.findUnique({ where: { id: e.id } });
        expect(after.status).toBe('PENDING');
        expect(after.attempts).toBe(0);
        expect(after.payload).toEqual(e.payload);
        const audits = await replayAudits();
        const last = audits[audits.length - 1];
        expect(last.id).toBe(result.auditEventId);
        expect(last.metadata.reason).toBe('INC-2210 vendor recovered, redeliver');
        expect(last.metadata.replayedCount).toBe(1);
        expect(JSON.stringify(last.metadata)).not.toContain('vendor down');
      },
    );

    run('a replayed event whose handler already committed does not repeat the effect', async () => {
      // The handler completed earlier (marker present) but the event was
      // dead-lettered afterwards, e.g. by a second handler since fixed.
      const e = await deadEvent('r22.replay', 'r22.replay.handler');
      const handler = effectHandler('r22.replay.handler', 'r22.replay', effectUser);
      await svc.replay(request({ dryRun: false, scope: { eventIds: [e.id] } }));
      const metrics = makeMetrics();
      await new OutboxWorker(repo, { client: prisma }, makeConfig(), metrics, [handler]).runOnce();
      expect((await prisma.outboxEvent.findUnique({ where: { id: e.id } })).status).toBe(
        'PROCESSED',
      );
      expect(handler.runs).toEqual([]);
      expect(await effectsFor(prisma, e.id)).toBe(0);
      expect(metrics.outcomes).toEqual(['skipped-duplicate']);
    });

    run('rate-limits an operator by the audit trail', async () => {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "AuditEvent" WHERE "userId" = $1 AND "type"::text = 'OUTBOX_DEAD_LETTER_REPLAYED'`,
        operator,
      );
      for (let i = 0; i < replay.REPLAY_MAX_CALLS_PER_OPERATOR_HOUR; i++) {
        await svc.replay(request({ dryRun: false, scope: { eventType: `r22.none-${i}` } }));
      }
      expect(await refusal(svc.replay(request({ dryRun: false })))).toBe('rate-limited');
    });

    run('concurrent replays of the same scope replay each event once', async () => {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "AuditEvent" WHERE "userId" = $1 AND "type"::text = 'OUTBOX_DEAD_LETTER_REPLAYED'`,
        operator,
      );
      const events = [await deadEvent(), await deadEvent(), await deadEvent()];
      const results = await Promise.all([
        svc.replay(request({ dryRun: false })),
        svc.replay(request({ dryRun: false })),
      ]);
      const all = results.flatMap((r: any) => r.replayedIds).sort();
      expect(all).toEqual(events.map((e) => e.id).sort());
    });
  });
});
