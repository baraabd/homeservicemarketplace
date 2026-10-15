# R22 — Outbox and worker execution reliability: implementation

| Field            | Value                                                                                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sprint           | R22 (wave 1 of 4, lane 4 of 5; legacy coverage P47)                                                                                                                                                      |
| Branch           | `feat/r22-worker-outbox-reliability` (worktree `HSM-r22`)                                                                                                                                                |
| Base             | `059c018576a75837d4dfb262ee49168d9217d881` (`develop`, = planning observation)                                                                                                                           |
| Base approval    | No G0 manifest existed in the repository. The coordinator (repository owner) approved this SHA as the frozen G0 base on 2026-10-13, along with the allowlist below and the fail-closed replay behaviour. |
| Final SHA / tree | recorded in `ACCEPTANCE.md` after commit                                                                                                                                                                 |
| Status           | **IMPLEMENTED, SOURCE_VERIFIED (local real PG/Redis), INTEGRATION_PENDING** (CR-01…CR-05)                                                                                                                |

## 1. Approved write allowlist

```
apps/api/src/infrastructure/outbox/outbox.worker.ts          (modified)
apps/api/src/infrastructure/outbox/outbox.repository.ts      (modified)
apps/api/src/infrastructure/outbox/outbox.retry.ts           (modified)
apps/api/src/infrastructure/outbox/outbox.handler.ts         (modified)
apps/api/src/infrastructure/outbox/outbox.errors.ts          (new)
apps/api/src/infrastructure/outbox/outbox-replay.service.ts  (new)
apps/api/src/infrastructure/outbox/*.spec.ts                 (new unit tests)
apps/api/test/integration/r22-outbox-*.integration.spec.ts   (new)
apps/api/test/integration/r22-support/**                     (new)
scripts/production/workers/**                                (new)
infra/production/workers/**                                  (new)
docs/production-readiness/r22/**                             (new)
```

No file outside this list was written. No leases were requested or used.
`outbox.module.ts`, `outbox.tokens.ts` and `outbox-cleanup.job.ts` are
unchanged.

## 2. Findings (baseline `059c018`)

| #   | Finding                                                                                                                                                                                                                                                                         | Evidence                                                                             | Disposition                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| F1  | **Stale lease could overwrite a newer result.** `markProcessed`/`markFailed` updated by `id` only. A worker whose claim had been reclaimed could flip another worker's `PROCESSED` row back to `PENDING`, or dead-letter it.                                                    | `outbox.repository.ts` (base)                                                        | Fixed: lease-fenced `completeLeased`/`failLeased`; unfenced methods removed        |
| F2  | **Effects and terminal state committed separately.** Handlers committed, then `markProcessed` ran in a second statement. A crash between the two redelivered the event.                                                                                                         | `outbox.worker.ts` (base)                                                            | Fixed: `PROCESSED` is the last statement of the delivery transaction               |
| F3  | **Clock-skew reclaim.** `reclaimStale` compared DB-stamped `claimedAt` with an app-clock cutoff. An app host running ahead reclaimed live claims early.                                                                                                                         | test `an application clock running ahead…` (control assertion reproduces the defect) | Fixed: `reclaimExpired` uses `NOW()`                                               |
| F4  | **No lease renewal.** A sequential batch of 50 could outlive the 120 s visibility timeout. Later batch members were then reclaimed while still queued in the claiming worker.                                                                                                   | design; test `the worker heartbeats a batch…`                                        | Fixed: heartbeat every timeout/4 (≤30 s) while holding claims                      |
| F5  | **Marker conflict aborted the transaction.** `claimHandlerRun` caught P2002 after Postgres had aborted the transaction. A second handler, or any later statement in that delivery, then failed.                                                                                 | test `a redelivery with one completed handler still runs the other handler`          | Fixed: `INSERT … ON CONFLICT DO NOTHING`                                           |
| F6  | **Unbounded delivery time.** The implicit Prisma 5 s transaction timeout was the only bound, and nothing bounded a handler awaiting a non-DB promise.                                                                                                                           | design                                                                               | Fixed: explicit 15 s tx timeout + 20 s worker deadline                             |
| F7  | **Shutdown stranded claims.** The rest of a claimed batch stayed `PROCESSING` until the visibility timeout, and the in-flight wait was unbounded.                                                                                                                               | `onModuleDestroy` (base)                                                             | Fixed: bounded grace + release own claims                                          |
| F8  | **Untyped failures only.** Poison events burned the whole budget; a producer-supplied `maxAttempts` was unbounded.                                                                                                                                                              | `outbox.retry.ts` (base)                                                             | Fixed: `OutboxPermanentError`/`OutboxTransientError`, ceiling 25, retry-after hint |
| F9  | **No DLQ replay path.** Operators could only hand-edit rows.                                                                                                                                                                                                                    | —                                                                                    | Added: `OutboxReplayService` + CLI, fail-closed until CR-01                        |
| F10 | **Registry not validated.** Duplicate handler names would share one marker, so one of them is silently skipped forever.                                                                                                                                                         | —                                                                                    | Fixed: boot-time `validateHandlerRegistry`                                         |
| F11 | `DISPUTE_WORKER_ENABLED` is declared but read by nothing.                                                                                                                                                                                                                       | `git grep`                                                                           | CR-02 (config is coordinator-owned); runbooks use `DISPUTE_WORKER_MODE`            |
| F12 | **Premature publication.** Audited all eight realtime publish sites: bids, bookings, conversations, provider bookings and four outbox handlers. All publish **after** commit, and outbox handlers do so only in `afterCommit`. `NotificationsService` never publishes directly. | read-only audit, file:line in §5                                                     | **No defect found**; no domain change requested                                    |

## 3. Design

- **Lease:** `(status = PROCESSING, claimedBy = workerId)`. Every worker
  transition is conditional on it. All lease times use the DB clock.
- **Delivery transaction:** for each handler, insert the marker (`ON CONFLICT
DO NOTHING`), then run the handler. The last statement is the fenced
  `PROCESSED` update. If the lease is lost, throw `OutboxLeaseLostError`, so
  the whole transaction (effects and marker) rolls back and nothing is recorded.
- **Failure:** `permanent` goes straight to `DEAD`. `transient` is retried with
  capped exponential backoff, ±20 % jitter and an optional retry-after hint
  (lengthen only, cap-bounded). Retry ends at
  `min(maxAttempts, 25)`. `lease-lost` means no write and outcome
  `lease-lost`.
- **Deadline:** `Promise.race` against the transaction. The abandoned
  transaction can't commit: Prisma's timeout rolls it back, or its fence
  fails after the failure was recorded.
- **Shutdown:** stop, then a grace period (default 20 s), then
  `releaseClaims(own)`, only if the worker ever claimed. The DB is untouched
  for disabled or idle workers.
- **Replay:** `OutboxReplayService` runs in one transaction:
  1. take a global advisory lock;
  2. authorize: an ACTIVE user with `outbox:replay`, otherwise one refusal for
     every cause;
  3. select scoped `DEAD` rows, at most 50, dead-lettered in the last 30 days,
     using `FOR UPDATE`;
  4. dry-run returns at this point;
  5. require the audit enum to exist (fail closed);
  6. apply the rate limit (10 calls / 200 events per operator-hour, from the
     audit trail);
  7. move the rows `DEAD → PENDING` with `attempts = 0`, never touching
     payload or markers;
  8. write the audit row.

  The CLI adds a two-step `--confirm-count`.

- **Configuration:** new timings are code defaults with lenient env override
  of the same names until CR-02 declares them. Invalid values fall back.
- **Metrics:** no new families, since `MetricsService` is outside the
  allowlist. `lease-lost` is a new value of the existing `outcome` label. New
  series are requested in CR-05.

## 4. Behaviour changes to note at integration

1. The delivery transaction timeout rises from Prisma's implicit 5 s to an
   explicit 15 s. Handlers that previously failed at 5 s and retried may now
   succeed. They hold a pooled connection longer.
2. `PROCESSED` now commits with the effects. A crash after commit no longer
   redelivers; `skipped-duplicate` outcomes should fall.
3. A worker that lost its lease no longer increments `attempts` or writes
   `lastError` for that event.
4. Worker construction throws on an invalid handler registry. All nine
   production handlers pass, verified by name.
5. `OutboxRepository.markProcessed`/`markFailed` were removed (no callers
   anywhere in the tree). `reclaimStale` is kept for the Sprint 6 spec.

## 5. Post-commit publication audit (F12)

All eight sites publish after `await this.tx.run(...)` resolves (POST_COMMIT):

| Site                           | Lines                                                  | Role of the publish         |
| ------------------------------ | ------------------------------------------------------ | --------------------------- |
| `bids.service.ts`              | 338–347 (tx 109–298)                                   | accelerator                 |
| `bookings.service.ts`          | 199–201 (tx 97–177)                                    | accelerator                 |
| `conversations.service.ts`     | 330 (tx 296–309; conflict path returns before publish) | only push path, row durable |
| `provider-bookings.service.ts` | 322–323 (tx 216–300)                                   | accelerator                 |

The four outbox handlers publish only inside the returned `afterCommit`:
`provider-review.events-handler.ts:28`, `dispute-intake.events-handler.ts:27`,
`workspace-events.handler.ts:47` and `notification-created.handler.ts:53`.

## 6. Contract and schema versions

- Prisma schema: unchanged (base). Migration requested: CR-01 (additive enum value).
- Shared contracts package: unchanged.
- Outbox handler contract: extended (rules 4–6, registration contract doc).
  Additive and source-compatible for all existing handlers.

## 7. Change requests (coordinator)

| CR    | Path(s)                                                       | Purpose                                                      | Blocks                            |
| ----- | ------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------- |
| CR-01 | `schema.prisma` + new migration                               | `AuditEventType.OUTBOX_DEAD_LETTER_REPLAYED`                 | replay execution                  |
| CR-02 | `apps/api/src/config/env.schema.ts`, `FEATURE_INVENTORY.json` | declare 3 timing keys; remove inert `DISPUTE_WORKER_ENABLED` | none (defaults apply)             |
| CR-03 | `packages/database/src/seed.ts`                               | seed `outbox:replay` permission, no role grant               | real replay                       |
| CR-04 | `.github/workflows/ci.yml`                                    | run process suite + CLI tests in CI                          | hosted evidence for process suite |
| CR-05 | `metrics.service.ts`, `apps/api/Dockerfile`                   | R23 worker-health series; ship CLIs in image                 | none                              |
