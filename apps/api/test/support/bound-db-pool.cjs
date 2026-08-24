/**
 * Bound each jest worker's Prisma connection pool. Loaded via `setupFiles`, so
 * it runs in every worker BEFORE the spec file — and therefore before the
 * lazy `require('@homeservicemarketplace/database')` that constructs the
 * client — and before any child process inherits the environment.
 *
 * Why this exists:
 *
 * Prisma sizes a pool at `physical_cpus * 2 + 1` when the URL does not say
 * otherwise. On a 12-core machine that is 25 connections PER CLIENT, and jest
 * runs `cpus - 1` workers, each of which builds its own client. 11 x 25 = 275
 * against a Postgres whose `max_connections` is 100. The pool is lazy, so a
 * light suite never notices; a heavy one exhausts the server and the next
 * process to connect is simply refused.
 *
 * That refusal is what the DB-gated run was actually failing on, and it read
 * as a data-isolation bug because it landed on whichever suite happened to
 * connect last. The clearest instance: the lifecycle backfill spawns the real
 * CLI as a CHILD process, and the child — the newest connector of all — came
 * back with `Can't reach database server at localhost:5432` while the parent
 * worker's own connection was healthy.
 *
 * A worker runs one test at a time, so a handful of connections each is
 * plenty: the concurrency inside any single test here is a couple of
 * interactive transactions, not dozens. `pool_timeout` means a genuine spike
 * waits its turn instead of failing.
 *
 * Test-only by construction: this file is referenced from jest.config.cjs and
 * from nowhere else, so the production connection settings are untouched.
 */
const raw = process.env.DATABASE_URL;

if (raw) {
  try {
    const url = new URL(raw);
    // Respect an explicit choice — including the deliberate
    // `connection_limit=1` the advisory-lock client pins for itself.
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', process.env.TEST_DB_CONNECTION_LIMIT || '5');
      url.searchParams.set('pool_timeout', '20');
      process.env.DATABASE_URL = url.toString();
    }
  } catch {
    // Not a parseable URL. Prisma will report that far better than this file
    // could, and swallowing it here keeps a bad env var from masquerading as
    // a jest configuration error.
  }
}
