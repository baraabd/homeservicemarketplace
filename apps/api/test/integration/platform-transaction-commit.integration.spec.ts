/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * Lazy requires: with RUN_DB_INTEGRATION unset this spec is skipped, and a
 * top-level import would still open the Prisma client's pool.
 */

export {};

import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';

// PLATFORM-TX-1 — what a transaction's promise means, against real PostgreSQL.
//
// docs/production-readiness/platform/TRANSACTION_COMMIT_AUTHORITY.md
//
// The repository's TransactionRunner (Layer 2) over the generated client.
// Every "did it commit?" question is answered by a SEPARATE PrismaClient
// instance (its own pool, no shared transaction), never by the client under
// test. Failures are injected with test-only
// triggers on tables this suite creates and drops; no production table or
// migration carries them.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(180_000);

d('PLATFORM-TX-1 transaction commit authority (real Postgres)', () => {
  let prisma: any;
  let runner: any;
  // Independent verifier: its own PrismaClient and pool.
  let pg: {
    query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
    end: () => Promise<void>;
  };
  let locks: HeldLock | undefined;
  const P = fixturePrefix('ptx')
    .replace(/[^a-z0-9_]/gi, '_')
    .toLowerCase();
  const T = `${P}rows`;
  const USER = `${fixturePrefix('ptx')}user`;

  const count = async (where = 'TRUE') =>
    (await pg.query(`SELECT count(*)::int AS n FROM ${T} WHERE ${where}`)).rows[0].n as number;

  /** A row in T whose id is `id` makes the enclosing transaction fail AT COMMIT. */
  async function rejectAtCommit(id: number): Promise<void> {
    await pg.query(`CREATE OR REPLACE FUNCTION ${T}_reject() RETURNS trigger AS $$
      BEGIN
        IF NEW.id = ${id} THEN
          RAISE EXCEPTION 'ptx: rejected at commit' USING ERRCODE = 'P0001';
        END IF;
        RETURN NULL;
      END $$ LANGUAGE plpgsql`);
    await pg.query(`DROP TRIGGER IF EXISTS ${T}_reject_t ON ${T}`);
    await pg.query(`CREATE CONSTRAINT TRIGGER ${T}_reject_t AFTER INSERT ON ${T}
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${T}_reject()`);
  }
  async function clearTriggers(): Promise<void> {
    await pg.query(`DROP TRIGGER IF EXISTS ${T}_reject_t ON ${T}`);
    await pg.query(`DROP FUNCTION IF EXISTS ${T}_reject()`);
  }

  beforeAll(async () => {
    locks = await acquireAdvisoryLocks([{ resource: 'outbox' as const, mode: 'shared' as const }]);
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    runner = new TransactionRunner({ client: prisma });
    const verifier = new db.PrismaClient();
    pg = {
      query: async (text, params = []) =>
        /^\s*(select|with)\b/i.test(text)
          ? { rows: await verifier.$queryRawUnsafe(text, ...params) }
          : (await verifier.$executeRawUnsafe(text, ...params), { rows: [] }),
      end: () => verifier.$disconnect(),
    };
    await pg.query(`DROP TABLE IF EXISTS ${T}`);
    await pg.query(`CREATE TABLE ${T} (id int PRIMARY KEY, note text)`);
  });

  afterAll(async () => {
    try {
      await clearTriggers();
      await pg?.query(`DROP TABLE IF EXISTS ${T}`);
      await prisma?.notification.deleteMany({ where: { userId: USER } });
      await prisma?.user.deleteMany({ where: { id: USER } });
    } finally {
      await pg?.end();
      await locks?.release();
    }
  });

  beforeEach(async () => {
    await clearTriggers();
    await pg.query(`TRUNCATE ${T}`);
  });

  it('T1 a committed transaction returns its result and its rows exist', async () => {
    const value = await runner.run(async (tx: any) => {
      await tx.$executeRawUnsafe(`INSERT INTO ${T} VALUES (1, 'ok')`);
      return 'committed';
    });
    expect(value).toBe('committed');
    expect(await count()).toBe(1);
  });

  it('T2 an exception thrown by the callback rejects and leaves nothing', async () => {
    await expect(
      runner.run(async (tx: any) => {
        await tx.$executeRawUnsafe(`INSERT INTO ${T} VALUES (2, 'x')`);
        throw new Error('callback failed');
      }),
    ).rejects.toThrow('callback failed');
    expect(await count()).toBe(0);
  });

  it('T3 a failing statement rejects and leaves nothing', async () => {
    await expect(
      runner.run(async (tx: any) => {
        await tx.$executeRawUnsafe(`INSERT INTO ${T} VALUES (3, 'x')`);
        await tx.$executeRawUnsafe(`INSERT INTO ${T} VALUES (3, 'duplicate')`);
      }),
    ).rejects.toBeDefined();
    expect(await count()).toBe(0);
  });

  it('T4 a failure raised AT COMMIT rejects the transaction and leaves nothing', async () => {
    await rejectAtCommit(4);
    let statementsSucceeded = false;
    const outcome = await runner
      .run(async (tx: any) => {
        await tx.$executeRawUnsafe(`INSERT INTO ${T} VALUES (4, 'rejected at commit')`);
        await tx.$executeRawUnsafe(`INSERT INTO ${T} VALUES (5, 'its sibling')`);
        statementsSucceeded = true;
        return 'callback-returned';
      })
      .then(
        (value: unknown) => ({ resolved: value }),
        (error: any) => ({ rejected: String(error?.message ?? error) }),
      );
    // The fault is at COMMIT: every statement inside the callback succeeded.
    expect(statementsSucceeded).toBe(true);
    expect(outcome).toEqual({ rejected: expect.stringContaining('ptx: rejected at commit') });
    expect(await count()).toBe(0);
  });

  it('T5 a statement failure caught inside the callback cannot be turned into success', async () => {
    const outcome = await runner
      .run(async (tx: any) => {
        await tx.$executeRawUnsafe(`INSERT INTO ${T} VALUES (6, 'x')`);
        try {
          await tx.$executeRawUnsafe(`INSERT INTO ${T} VALUES (6, 'duplicate')`);
        } catch {
          // A caller swallowing the error must not end in a committed success:
          // PostgreSQL has aborted the transaction.
        }
        await tx.$executeRawUnsafe(`INSERT INTO ${T} VALUES (7, 'after the swallowed error')`);
        return 'callback-returned';
      })
      .then(
        () => 'resolved',
        () => 'rejected',
      );
    expect(outcome).toBe('rejected');
    expect(await count()).toBe(0);
  });

  it('T6 a serializable conflict is a classified rejection; the winner alone commits', async () => {
    await pg.query(`INSERT INTO ${T} VALUES (100, 'on'), (101, 'on')`);
    let release!: () => void;
    const bothRead = new Promise<void>((r) => (release = r));
    let reads = 0;
    const goOff = (me: number) =>
      runner.run(
        async (tx: any) => {
          const rows = await tx.$queryRawUnsafe(
            `SELECT count(*)::int AS n FROM ${T} WHERE note = 'on'`,
          );
          if (++reads === 2) release();
          await bothRead;
          if (rows[0].n >= 2)
            await tx.$executeRawUnsafe(`UPDATE ${T} SET note = 'off' WHERE id = ${me}`);
          return me;
        },
        { isolationLevel: 'Serializable', timeout: 30_000 },
      );
    const results = await Promise.allSettled([goOff(100), goOff(101)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // SSI raises 40001 at whichever point detects the conflict. Prisma reports
    // it as P2034 at COMMIT or on a model query, and as P2010 carrying the
    // SQLSTATE when a raw statement (as here, on a synthetic table) detects it.
    const reason = rejected[0].reason;
    expect(
      reason?.code === 'P2034' || (reason?.code === 'P2010' && reason?.meta?.code === '40001'),
    ).toBe(true);
    // Exactly the fulfilled caller's write committed; the invariant holds.
    expect(await count(`note = 'off'`)).toBe(1);
    expect(await count(`note = 'on'`)).toBe(1);
  });

  it('T7 a transaction that outlives its timeout rejects and leaves nothing', async () => {
    await expect(
      runner.run(
        async (tx: any) => {
          await tx.$executeRawUnsafe(`INSERT INTO ${T} VALUES (8, 'x')`);
          await tx.$queryRawUnsafe('SELECT pg_sleep(1.5)');
          await tx.$executeRawUnsafe(`INSERT INTO ${T} VALUES (9, 'x')`);
        },
        { timeout: 500 },
      ),
    ).rejects.toBeDefined();
    expect(await count()).toBe(0);
  });

  it('T8 a connection lost at COMMIT is never reported as success', async () => {
    // The deferred trigger parks COMMIT in pg_sleep; an independent session
    // terminates that backend while it waits. From the client's side this is
    // OUTCOME_UNKNOWN: it must reject, and it must not look like the
    // classified, retry-on-reload conflict (P2034) that callers map to 409.
    await pg.query(`CREATE OR REPLACE FUNCTION ${T}_reject() RETURNS trigger AS $$
      BEGIN PERFORM pg_sleep(10); RETURN NULL; END $$ LANGUAGE plpgsql`);
    await pg.query(`CREATE CONSTRAINT TRIGGER ${T}_reject_t AFTER INSERT ON ${T}
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${T}_reject()`);
    let backend = 0;
    const pending = runner
      .run(
        async (tx: any) => {
          backend = (await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid'))[0].pid;
          await tx.$executeRawUnsafe(`INSERT INTO ${T} VALUES (10, 'x')`);
          return 'callback-returned';
        },
        { timeout: 60_000 },
      )
      .then(
        (value: unknown) => ({ resolved: value }),
        (error: any) => ({ rejected: true, code: error?.code ?? null }),
      );
    // Barrier: that backend must be inside the deferred trigger, i.e. COMMIT
    // has started and not finished, before it is terminated.
    let parked = false;
    for (let i = 0; i < 100 && !parked; i += 1) {
      const { rows } = await pg.query(
        `SELECT wait_event FROM pg_stat_activity WHERE pid = $1::int`,
        [backend],
      );
      parked = backend > 0 && rows[0]?.wait_event === 'PgSleep';
      if (!parked) await new Promise((r) => setTimeout(r, 100));
    }
    expect(parked).toBe(true);
    await pg.query('SELECT pg_terminate_backend($1::int)', [backend]);
    const outcome = await pending;
    expect(outcome).toMatchObject({ rejected: true });
    expect((outcome as { code: unknown }).code).not.toBe('P2034');
    // Only because the backend died INSIDE the deferred trigger, before the
    // commit record, does the server side know nothing committed. A client
    // that lost the connection later could not assume this.
    expect(await count()).toBe(0);
  });

  it('T11 a notification and its announcement roll back with a COMMIT failure', async () => {
    await prisma.user.upsert({
      where: { id: USER },
      update: {},
      create: {
        id: USER,
        email: `${USER}@ptx.test`,
        firstName: 'Tala',
        lastName: 'Fixture',
        status: 'ACTIVE',
        emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    const {
      NotificationsService,
    } = require('../../src/modules/notifications/notifications.service');
    const {
      NotificationRepository,
    } = require('../../src/infrastructure/persistence/notifications/notification.repository');
    const { OutboxRepository } = require('../../src/infrastructure/outbox/outbox.repository');
    const prismaSvc = { client: prisma };
    const notifications = new NotificationsService(
      new NotificationRepository(prismaSvc),
      new OutboxRepository(prismaSvc),
      runner,
    );
    await rejectAtCommit(11);
    let notificationId = '';
    await expect(
      runner.run(async (tx: any) => {
        const n = await notifications.createForUser(
          { userId: USER, type: 'SYSTEM', title: 'ptx', body: 'ptx', deepLink: '/home/ptx' },
          tx,
        );
        notificationId = n.id;
        await tx.$executeRawUnsafe(`INSERT INTO ${T} VALUES (11, 'business change')`);
        return n.id;
      }),
    ).rejects.toThrow('ptx: rejected at commit');
    // Both rows were written inside the rejected transaction. Scoped to this
    // test's own ids: other suites share these tables in parallel.
    expect(notificationId).not.toBe('');
    const rows = await pg.query(
      `SELECT (SELECT count(*)::int FROM "Notification" WHERE "userId" = $1 OR id = $2) AS n,
              (SELECT count(*)::int FROM "OutboxEvent" WHERE "aggregateId" = $2) AS announcements`,
      [USER, notificationId],
    );
    expect(rows.rows[0]).toEqual({ n: 0, announcements: 0 });
    expect(await count()).toBe(0);

    // Control: the same operation, committed, is found by the same filter.
    // Without it, the zeros above could come from a filter that never matches.
    await clearTriggers();
    let committedId = '';
    try {
      committedId = await runner.run(async (tx: any) => {
        const n = await notifications.createForUser(
          { userId: USER, type: 'SYSTEM', title: 'ptx', body: 'ptx', deepLink: '/home/ptx' },
          tx,
        );
        await tx.$executeRawUnsafe(`INSERT INTO ${T} VALUES (13, 'business change')`);
        return n.id;
      });
      expect(committedId).not.toBe('');
      const committed = await pg.query(
        `SELECT (SELECT count(*)::int FROM "Notification" WHERE "userId" = $1 OR id = $2) AS n,
                (SELECT count(*)::int FROM "OutboxEvent"
                   WHERE "aggregateId" = $2 AND "eventType" = 'notification.created') AS announcements`,
        [USER, committedId],
      );
      expect(committed.rows[0]).toEqual({ n: 1, announcements: 1 });
      expect(await count()).toBe(1);
    } finally {
      // Leave no rows in the shared outbox for other suites to see.
      if (committedId) {
        await prisma.outboxHandlerRun.deleteMany({
          where: { event: { aggregateId: committedId } },
        });
        await prisma.outboxEvent.deleteMany({ where: { aggregateId: committedId } });
      }
    }
  });

  it('T14 the pool serves a clean transaction after every failure above', async () => {
    await rejectAtCommit(12);
    await expect(
      runner.run((tx: any) => tx.$executeRawUnsafe(`INSERT INTO ${T} VALUES (12, 'x')`)),
    ).rejects.toBeDefined();
    await clearTriggers();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        runner.run(async (tx: any) => {
          await tx.$executeRawUnsafe(`INSERT INTO ${T} VALUES (${200 + i}, 'clean')`);
          return i;
        }),
      ),
    );
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(await count()).toBe(8);
  });
});
