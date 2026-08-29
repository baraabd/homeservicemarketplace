/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * Same lazy-require contract as the gated specs themselves: with the DB gates
 * unset nothing here may load the generated Prisma client or open a pool.
 */

/**
 * Isolation boundaries for the DB-gated suites.
 *
 * These suites all talk to ONE database. Historically they kept themselves
 * clean with table-wide `TRUNCATE` and unscoped `deleteMany({})`/`count()`,
 * which is correct only when exactly one suite is running. Under parallel
 * workers one suite wipes rows another is mid-assertion on, which is why
 * jest.config.cjs used to pin `maxWorkers: 1` for any gated run.
 *
 * Serialising the whole gated run is a workaround, not a boundary: it hides
 * the missing isolation and costs the wall-clock of every future suite. This
 * module supplies the two boundaries that actually fix it.
 *
 *  1. `fixturePrefix` — a per-suite namespace. Every id/email a suite invents
 *     carries its prefix, so cleanup is a prefix match over rows the suite
 *     genuinely owns. Concurrent suites become invisible to each other.
 *     The prefix is DETERMINISTIC (no worker id, no randomness) so that a
 *     crashed run leaves rows the next run reclaims rather than orphans.
 *
 *  2. `acquireAdvisoryLock` — for the one case a namespace cannot express: a
 *     suite that intentionally mutates SHARED rows table-wide and asserts on
 *     table-wide totals. The lifecycle backfill is exactly that — a backfill
 *     scans every row by definition, and `totals.written`/`totals.scanned`
 *     are global by construction. It takes the lock EXCLUSIVE; every other
 *     suite that writes the same table takes it SHARED, so those suites still
 *     run concurrently with each other and only the backfill serialises.
 */

/**
 * THE CANONICAL LOCK ORDER, which every suite must follow:
 *
 *     providerLifecycle -> outbox -> workAccessGrants -> serviceRequests
 *
 * Acquire in that order, release in the reverse. Two suites taking two locks
 * in opposite orders deadlock, and a deadlocked CI job presents as a hang
 * rather than as a failure — so a new resource goes on the END of this list,
 * never in the middle, and a suite that needs a subset still takes what it
 * needs in this relative order.
 *
 * A suite must also clean up the rows it owns BEFORE releasing the lock that
 * guards them; releasing first leaves its fixtures visible to whichever suite
 * was waiting.
 */

/** Postgres advisory-lock keys. Arbitrary but must be unique per resource and
 *  stable across runs; collisions would serialise unrelated suites. */
const LOCK_KEYS = {
  /** The `ProviderProfile` lifecycle axes that the Sprint 7 backfill rewrites. */
  providerLifecycle: 907_001,
  /** The outbox queue. `claimBatch` is a queue CONSUMER: it claims whatever is
   *  pending, so it sees rows that no fixture namespace can hide from it. A
   *  suite that drives the worker needs the queue to itself. */
  outbox: 907_002,
  /** The seeded Role / Permission / RolePermission baseline. `seed()` upserts
   *  a fixed set of GLOBAL rows, and the idempotency spec asserts on
   *  table-wide counts of them, so seeders must not overlap it — or each
   *  other, since two concurrent upserts of the same row race. */
  seed: 907_003,
  /** `ProviderWorkAccessGrant`. The expiry sweep is a queue CONSUMER like the
   *  outbox: `runOnce` scans the whole table for grants that are due and
   *  reports `scanned` as a table-wide count, so no fixture namespace can hide
   *  another suite's grant from it.
   *
   *  Added in Sprint 9B.21 after a NEW, unrelated suite shifted worker
   *  scheduling and put a grant-creating suite alongside the sweep for the
   *  first time. The assertion `scanned: 0` — "nothing anywhere is due yet" —
   *  had been true only by luck of ordering. */
  workAccessGrants: 907_004,
  /** `ServiceRequest`. The marketplace preview is a global READER: its query
   *  is `{ status: 'OPEN_FOR_BIDS', deletedAt: null }` with no ownership
   *  scope, because that is the production surface — a preview shows the
   *  marketplace, not the viewer's own rows. So no fixture namespace can hide
   *  another suite's open request from it, exactly as with the outbox and the
   *  grant sweep.
   *
   *  Added in the 9B.22 post-merge repair. `sprint02-constraints` creates an
   *  OPEN_FOR_BIDS request with NO coordinates, and the preview projects a
   *  coordinate-less row to `cellLat: null, cellLng: null` — which the
   *  reconstruction test counts as a second cell and fails on 'Expected 1,
   *  Received 2'. `geo-fanout` is the same hazard with real coordinates in a
   *  different cell. Neither is a snapping defect: the preview's own 25
   *  fixtures snap to one cell with ~24 km of headroom to the cell edge.
   *
   *  The preview suite takes this EXCLUSIVE for its whole run; every suite
   *  that creates, updates or deletes a ServiceRequest takes it SHARED, so
   *  those writers still run beside each other and only the global reader
   *  excludes them. */
  serviceRequests: 907_005,
} as const;

export type LockResource = keyof typeof LOCK_KEYS;
export type LockMode = 'exclusive' | 'shared';

export interface HeldLock {
  release(): Promise<void>;
}

/**
 * The fixture namespace for `suite`. Every row a suite creates should carry
 * this prefix in its primary key (or, for users, its email local part) so the
 * suite can clean up by prefix instead of by truncation.
 */
export function fixturePrefix(suite: string): string {
  return `it-${suite}-`;
}

/**
 * A suite-owned email domain. Same idea as `fixturePrefix`, for the suites
 * whose fixtures are created through the service layer and therefore keyed by
 * email rather than by an id the test chooses.
 */
export function fixtureEmailDomain(suite: string): string {
  return `${suite}.integration.test`;
}

/**
 * Force a single pooled connection.
 *
 * Session-level advisory locks belong to the CONNECTION that took them. Prisma
 * pools, so `pg_advisory_lock` and its matching unlock can otherwise land on
 * different sessions — the lock would leak and the unlock would silently
 * return false. A dedicated client pinned to one connection makes the pair
 * land on the same session by construction.
 */
function singleConnectionUrl(raw: string): string {
  const url = new URL(raw);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('pool_timeout', '30');
  return url.toString();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` while holding the lock, releasing it however `fn` ends.
 *
 * The right shape when the critical section is a single call rather than a
 * whole suite — seeding, say — because it keeps the hold as short as the work.
 */
export async function withAdvisoryLock<T>(
  resource: LockResource,
  mode: LockMode,
  fn: () => Promise<T>,
): Promise<T> {
  const lock = await acquireAdvisoryLock(resource, mode);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}

/**
 * Take a Postgres advisory lock and hold it until `release()`.
 *
 * Uses `pg_try_advisory_lock*` in a bounded poll rather than the blocking
 * `pg_advisory_lock*`: a lock leaked by a crashed run then fails HERE, by
 * name, instead of hanging the suite until jest's timeout kills it with a
 * message that says nothing about locking.
 */
export async function acquireAdvisoryLock(
  resource: LockResource,
  mode: LockMode = 'exclusive',
  timeoutMs = 120_000,
): Promise<HeldLock> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('acquireAdvisoryLock requires DATABASE_URL; the gated suites set it.');
  }

  const { PrismaClient } =
    require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');

  const client: any = new PrismaClient({
    datasources: { db: { url: singleConnectionUrl(databaseUrl) } },
    log: ['error'],
  });

  const key = LOCK_KEYS[resource];
  const tryFn = mode === 'shared' ? 'pg_try_advisory_lock_shared' : 'pg_try_advisory_lock';
  const unlockFn = mode === 'shared' ? 'pg_advisory_unlock_shared' : 'pg_advisory_unlock';

  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      const rows: Array<{ locked: boolean }> = await client.$queryRawUnsafe(
        `SELECT ${tryFn}($1::bigint) AS locked`,
        key,
      );
      if (rows[0]?.locked) break;
      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out after ${timeoutMs}ms taking the ${mode} advisory lock on "${resource}" ` +
            `(key ${key}). Another suite is holding it, or a crashed run leaked it.`,
        );
      }
      await sleep(25);
    }
  } catch (err) {
    await client.$disconnect().catch(() => undefined);
    throw err;
  }

  let released = false;
  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      // Disconnecting would drop the lock anyway (Postgres releases session
      // locks when the session ends); unlocking first keeps the intent legible
      // and keeps the pair symmetric if this ever moves to a shared client.
      await client.$queryRawUnsafe(`SELECT ${unlockFn}($1::bigint)`, key).catch(() => undefined);
      await client.$disconnect().catch(() => undefined);
    },
  };
}
