# ADR 0004 — Transactional outbox for fan-out and deferred work

- **Status:** Accepted
- **Date:** 2026-08-23
- **Sprint:** 06

## Context

`RequestsService.create` committed the request, then — post-commit, in the
HTTP request thread — resolved every matching provider and wrote their
notifications in a loop:

```ts
const created = await this.tx.run(async (tx) => {
  /* ...request + event... */
});
await this.fanOutRequestAvailable(created, seekerUserId); // post-commit
```

and inside that method, per recipient:

```ts
try {
  await this.notifications.createForUser({ ... });   // its own transaction
  this.realtime.publishFor(userId, 'request.available', ...);
} catch (err) {
  this.log.warn({ msg: 'request.fanout.recipient_failed', ... });  // swallowed
}
```

Four defects, in increasing order of severity:

1. **Unbounded work on the request path.** Every recipient is a separate
   round-trip inside the seeker's HTTP request. In a dense city the seeker
   waits on hundreds of writes to a thing they did not ask for.
2. **Unbounded memory.** `listEligibleUserIdsForRequest` returned every
   matching provider in one array with no pagination.
3. **Silent partial delivery.** A per-recipient failure was logged and
   skipped. Providers 1–40 get notified, 41 fails, 42–200 continue. Nobody is
   told, and nothing retries.
4. **Total loss on a crash.** The fan-out ran _after_ the commit. A process
   killed in the window between them loses the announcement entirely, with no
   record that it was owed. This is the one that matters: the request exists,
   no provider hears about it, no bid arrives, and the only symptom is a
   seeker wondering why nobody responded.

That is a dual-write: two systems (the request row, the notifications) updated
without a shared transaction, coordinated by hope.

## Options

**A. Keep post-commit, add retries in memory.** Cheapest. Does not fix (4) at
all — an in-memory retry queue dies with the process — and makes (1) worse by
holding the request thread longer.

**B. A message broker (BullMQ on the existing Redis).** Purpose-built, has
retries and dead-letter queues. But enqueuing to Redis after a Postgres commit
_is the same dual-write_: the commit can succeed and the enqueue fail. Solving
that requires an outbox anyway — one that feeds the broker instead of feeding
the handlers. It also adds a second durable store that can disagree with the
database, and Redis in this deployment is configured as a cache.

**C. Transactional outbox in Postgres.** The event is a row, written in the
same transaction as the domain mutation, so they commit or roll back together.
A worker polls, claims, and delivers with retries.

## Decision

**Option C.** The queue is a table in the database that already holds the
truth.

```
enqueue ──▶ PENDING ──claim──▶ PROCESSING ──success──▶ PROCESSED ──reap──▶ ∅
               ▲                    │
               │                    ├── failure, attempts < max ──▶ PENDING
               │                    │     (availableAt = now + backoff)
               │                    │
               │                    ├── failure, attempts = max ──▶ DEAD
               │                    │
               └── claim timeout ───┘  (worker crashed; attempts unchanged)
```

### Delivery guarantee

**At-least-once delivery, exactly-once effect.**

At-least-once is unavoidable: any system that can crash between "did the work"
and "recorded that it did the work" must redeliver. Exactly-once _effect_ is
achieved with an idempotency ledger — `OutboxHandlerRun`, primary key
`(eventId, handler)` — inserted **inside the handler's own transaction**
alongside its effects. A redelivery hits the primary key, the insert conflicts,
and the work is skipped. Because the marker and the effects share one
transaction, there is no window where one exists without the other.

### The claim

```sql
UPDATE "OutboxEvent" SET status = 'PROCESSING', claimedBy = $1, claimedAt = NOW()
WHERE id IN (
  SELECT id FROM "OutboxEvent"
  WHERE status = 'PENDING' AND "availableAt" <= NOW()
  ORDER BY "availableAt", id
  LIMIT $2
  FOR UPDATE SKIP LOCKED
) AND status = 'PENDING'
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` is what makes N replicas safe with no coordination:
a second worker running the identical statement steps over locked rows instead
of blocking. `RETURNING` makes claim-and-read atomic, and the repeated
`status = 'PENDING'` closes the gap between the subquery and the update.

There is no leader election and no worker registry. Every API replica runs a
worker; they meet only in this statement.

### Retry policy

Exponential with jitter — `base * 2^(attempts-1)`, capped:

| Attempt | Delay (base 1s) |
| ------- | --------------- |
| 1       | 1s              |
| 2       | 2s              |
| 3       | 4s              |
| 4       | 8s              |
| 5       | 16s             |
| 6       | 32s             |
| 7       | 64s             |
| 8       | 128s → **DEAD** |

Just over four minutes across the default budget of 8: long enough to ride out
a dependency restart, short enough that a genuinely broken event dead-letters
while the deploy that broke it is still the obvious suspect. ±20% jitter stops
a batch that failed against one downed dependency from retrying in lockstep and
re-flattening it on recovery.

Backoff is implemented by pushing `availableAt` into the future, not by
sleeping a worker — a sleeping worker is throughput lost for every _other_
event.

### Crash recovery

A worker killed mid-flight leaves rows in `PROCESSING`, claimed by a process
that no longer exists. Nothing else would ever pick them up. Rows whose
`claimedAt` is older than `OUTBOX_CLAIM_TIMEOUT_MS` (default 120s) are returned
to `PENDING`.

Reclaiming does **not** increment `attempts`: the event was never actually
tried, and charging it would let a crash loop exhaust the retry budget of
events that are perfectly healthy.

### Batching

Fan-out is two stages. The dispatcher resolves recipients by keyset-paged scan
and emits N `request.available.batch` events of at most
`OUTBOX_FANOUT_BATCH_SIZE` recipients; each batch handler writes its slice in
one `createMany`. So:

- transaction size is bounded by the batch size, not by how many providers
  happen to match;
- a failure retries 200 notifications, not 10,000;
- slices are independent rows, so replicas drain them in parallel through the
  ordinary claim path.

### Transactional vs. non-transactional effects

`handle()` runs inside the transaction; anything that leaves the database
returns as an `afterCommit` callback. Realtime publishes and SMTP sends cannot
be rolled back, and a slow SMTP server inside a transaction holds locks for its
whole timeout.

`afterCommit` effects are at-least-once and **not** covered by the marker: a
crash between commit and callback loses them. That is deliberate. The durable
notification row is the delivery guarantee; the realtime push is an accelerator
that saves the provider one poll. Anything that must not be lost is written to
the database inside `handle()`.

**OTP and password-reset mail deliberately stay synchronous.** They are
request-scoped, the user is waiting, and a deferred code is a broken login. The
outbox is for work the user is not blocked on.

## Consequences

**Good**

- A crash can no longer lose a fan-out. The event is committed with the
  request.
- Request-path latency no longer scales with recipient count.
- Failures are visible: `DEAD` rows, an error log, and
  `outbox_events_processed_total{outcome="dead"}`.
- Retries are automatic and bounded.
- Adding deferred work is one `enqueue` in an existing transaction.

**Costs / risks**

- **Delivery is now asynchronous.** Notifications arrive one poll interval
  later (≤2s idle, immediate under load). Previously they were written before
  the HTTP response returned. This is a real, user-visible change.
- **Polling has a floor.** Every replica queries every
  `OUTBOX_POLL_INTERVAL_MS` even when idle. Cheap (an index scan returning
  nothing), but not free. `LISTEN/NOTIFY` would remove it and is the obvious
  future optimisation.
- **A stalled worker is silent** unless someone watches the metrics. Alert on
  `outbox_oldest_pending_age_seconds`, not on queue depth: depth is ambiguous
  (a large backlog draining fast is healthy), a rising oldest-age is not.
- **`enqueue` failure now fails the domain mutation.** Deliberate: a request no
  provider is told about is not a request. It does mean the outbox table is on
  the critical path for request creation.
- **Handler names are database values.** Renaming one re-runs every historical
  event through the "new" handler. Add names; never repurpose them.
- **The dead-letter state has no UI.** Today it is a `SELECT` and a manual
  requeue. Acceptable while volumes are small; an admin surface is the first
  thing to add if dead letters become routine.

## Alternatives revisited later

- **`LISTEN/NOTIFY`** to wake workers immediately and drop the poll floor. Pure
  latency win, no semantic change — the poll stays as the safety net, because
  `NOTIFY` is not durable across a reconnect.
- **A broker**, if fan-out grows beyond what one Postgres table serves
  comfortably. The outbox stays either way; it would feed the broker.

## Verification

Covered by `apps/api/test/integration/outbox.integration.spec.ts` against a
real Postgres (19 cases): parallel claims never double-hand an event; a crashed
worker's rows are reclaimed without charging an attempt; a handler that throws
mid-transaction leaves no partial effect and no marker; a redelivered event
does not re-run its handler; retries back off and reach `DEAD`; four concurrent
workers drain a 120-event backlog with every event handled exactly once; and
cleanup reaps `PROCESSED` rows but never dead letters.
