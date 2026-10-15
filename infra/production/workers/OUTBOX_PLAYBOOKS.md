# Background workers — inventory and outbox playbooks (R22)

Operational companion to `docs/adr/0004-transactional-outbox.md` and
`docs/production-readiness/r22/`. Commands assume a shell with `DATABASE_URL`
for the target environment and the built API at `apps/api/dist` (or pass
`--api-dist`). Never paste connection strings, payloads or `.env` contents into
tickets.

## 1. Worker inventory (as of base `059c018`)

| Worker                                        | Process                                               | Activation                                           | Default                                                                           | Claim / lease model                                                                                                                                                        | Shutdown                                                     |
| --------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Outbox delivery (`OutboxWorker`)              | every API replica                                     | `OUTBOX_WORKER_ENABLED`                              | `true`; deployment policy refuses `false`                                         | `FOR UPDATE SKIP LOCKED` claim → lease `(PROCESSING, claimedBy)`; R22 heartbeat, lease-fenced completion/failure, DB-clock reclaim after `OUTBOX_CLAIM_TIMEOUT_MS` (120 s) | R22: stop claiming, bounded grace (20 s), release own claims |
| Outbox cleanup (`OutboxCleanupJob`)           | every API replica                                     | tied to `OUTBOX_WORKER_ENABLED`                      | on                                                                                | chunked delete of `PROCESSED` older than `OUTBOX_RETENTION_HOURS`; never deletes `DEAD`                                                                                    | timer cleared                                                |
| Evidence scan (`EvidenceScanJob`)             | API replica                                           | `EVIDENCE_SCAN_WORKER_ENABLED`                       | `false`; required when `VERIFICATION_ENFORCED`                                    | selection is not a claim; the state write is conditional, so two replicas cannot both persist a verdict                                                                    | timer cleared                                                |
| Verification expiry (`VerificationExpiryJob`) | API replica                                           | `VERIFICATION_EXPIRY_WORKER_ENABLED`                 | `false`                                                                           | selection is not a claim; conditional writes                                                                                                                               | timer cleared                                                |
| Public media cleanup                          | API replica                                           | `PUBLIC_MEDIA_CLEANUP_WORKER_ENABLED`                | `false`                                                                           | module-owned                                                                                                                                                               | timer cleared                                                |
| Evidence retention                            | separate process `dist/evidence-retention.worker.js`  | `EVIDENCE_RETENTION_MODE` = `off`/`shadow`/`enforce` | `off`                                                                             | `EvidenceRetentionJob` rows; honours `holdUntil`                                                                                                                           | SIGTERM/SIGINT handlers                                      |
| Dispute maintenance                           | separate process `dist/dispute-maintenance.worker.js` | `DISPUTE_WORKER_MODE` = `off`/`shadow`/`enforce`     | `off`; `enforce` needs `DISPUTE_WORKER_APPROVAL_REF` + `DISPUTE_WORKER_INFRA_REF` | module-owned locks/queues                                                                                                                                                  | SIGTERM/SIGINT handlers                                      |

`DISPUTE_WORKER_ENABLED` is declared in `env.schema.ts` but **read by nothing**.
Do not set it and do not use it in runbooks; removal is requested in
`docs/production-readiness/r22/shared-change-requests/CR-02-env-keys.md`.

Domain workers keep their own policies. R22 changed only the generic outbox
infrastructure; the scan, retention, expiry and dispute workers are listed so
an operator can see every background actor in one place.

## 2. Signals

Metrics already exported by every replica (`/metrics`, bearer-protected):

| Metric                                              | Use                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `outbox_oldest_pending_age_seconds`                 | **primary alarm**: arrivals are outpacing delivery                            |
| `outbox_queue_depth{status}`                        | backlog shape; `DEAD` > 0 needs a human                                       |
| `outbox_events_processed_total{event_type,outcome}` | `outcome` ∈ processed, skipped-duplicate, retried, dead, **lease-lost** (R22) |
| `outbox_reclaimed_total`                            | a worker died or stalled mid-flight                                           |
| `outbox_event_duration_seconds{event_type}`         | handler latency against the 15 s transaction timeout                          |

Alert rules: `infra/production/workers/outbox-worker.rules.yml`. Further
worker-health series for R23 are requested in CR-05.

Point-in-time snapshot (read-only, database clock):

```sh
node scripts/production/workers/outbox-health.cjs --claim-timeout-ms 120000
```

It reports queue counts, oldest due age, leases per worker, expired leases,
dead letters by type, retrying events by type and the app↔DB clock skew.

## 3. Playbooks

### 3.1 Duplicate delivery

Expected, not an incident. Delivery is at-least-once; effects are made
exactly-once by the handler-run marker (`OutboxHandlerRun`) committed in the
same transaction as the handler's writes and, since R22, the `PROCESSED`
transition itself. `skipped-duplicate` outcomes are this guard working.

Investigate only if a **user-visible** duplicate appears. That means a handler
wrote outside its `tx` or emitted a non-idempotent external call outside
`afterCommit`, or a money/webhook/subscription handler lacks its domain unique key
(`HANDLER_REGISTRATION_CONTRACT.md`). Fix the handler; do not delete markers.

### 3.2 Clock skew

All lease decisions (claim, heartbeat, reclaim, retry `availableAt`) use the
database clock since R22, so app-host skew can no longer reclaim a live claim
early. Residual exposure: producers that pass `availableAt` computed on the app
clock (delays may shift by the skew). Check `clockSkewMs` in the health
snapshot; anything beyond a few seconds is an NTP problem on the host, not an
outbox setting to tune.

### 3.3 Long handler execution

Each delivery has a 15 s transaction timeout and a 20 s worker deadline
(`OUTBOX_DELIVERY_TX_TIMEOUT_MS` / `OUTBOX_DELIVERY_DEADLINE_MS`, code defaults
until CR-02). Past the deadline the delivery is abandoned, its transaction
cannot commit, and the event is retried with backoff (`retried`, lastError
mentions the deadline). Leases of the rest of the batch are renewed by the
heartbeat, so a slow event does not get its batch-mates reclaimed.

Signals: `outbox_event_duration_seconds` p99 approaching 15 s; repeated
`retried` for one `event_type`. Remedy: chunk the work into follow-up events
(see `request.available.batch`). Do not raise the timeout to make a slow
handler pass: a longer transaction holds a pooled connection that the HTTP
path shares.

### 3.4 Database unavailable

The worker loop survives (`outbox.tick.failed` logged every poll); nothing is
claimed, so nothing is lost. In-flight deliveries roll back with their
connection; their leases expire and are reclaimed on recovery without being
charged an attempt. After recovery, expect a burst of `outbox_reclaimed_total`
and a draining `oldest_pending_age`. **Do not** reset `PROCESSING` rows by
hand during the outage; the reclaim does it safely once the DB is back.

### 3.5 Redis unavailable

The outbox does not depend on Redis. Handlers that publish realtime events do
so in `afterCommit`; a failure there is logged (`outbox.after_commit_failed`)
and **not** retried, because the durable row (notification, booking state) is
already committed and clients recover it on refetch. Expect stale live
updates, not lost data. No outbox action is needed.

### 3.6 Unknown handler (`outbox.no_handler`)

An event type with no registered consumer is dead-lettered on first sight
with `lastError: No handler registered for event type "<type>"`. Typical
causes: a deploy that ships a producer before its consumer, or a handler
removed from `AppModule`'s `OutboxModule.forRoot` list. Fix the registration
(coordinator-owned `app.module.ts`), deploy, then replay by `--event-type`
(§3.9). Do not insert markers or edit `eventType` values.

The worker also refuses to **boot** with an invalid registry (duplicate
handler names share one marker and would silently skip work).

### 3.7 Evidence scanner unavailable

Not an outbox failure. The scan job records `SCAN_FAILED` and retries those
after 300 s; documents stay unreadable and verification submission stays
blocked on `EVIDENCE_NOT_CLEAN`. **Never** mark evidence `CLEAN` by hand to
unblock a provider, and never replay `evidence.scanned` to force a verdict:
the event announces a verdict, it does not make one. Restore ClamAV
(`scripts/ci/prod-scanner-smoke.sh` for the probe) and let the job catch up.

### 3.8 Retention hold

Retention jobs whose `holdUntil` is in the future are deferred by the
retention worker itself. Outbox replay never touches retention jobs, evidence
or dispute private data; replaying an `evidence.erased.v1` event redelivers
the announcement, it does not re-run or bypass an erasure. Holds are released
only through the owning module's audited commands.

### 3.9 Dead letters and replay

1. Find them: health snapshot `deadByType`, or alert `OutboxDeadLetters`.
2. Fix the cause first (handler bug, dependency, registration). Replaying
   into an unfixed handler only re-dead-letters it.
3. Dry-run (default; no writes):

   ```sh
   node scripts/production/workers/outbox-replay.cjs \
     --operator <your user id> --reason "INC-1234: <cause> fixed in <version>" \
     --event-type <type> --limit 50
   ```

4. Review the listed ids, then execute with the reviewed count:

   ```sh
   node scripts/production/workers/outbox-replay.cjs ... --execute --confirm-count <n>
   ```

Guarantees, enforced by `OutboxReplayService`:

- **Authorization:** the operator must be an `ACTIVE` user holding
  `outbox:replay`. The permission is seeded (CR-03) but granted to no role by
  default. Granting it is an owner decision.
- **Audit:** an `OUTBOX_DEAD_LETTER_REPLAYED` audit row is written in the same
  transaction, recording reason, scope and ids, but no payloads or error text.
  Until CR-01 is migrated, execution refuses (`audit-unavailable`) and only
  dry-run works.
- **Scope:** an empty scope is refused. The maximum is 50 events per call,
  only `DEAD` rows qualify, and only rows dead-lettered in the last 30 days.
- **Rate limit:** 10 replays and 200 events per operator per hour, counted
  from the audit trail. Replays are serialised cluster-wide.
- **No edits:** payload, event type, aggregate and handler markers are never
  changed. A handler that already committed for the event is skipped on
  redelivery, so replay cannot repeat a ledger posting or notification.

Exit codes: `0` done, `2` refused, `64` usage, `1` unexpected.

### 3.10 Deploys and graceful shutdown

On SIGTERM, Nest's shutdown hooks (`app.enableShutdownHooks()` in `main.ts`) run
`OutboxWorker.onModuleDestroy`:

1. The worker stops claiming.
2. It waits up to 20 s for the in-flight delivery.
3. It releases every claim still leased to itself.

The rest of its batch is claimable by surviving replicas immediately, not after
the 120 s visibility timeout. Keep the container stop grace period above 20 s.
A hard kill is safe but slower: its claims are reclaimed after the visibility
timeout, with no attempt charged.

## 4. What never to do

- Do not `TRUNCATE`, bulk-delete or bulk-update `OutboxEvent` or
  `OutboxHandlerRun`.
- Do not flush shared Redis.
- Do not mark evidence `CLEAN`.
- Do not hand-edit payloads, ledger or financial rows.
- Do not set `DISPUTE_WORKER_ENABLED`.
- Do not replay without a ticket reference in `--reason`.
