/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * Lazy requires: with RUN_DB_INTEGRATION unset this spec is skipped, and a
 * top-level import would still open the Prisma client's pool.
 */

export {};

import { randomUUID } from 'node:crypto';
import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';

// R17-C — dispute decision authority against real PostgreSQL.
//
// docs/production-readiness/r17/R17_C_DISPUTES.md
//
// Two resolution paths exist and both are exercised here:
//   - the legacy admin ticket service (`/v1/admin/disputes`), which owns
//     disputes WITHOUT a workspace; and
//   - the canonical dispute workspace (`/v1/{me,admin}/dispute-workspaces`).
//
// Concurrency is synchronized with a gate on the service's own read, plus the
// database's own view of who is blocked by whom (`pg_blocking_pids`) — never
// with a sleep. Every count is scoped to ids this suite created, and every
// "nothing persisted" assertion has a positive control beside it.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(180_000);

type Settled<T> = { ok: true; value: T } | { ok: false; error: any };
const settle = <T>(p: Promise<T>): Promise<Settled<T>> =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );

/**
 * Pauses a transaction at a chosen read until the test releases it.
 *
 * `arrived` resolves with the paused transaction's backend pid, so the test can
 * ask PostgreSQL whether a competing transaction is blocked behind it. After
 * `release`, later arrivals pass straight through.
 */
function gate() {
  const waiting = new Map<string, { pid: number; release: () => void }>();
  const arrivals = new Map<string, (pid: number) => void>();
  const arrivedPromises = new Map<string, Promise<number>>();
  const open = new Set<string>();
  const arrived = (label: string) => {
    if (!arrivedPromises.has(label))
      arrivedPromises.set(label, new Promise<number>((r) => arrivals.set(label, r)));
    return arrivedPromises.get(label)!;
  };
  return {
    arrived,
    hasArrived: (label: string) => waiting.has(label),
    async pass(label: string, pid: number): Promise<void> {
      arrived(label);
      if (open.has(label)) return;
      await new Promise<void>((release) => {
        waiting.set(label, { pid, release });
        arrivals.get(label)!(pid);
      });
    },
    release(label: string) {
      open.add(label);
      waiting.get(label)?.release();
    },
  };
}

d('R17-C legacy admin dispute authority (real Postgres)', () => {
  const P = fixturePrefix('r17-disputes-legacy');
  const users = {
    seeker: `${P}seeker`,
    provider: `${P}provider`,
    outsider: `${P}outsider`,
    adminA: `${P}admin-a`,
    adminB: `${P}admin-b`,
  };
  const profileId = `${P}profile`;
  let prisma: any;
  let verifier: any;
  let locks: HeldLock | undefined;
  let service: any;
  let repository: any;
  let paused: ReturnType<typeof gate> | null = null;
  /** Transactions are labelled by the admin who runs them. */
  const labelOf = new Map<string, string>();

  async function clear() {
    const bookings = (
      await prisma.booking.findMany({ where: { id: { startsWith: P } }, select: { id: true } })
    ).map((b: { id: string }) => b.id);
    const disputes = (
      await prisma.dispute.findMany({
        where: { bookingId: { in: bookings } },
        select: { id: true },
      })
    ).map((x: { id: string }) => x.id);
    const notifications = (
      await prisma.notification.findMany({
        where: { userId: { in: Object.values(users) } },
        select: { id: true },
      })
    ).map((n: { id: string }) => n.id);
    await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: notifications } } });
    await prisma.notification.deleteMany({ where: { id: { in: notifications } } });
    await prisma.auditEvent.deleteMany({ where: { userId: { in: Object.values(users) } } });
    await prisma.disputeEvent.deleteMany({ where: { disputeId: { in: disputes } } });
    await prisma.dispute.deleteMany({ where: { id: { in: disputes } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookings } } });
    await prisma.bid.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceRequest.deleteMany({ where: { id: { startsWith: P } } });
  }

  async function booking(): Promise<string> {
    const id = P + randomUUID();
    await prisma.serviceRequest.create({
      data: {
        id: `${id}-request`,
        seekerUserId: users.seeker,
        scheduleType: 'ASAP',
        addressSnapshot: {},
        status: 'BID_ACCEPTED',
      },
    });
    await prisma.bid.create({
      data: {
        id: `${id}-bid`,
        requestId: `${id}-request`,
        providerId: profileId,
        amount: 100,
        pricingType: 'FIXED',
        status: 'ACCEPTED',
      },
    });
    await prisma.booking.create({
      data: {
        id,
        requestId: `${id}-request`,
        bidId: `${id}-bid`,
        seekerUserId: users.seeker,
        providerId: profileId,
        priceAmount: 100,
        status: 'SCHEDULED',
      },
    });
    return id;
  }

  async function opened(openedById = users.seeker) {
    const bookingId = await booking();
    const { dispute } = await service.open(users.adminA, {
      bookingId,
      openedById,
      reason: 'Synthetic legacy ticket',
      priority: 'MEDIUM',
    });
    return { id: dispute.id as string, bookingId };
  }

  /** Every row the legacy service writes for one dispute, scoped by id. */
  async function effects(disputeId: string) {
    const notifications = await prisma.notification.findMany({
      where: {
        userId: { in: Object.values(users) },
        metadata: { path: ['disputeId'], equals: disputeId },
      },
      orderBy: { createdAt: 'asc' },
    });
    return {
      dispute: await prisma.dispute.findUniqueOrThrow({ where: { id: disputeId } }),
      events: await prisma.disputeEvent.findMany({
        where: { disputeId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      audits: await prisma.auditEvent.findMany({
        where: {
          userId: { in: [users.adminA, users.adminB] },
          metadata: { path: ['disputeId'], equals: disputeId },
        },
      }),
      notifications,
      outbox: await prisma.outboxEvent.count({
        where: { aggregateId: { in: notifications.map((n: { id: string }) => n.id) } },
      }),
    };
  }

  /** True once some backend is waiting on a lock held by `pid`. */
  async function blockedBehind(pid: number): Promise<boolean> {
    const rows = await verifier.$queryRawUnsafe(
      'SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
      pid,
    );
    return rows[0].n > 0;
  }

  /**
   * Starts `first`, waits until it is paused at its read, then starts
   * `second` and waits until `second` is EITHER paused at the same read
   * (both transactions saw the same starting state) OR blocked by PostgreSQL
   * behind `first`'s locks. Both are conditions, not elapsed time.
   */
  async function contend<A, B>(
    first: { label: string; run: () => Promise<A> },
    second: { label: string; run: () => Promise<B> },
  ) {
    const g = gate();
    paused = g;
    const a = settle(first.run());
    const pidA = await g.arrived(first.label);
    const b = settle(second.run());
    const deadline = Date.now() + 60_000;
    let secondState: 'paused' | 'blocked' | null = null;
    while (!secondState) {
      if (g.hasArrived(second.label)) secondState = 'paused';
      else if (await blockedBehind(pidA)) secondState = 'blocked';
      else if (Date.now() > deadline)
        throw new Error('second transaction never reached a decision point');
      else await new Promise((r) => setTimeout(r, 20));
    }
    g.release(first.label);
    const ra = await a;
    g.release(second.label);
    const rb = await b;
    paused = null;
    return { a: ra, b: rb, secondState };
  }

  beforeAll(async () => {
    locks = await acquireAdvisoryLocks([
      { resource: 'providerLifecycle', mode: 'shared' },
      { resource: 'outbox', mode: 'shared' },
      { resource: 'serviceRequests', mode: 'shared' },
    ]);
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    verifier = new db.PrismaClient({ log: [] });
    const database = { client: prisma } as any;
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const { OutboxRepository } = require('../../src/infrastructure/outbox/outbox.repository');
    const {
      DisputeRepository,
    } = require('../../src/infrastructure/persistence/disputes/dispute.repository');
    const {
      DisputeEventRepository,
    } = require('../../src/infrastructure/persistence/disputes/dispute-event.repository');
    const {
      NotificationRepository,
    } = require('../../src/infrastructure/persistence/notifications/notification.repository');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const {
      NotificationsService,
    } = require('../../src/modules/notifications/notifications.service');
    const { AdminAuditService } = require('../../src/modules/admin/admin-audit.service');
    const {
      AdminDisputesService,
    } = require('../../src/modules/admin/disputes/admin-disputes.service');
    const transactions = new TransactionRunner(database);
    repository = new DisputeRepository(database);
    // The gate sits on the service's own read of the dispute inside its
    // transaction: that read is the "starting state" each decision is based on.
    const findById = repository.findById.bind(repository);
    // It pauses AFTER the read, so a paused transaction holds exactly the state
    // its decision will be based on.
    repository.findById = async (id: string, tx?: any) => {
      const label = tx ? labelOf.get(id) : undefined;
      const row = await findById(id, tx);
      if (paused && tx && label) {
        const [{ pid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
        await paused.pass(label, pid);
      }
      return row;
    };
    service = new AdminDisputesService(
      repository,
      new DisputeEventRepository(database),
      new NotificationsService(
        new NotificationRepository(database),
        new OutboxRepository(database),
        transactions,
      ),
      new AdminAuditService(new AuditEventRepository(database)),
      transactions,
    );
    await clear();
    await prisma.providerProfile.deleteMany({ where: { id: profileId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
    for (const id of Object.values(users))
      await prisma.user.create({
        data: {
          id,
          email: `${id}@example.test`,
          firstName: 'Synthetic',
          lastName: 'Test',
          status: 'ACTIVE',
          isActive: true,
        },
      });
    await prisma.providerProfile.create({
      data: { id: profileId, userId: users.provider, displayName: 'Synthetic pro', initials: 'SP' },
    });
  });

  afterAll(async () => {
    try {
      await dropCommitTrap();
      await clear();
      await prisma?.providerProfile.deleteMany({ where: { id: profileId } });
      await prisma?.user.deleteMany({ where: { id: { in: Object.values(users) } } });
    } finally {
      await verifier?.$disconnect();
      await locks?.release();
    }
  });

  /** Two admins decide the same dispute from the same starting state. */
  async function resolveRace(
    disputeId: string,
    a: { status: string; resolution: string },
    b: { status: string; resolution: string },
  ) {
    return contend(
      {
        label: 'A',
        run: () => {
          labelOf.set(disputeId, 'A');
          return service.resolve(users.adminA, disputeId, a);
        },
      },
      {
        label: 'B',
        run: () => {
          labelOf.set(disputeId, 'B');
          return service.resolve(users.adminB, disputeId, b);
        },
      },
    );
  }

  it('C-1/D9 two admins resolving with conflicting decisions: exactly one is accepted', async () => {
    const c = await opened();
    // Read labels are per call: the gate tags whichever admin reads next.
    const race = await contend(
      {
        label: 'A',
        run: async () => {
          labelOf.set(c.id, 'A');
          return service.resolve(users.adminA, c.id, {
            status: 'RESOLVED_DENIED',
            resolution: 'Decision A',
          });
        },
      },
      {
        label: 'B',
        run: async () => {
          labelOf.set(c.id, 'B');
          return service.resolve(users.adminB, c.id, {
            status: 'RESOLVED_REFUND',
            resolution: 'Decision B',
          });
        },
      },
    );
    const after = await effects(c.id);
    // The first admin's decision is the one recorded; the second is refused as
    // a conflict rather than silently overwriting it.
    expect(race.a.ok).toBe(true);
    expect(race.b.ok).toBe(false);
    if (!race.b.ok) expect(race.b.error).toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(after.dispute.status).toBe('RESOLVED_DENIED');
    expect(after.dispute.resolvedById).toBe(users.adminA);
    expect(after.events.filter((e: any) => e.type === 'RESOLVED')).toHaveLength(1);
    // Positive control for the zero-duplicate counts: the OPENED row exists.
    expect(after.events.filter((e: any) => e.type === 'OPENED')).toHaveLength(1);
    expect(after.audits.filter((x: any) => x.type === 'ADMIN_DISPUTE_RESOLVED')).toHaveLength(1);
    expect(after.notifications).toHaveLength(1);
    expect(after.outbox).toBe(1);
  });

  it('C-1/D8 the same decision submitted twice concurrently is recorded once', async () => {
    const c = await opened();
    const decision = { status: 'RESOLVED_DENIED', resolution: 'Same decision' };
    const race = await resolveRace(c.id, decision, decision);
    const after = await effects(c.id);
    expect([race.a.ok, race.b.ok].filter(Boolean)).toHaveLength(1);
    expect(after.events.filter((e: any) => e.type === 'RESOLVED')).toHaveLength(1);
    expect(after.audits.filter((x: any) => x.type === 'ADMIN_DISPUTE_RESOLVED')).toHaveLength(1);
    expect(after.notifications).toHaveLength(1);
    expect(after.outbox).toBe(1);
  });

  it('C-1 a status edit racing a resolution cannot reopen the resolved dispute', async () => {
    const c = await opened();
    const race = await contend(
      {
        label: 'A',
        run: async () => {
          labelOf.set(c.id, 'A');
          return service.resolve(users.adminA, c.id, {
            status: 'RESOLVED_PARTIAL',
            resolution: 'Partial decision',
          });
        },
      },
      {
        label: 'B',
        run: async () => {
          labelOf.set(c.id, 'B');
          return service.update(users.adminB, c.id, { status: 'IN_REVIEW' });
        },
      },
    );
    const after = await effects(c.id);
    expect(race.a.ok).toBe(true);
    expect(race.b.ok).toBe(false);
    if (!race.b.ok) expect(race.b.error).toMatchObject({ status: 409 });
    expect(after.dispute.status).toBe('RESOLVED_PARTIAL');
    expect(after.events.map((e: any) => e.type)).toEqual(['OPENED', 'RESOLVED']);
    expect(after.audits.filter((x: any) => x.type === 'ADMIN_DISPUTE_UPDATED')).toHaveLength(0);
    expect(after.audits.filter((x: any) => x.type === 'ADMIN_DISPUTE_RESOLVED')).toHaveLength(1);
  });

  it('D10 a decision on an already-decided dispute is refused with no side effects', async () => {
    const c = await opened();
    await service.resolve(users.adminA, c.id, { status: 'RESOLVED_DENIED', resolution: 'First' });
    const before = await effects(c.id);
    await expect(
      service.resolve(users.adminB, c.id, { status: 'RESOLVED_REFUND', resolution: 'Late' }),
    ).rejects.toMatchObject({ status: 409 });
    const after = await effects(c.id);
    expect(after.dispute.status).toBe('RESOLVED_DENIED');
    expect(after.events).toHaveLength(before.events.length);
    expect(after.audits).toHaveLength(before.audits.length);
    expect(after.notifications).toHaveLength(before.notifications.length);
  });

  it('C-3/D3 an admin cannot open a ticket on behalf of someone outside the booking', async () => {
    const bookingId = await booking();
    await expect(
      service.open(users.adminA, {
        bookingId,
        openedById: users.outsider,
        reason: 'Forged opener',
      }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    await expect(
      service.open(users.adminA, {
        bookingId: `${P}missing-booking`,
        openedById: users.seeker,
        reason: 'Missing booking',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await prisma.dispute.count({ where: { bookingId } })).toBe(0);
    // Positive control: either real participant may be recorded as opener.
    const asProvider = await service.open(users.adminA, {
      bookingId,
      openedById: users.provider,
      reason: 'Opened for the provider',
    });
    expect(asProvider.dispute.openedById).toBe(users.provider);
  });

  it('D4 a second active ticket on the same booking is a conflict, not a server error', async () => {
    const c = await opened();
    await expect(
      service.open(users.adminB, {
        bookingId: c.bookingId,
        openedById: users.provider,
        reason: 'Duplicate ticket',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'CONFLICT' });
    expect(await prisma.dispute.count({ where: { bookingId: c.bookingId } })).toBe(1);
  });

  it('C-2/B-4 the decision notice claims no money movement and links into the opener’s experience', async () => {
    const forSeeker = await opened(users.seeker);
    const forProvider = await opened(users.provider);
    await service.resolve(users.adminA, forSeeker.id, {
      status: 'RESOLVED_REFUND',
      resolution: 'Refund intent recorded',
    });
    await service.update(users.adminA, forProvider.id, { status: 'IN_REVIEW' });
    await service.resolve(users.adminA, forProvider.id, {
      status: 'RESOLVED_PARTIAL',
      resolution: 'Partial intent recorded',
    });
    const seekerNotice = (await effects(forSeeker.id)).notifications;
    const providerNotices = (await effects(forProvider.id)).notifications;
    expect(seekerNotice).toHaveLength(1);
    expect(providerNotices).toHaveLength(2);
    for (const n of [...seekerNotice, ...providerNotices]) {
      // "refund", "partial" or "paid" would tell the participant money moved.
      expect(`${n.title} ${n.body}`).not.toMatch(/refund|partial|paid|compensat|money returned/i);
      expect(`${n.title} ${n.body}`).not.toMatch(/intent recorded/);
    }
    expect(seekerNotice[0].body).toMatch(/does not move money/i);
    expect(seekerNotice[0].deepLink).toBe(`/home/bookings/${forSeeker.bookingId}`);
    for (const n of providerNotices)
      expect(n.deepLink).toBe(`/provider/bookings/${forProvider.bookingId}`);
  });

  it('C-4 the resolution audit row carries identifiers, not the free-text resolution', async () => {
    const c = await opened();
    const text = 'Private narrative that must stay out of the audit log';
    await service.resolve(users.adminA, c.id, { status: 'RESOLVED_DENIED', resolution: text });
    const [audit] = (await effects(c.id)).audits.filter(
      (x: any) => x.type === 'ADMIN_DISPUTE_RESOLVED',
    );
    expect(audit.metadata).toMatchObject({
      disputeId: c.id,
      previousStatus: 'OPEN',
      newStatus: 'RESOLVED_DENIED',
    });
    expect(JSON.stringify(audit.metadata)).not.toContain('Private narrative');
  });

  // ── COMMIT authority (PLATFORM-TX-1 applied to the legacy decision) ──
  const TRAP = 'r17c_legacy_commit_trap';
  async function commitTrap(disputeId: string) {
    await verifier.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${TRAP}() RETURNS trigger AS $$
      BEGIN
        IF NEW."disputeId" = '${disputeId}' AND NEW."type" = 'RESOLVED' THEN
          RAISE EXCEPTION 'r17c: rejected at commit' USING ERRCODE = 'P0001';
        END IF;
        RETURN NULL;
      END $$ LANGUAGE plpgsql`);
    await verifier.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TRAP}_t ON "DisputeEvent"`);
    await verifier.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER ${TRAP}_t AFTER INSERT ON "DisputeEvent"
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${TRAP}()`);
  }
  async function dropCommitTrap() {
    await verifier?.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TRAP}_t ON "DisputeEvent"`);
    await verifier?.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${TRAP}()`);
  }

  it('D14 a failing statement inside the decision leaves nothing behind', async () => {
    const c = await opened();
    // The notification row references a user that does not exist: the last
    // write of the decision fails, after the status, event and audit writes.
    const notifications = service['notifications'];
    const original = notifications.createForUser.bind(notifications);
    notifications.createForUser = async (input: any, tx: any) =>
      original({ ...input, userId: `${P}no-such-user` }, tx);
    try {
      await expect(
        service.resolve(users.adminA, c.id, { status: 'RESOLVED_DENIED', resolution: 'x' }),
      ).rejects.toBeDefined();
    } finally {
      notifications.createForUser = original;
    }
    const after = await effects(c.id);
    expect(after.dispute.status).toBe('OPEN');
    expect(after.events.map((e: any) => e.type)).toEqual(['OPENED']);
    expect(after.audits.filter((x: any) => x.type === 'ADMIN_DISPUTE_RESOLVED')).toHaveLength(0);
  });

  it('D15/D16 a decision whose COMMIT is rejected is not reported, stored or announced — and a clean retry succeeds once', async () => {
    const c = await opened();
    await commitTrap(c.id);
    let outcome: Settled<unknown>;
    try {
      outcome = await settle(
        service.resolve(users.adminA, c.id, { status: 'RESOLVED_DENIED', resolution: 'x' }),
      );
    } finally {
      await dropCommitTrap();
    }
    expect(outcome.ok).toBe(false);
    const rolledBack = await effects(c.id);
    expect(rolledBack.dispute.status).toBe('OPEN');
    expect(rolledBack.dispute.resolvedById).toBeNull();
    expect(rolledBack.events.map((e: any) => e.type)).toEqual(['OPENED']);
    expect(rolledBack.audits.filter((x: any) => x.type === 'ADMIN_DISPUTE_RESOLVED')).toHaveLength(
      0,
    );
    expect(rolledBack.notifications).toHaveLength(0);
    expect(rolledBack.outbox).toBe(0);

    // CONFIRMED_ABORTED: the same admin may decide again, and it lands once.
    await service.resolve(users.adminA, c.id, { status: 'RESOLVED_DENIED', resolution: 'x' });
    await expect(
      service.resolve(users.adminA, c.id, { status: 'RESOLVED_DENIED', resolution: 'x' }),
    ).rejects.toMatchObject({ status: 409 });
    const committed = await effects(c.id);
    expect(committed.dispute.status).toBe('RESOLVED_DENIED');
    expect(committed.events.map((e: any) => e.type)).toEqual(['OPENED', 'RESOLVED']);
    expect(committed.audits.filter((x: any) => x.type === 'ADMIN_DISPUTE_RESOLVED')).toHaveLength(
      1,
    );
    expect(committed.notifications).toHaveLength(1);
    expect(committed.outbox).toBe(1);
  });
});

d('R17-C canonical workspace decision authority (real Postgres)', () => {
  let f: import('../support/dispute-workspace-fixture').WorkspaceFixture;
  let legacy: any;

  beforeAll(async () => {
    const { workspaceFixture } = require('../support/dispute-workspace-fixture');
    f = await workspaceFixture();
    const { OutboxRepository } = require('../../src/infrastructure/outbox/outbox.repository');
    const {
      DisputeRepository,
    } = require('../../src/infrastructure/persistence/disputes/dispute.repository');
    const {
      DisputeEventRepository,
    } = require('../../src/infrastructure/persistence/disputes/dispute-event.repository');
    const {
      NotificationRepository,
    } = require('../../src/infrastructure/persistence/notifications/notification.repository');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const {
      NotificationsService,
    } = require('../../src/modules/notifications/notifications.service');
    const { AdminAuditService } = require('../../src/modules/admin/admin-audit.service');
    const {
      AdminDisputesService,
    } = require('../../src/modules/admin/disputes/admin-disputes.service');
    legacy = new AdminDisputesService(
      new DisputeRepository(f.database),
      new DisputeEventRepository(f.database),
      new NotificationsService(
        new NotificationRepository(f.database),
        new OutboxRepository(f.database),
        f.transactions,
      ),
      new AdminAuditService(new AuditEventRepository(f.database)),
      f.transactions,
    );
  });

  afterAll(async () => {
    await dropDecisionTrap();
    await f?.dispose();
  });

  const TRAP = 'r17c_workspace_commit_trap';
  async function decisionTrap(disputeId: string) {
    await f.db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${TRAP}() RETURNS trigger AS $$
      BEGIN
        IF NEW."disputeId" = '${disputeId}' THEN
          RAISE EXCEPTION 'r17c: rejected at commit' USING ERRCODE = 'P0001';
        END IF;
        RETURN NULL;
      END $$ LANGUAGE plpgsql`);
    await f.db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TRAP}_t ON "DisputeDecisionRecord"`);
    await f.db
      .$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER ${TRAP}_t AFTER INSERT ON "DisputeDecisionRecord"
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${TRAP}()`);
  }
  async function dropDecisionTrap() {
    await f?.db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${TRAP}_t ON "DisputeDecisionRecord"`);
    await f?.db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${TRAP}()`);
  }

  /** A case with an agreed proposal, ready for a decision. */
  async function agreed() {
    const c = await f.assigned();
    const proposal = await f.command(c.id, f.users.reviewer, {
      action: 'PROPOSE',
      summary: 'A scoped return visit to complete the agreed service.',
      remedies: [
        {
          type: 'REPERFORM',
          description: 'Complete the outstanding cleaning tasks.',
          conditions: '',
          dueAt: null,
        },
      ],
    });
    for (const actor of [f.users.seeker, f.users.provider])
      await f.command(c.id, actor, {
        action: 'CONSENT',
        proposalId: proposal.entityId,
        accepted: true,
      });
    const view = await f.cases.view(f.users.reviewer, c.id, true);
    const decide = {
      action: 'DECIDE',
      proposalId: proposal.entityId,
      reasonCode: 'AGREED_RESOLUTION',
      rationale: 'The proposal matches both parties recorded consent.',
      basisEventIds: [view.events[0].id],
      evidenceIds: [],
    };
    return { c, decide, revision: view.revision as number };
  }

  async function snapshot(disputeId: string) {
    const participants = [f.users.seeker, f.users.provider];
    const notifications = await f.db.notification.findMany({
      where: { userId: { in: participants }, resourceId: disputeId },
      select: { id: true },
    });
    return {
      workspace: await f.db.disputeWorkspace.findUniqueOrThrow({ where: { disputeId } }),
      decisions: await f.db.disputeDecisionRecord.count({ where: { disputeId } }),
      decideEvents: await f.db.disputeWorkspaceEvent.count({
        where: { disputeId, kind: 'DECIDE' },
      }),
      receipts: await f.db.disputeCommandReceipt.count({ where: { disputeId } }),
      notifications: notifications.length,
      outbox: await f.db.outboxEvent.count({
        where: { aggregateType: 'DisputeWorkspace', aggregateId: disputeId },
      }),
      dispute: await f.db.dispute.findUniqueOrThrow({ where: { id: disputeId } }),
    };
  }

  it('D9/D10 two conflicting decisions against the same revision: one recorded, one stale', async () => {
    const { c, decide, revision } = await agreed();
    const before = await snapshot(c.id);
    const [x, y] = await Promise.all([
      settle(
        f.commands.execute(
          f.users.reviewer,
          c.id,
          { idempotencyKey: randomUUID(), expectedRevision: revision, command: decide },
          true,
        ),
      ),
      settle(
        f.commands.execute(
          f.users.reviewer,
          c.id,
          {
            idempotencyKey: randomUUID(),
            expectedRevision: revision,
            command: { ...decide, proposalId: null, reasonCode: 'INSUFFICIENT_BASIS' },
          },
          true,
        ),
      ),
    ]);
    const outcomes = [x, y];
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
    const loser = outcomes.find((o) => !o.ok) as { ok: false; error: any };
    expect(loser.error).toMatchObject({ status: 409 });
    expect(['STALE_REVISION', 'CONCURRENT_COMMAND']).toContain(loser.error.details?.reasonCode);
    const after = await snapshot(c.id);
    expect(after.decisions).toBe(1);
    expect(after.decideEvents).toBe(1);
    expect(after.receipts).toBe(before.receipts + 1);
    expect(after.workspace.revision).toBe(before.workspace.revision + 1);
    expect(after.outbox).toBe(before.outbox + 1);
  });

  it('D11/D18 a lost response is replayed, never re-decided; a changed payload under the same key is refused', async () => {
    const { c, decide, revision } = await agreed();
    const envelope = { idempotencyKey: randomUUID(), expectedRevision: revision, command: decide };
    const first = await f.commands.execute(f.users.reviewer, c.id, envelope, true);
    const once = await snapshot(c.id);
    // The client never saw `first`; it retries the identical command.
    const replay = await f.commands.execute(f.users.reviewer, c.id, envelope, true);
    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ ...first, replayed: true });
    await expect(
      f.commands.execute(
        f.users.reviewer,
        c.id,
        {
          ...envelope,
          command: { ...decide, rationale: 'A different rationale under the same key.' },
        },
        true,
      ),
    ).rejects.toMatchObject({ status: 409, details: { reasonCode: 'INTENT_REUSED' } });
    const after = await snapshot(c.id);
    expect(after).toEqual(once);
    expect(after.decisions).toBe(1);
    // The replay is authorized again: a revoked grant refuses even a replay.
    const grant = await f.db.rolePermission.findFirstOrThrow({
      where: { role: { name: f.users.reviewer }, permission: { key: 'dispute:read:any' } },
    });
    await f.db.rolePermission.delete({
      where: { roleId_permissionId: { roleId: grant.roleId, permissionId: grant.permissionId } },
    });
    try {
      await expect(
        f.commands.execute(f.users.reviewer, c.id, envelope, true),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      await f.db.rolePermission.create({ data: grant });
    }
  });

  it('D7 a reviewer whose decide grant was revoked while the case was open cannot decide', async () => {
    const { c, decide, revision } = await agreed();
    const grant = await f.db.rolePermission.findFirstOrThrow({
      where: { role: { name: f.users.reviewer }, permission: { key: 'dispute:decide' } },
    });
    await f.db.rolePermission.delete({
      where: { roleId_permissionId: { roleId: grant.roleId, permissionId: grant.permissionId } },
    });
    try {
      await expect(
        f.commands.execute(
          f.users.reviewer,
          c.id,
          { idempotencyKey: randomUUID(), expectedRevision: revision, command: decide },
          true,
        ),
      ).rejects.toMatchObject({ status: 403 });
      expect((await snapshot(c.id)).decisions).toBe(0);
    } finally {
      await f.db.rolePermission.create({ data: grant });
    }
  });

  it('D15/D16 a decision whose COMMIT is rejected leaves no decision, history, receipt, notice or announcement', async () => {
    const { c, decide, revision } = await agreed();
    const before = await snapshot(c.id);
    const envelope = { idempotencyKey: randomUUID(), expectedRevision: revision, command: decide };
    await decisionTrap(c.id);
    let outcome: Settled<unknown>;
    try {
      outcome = await settle(f.commands.execute(f.users.reviewer, c.id, envelope, true));
    } finally {
      await dropDecisionTrap();
    }
    expect(outcome.ok).toBe(false);
    const aborted = await snapshot(c.id);
    expect(aborted).toEqual(before);
    expect(aborted.workspace.state).toBe('PROPOSED');

    // The same intent, retried after a confirmed abort, is a first execution.
    const retry = await f.commands.execute(f.users.reviewer, c.id, envelope, true);
    expect(retry.replayed).toBe(false);
    const committed = await snapshot(c.id);
    expect(committed.decisions).toBe(1);
    expect(committed.decideEvents).toBe(1);
    expect(committed.workspace.state).toBe('DECIDED');
    expect(committed.receipts).toBe(before.receipts + 1);
    expect(committed.notifications).toBe(before.notifications + 2);
    expect(committed.outbox).toBe(before.outbox + 1);
    expect((await f.commands.execute(f.users.reviewer, c.id, envelope, true)).replayed).toBe(true);
  });

  it('legacy admin tickets cannot decide or edit a workspace case', async () => {
    const { c } = await agreed();
    const before = await snapshot(c.id);
    await expect(
      legacy.resolve(f.users.reviewer, c.id, { status: 'RESOLVED_REFUND', resolution: 'x' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      legacy.update(f.users.reviewer, c.id, { status: 'IN_REVIEW' }),
    ).rejects.toMatchObject({ status: 404 });
    expect((await legacy.list({})).items.map((x: { id: string }) => x.id)).not.toContain(c.id);
    expect(await snapshot(c.id)).toEqual(before);
  });
});
