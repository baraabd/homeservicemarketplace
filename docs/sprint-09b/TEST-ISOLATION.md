# Sprint 9B — DB-gated test isolation

Closes the item the completion matrix recorded as a pre-existing parallelism
flake, and removes the `maxWorkers: 1` workaround that had been standing in for
a real boundary.

## What was actually wrong

Three independent defects were wearing one costume. The suite that got blamed —
`provider-lifecycle-backfill.integration.spec.ts` — was a victim of the first
two and only genuinely responsible for the third.

### 1. Table-wide resets in a shared database

The gated suites kept themselves clean with `TRUNCATE` and unscoped
`deleteMany({})`. That is a correct reset only while exactly one suite is
running. Under parallel workers:

| Suite        | Did                                                                     | Broke                                                           |
| ------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| `auth-flow`  | `TRUNCATE "AuditEvent","Session","VerificationToken","UserRole","User"` | `password-reset`, `sprint02-constraints` — their users vanished |
| `geo-fanout` | `TRUNCATE ...,"OutboxEvent","Bid","ServiceRequest","ProviderProfile"`   | `outbox`, `provider-lifecycle-backfill`                         |
| `outbox`     | `TRUNCATE "OutboxHandlerRun","OutboxEvent"`                             | `geo-fanout` (returned the favour)                              |

Plus two table-wide READS that saw other suites' rows: `auth-flow`'s
`verificationToken.count()` (asserting an unknown email created no token, while
counting every token in the database) and `outbox`'s `outboxEvent.count()`.

**Fix:** per-suite fixture namespaces (`test/support/db-isolation.ts`), so
cleanup is a prefix match over rows the suite owns and assertions are scoped to
them. `geo-fanout` no longer clears Outbox or Bid at all — it never wrote
either; they were in the `TRUNCATE` purely as FK collateral.

### 2. A missing timeout budget, not a missing boundary

`seed-idempotency` and `migration-bootstrap` inherited jest's 5 s default while
every sibling gated spec sets 60–180 s. Two full seeds and six counts against a
real database do not fit in 5 s on a loaded parallel run. Both now set an
explicit budget, matching the siblings.

### 3. Genuinely shared state, which a namespace cannot express

Two cases survive perfect fixture hygiene:

- **The backfill** is a whole-table mutator that asserts on whole-table totals
  (`totals.written`, `totals.scanned`). A provider profile created by any other
  suite between its two `--apply` runs lands in the second run's write count.
- **`claimBatch`** is a queue _consumer_: it claims whatever is pending, by
  design, so a row enqueued elsewhere is claimed here.
- **`seed()`** upserts a fixed set of global rows from four different suites,
  while `seed-idempotency` asserts on table-wide counts of exactly those rows.

**Fix:** narrowly scoped Postgres advisory locks, one key per resource. The
backfill takes `providerLifecycle` EXCLUSIVE; every other suite that writes
`ProviderProfile` takes it SHARED, so those suites still run concurrently with
each other and only the backfill serialises against them.

Session-level advisory locks belong to the connection that took them, and Prisma
pools — so the lock client pins `connection_limit=1`, which makes lock and
unlock land on the same session by construction. Acquisition polls
`pg_try_advisory_lock*` against a deadline rather than blocking, so a lock leaked
by a crashed run fails by name instead of hanging until jest's timeout.

## A fourth thing, found by measuring

Prisma sizes a pool at `physical_cpus * 2 + 1` unless the URL says otherwise —
25 connections per client on a 12-core machine, times `cpus - 1` jest workers,
against a Postgres whose `max_connections` is 100. The clearest symptom: the
backfill spawns the real CLI as a child process, and the child — the newest
connector of all — came back with `Can't reach database server at
localhost:5432` while its parent worker's own connection was healthy.

`test/support/bound-db-pool.cjs` caps each worker's pool via `setupFiles`, which
runs before the spec loads and therefore before the client is constructed and
before any child inherits the environment. Test-only: referenced from
`jest.config.cjs` and nowhere else, so production connection settings are
untouched.

## What was NOT done

None of the forbidden shortcuts: no retries, no `--runInBand`, no reduced worker
count, no skipped tests, no weakened assertions. No production code changed —
every edit is under `apps/api/test/` or `jest.config.cjs`.

## Evidence

| Condition                                    | Before                         | After                    |
| -------------------------------------------- | ------------------------------ | ------------------------ |
| `test/integration`, 4 workers                | 5 suites / 23 tests FAIL       | 9 suites / 87 tests pass |
| `test/integration`, default workers, 20 runs | flaky                          | 20/20 pass               |
| backfill spec in isolation                   | 18/18 pass                     | 18/18 pass               |
| full API suite, gates ON, serial             | 1925 pass (in 29.7 s + 148 s)  | unchanged                |
| full API suite, gates ON, default workers    | 1 suite FAIL (matrix, Phase 7) | see RESULTS below        |

Test count is unchanged at 1925 — this work adds isolation, not tests.

`test/integration` alone went from 29.7 s serial to 10.5 s at 4 workers.
