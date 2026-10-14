# Outbox handler registration contract (R22)

Status: **published by R22 for later lanes** (money, provider webhooks,
subscriptions, R23 observability). Interface source of truth:
`apps/api/src/infrastructure/outbox/outbox.handler.ts`,
`outbox.errors.ts`, `outbox.tokens.ts`. This document adds no product
policy. It does not decide payouts, fees, currencies or plan prices, and it
does not grant work access. See R16 `PAYOUT_POLICY.md`, R18 `BLOCKERS.md` and
`docs/money/LIVE_MONEY_GATE.md` for those.

## 1. Delivery guarantees a handler can rely on

| Guarantee                                                               | Mechanism                                                                                                  |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Intent exists iff the business change committed                         | producer calls `OutboxRepository.enqueue(input, tx)` with the domain transaction                           |
| Delivery is **at-least-once**                                           | claim lease + reclaim + retry                                                                              |
| A handler's committed effects happen **once per (event, handler name)** | `OutboxHandlerRun` marker inserted first in the delivery transaction                                       |
| Effects, marker and `PROCESSED` commit atomically                       | lease-fenced `completeLeased` is the last statement of the same transaction                                |
| A stale worker cannot commit or record failure over a newer owner       | lease fence (`status = PROCESSING AND claimedBy = <worker>`)                                               |
| Bounded run time                                                        | 15 s transaction timeout, 20 s worker deadline (defaults; CR-02)                                           |
| Bounded retries                                                         | capped exponential backoff with ±20 % jitter; per-row `maxAttempts` bounded by `MAX_ATTEMPTS_CEILING` (25) |

The marker is per **handler name**. Renaming a handler, or replaying an
event after an operator has removed its marker, re-runs it. That is why
financial handlers need §3.

## 2. Registration steps (every handler)

1. Implement `OutboxHandler` in the **owning domain module**. Never put
   domain logic in `infrastructure/outbox`.
2. `name`: `<domain>.<purpose>.v<N>`, lower case, matching
   `/^[a-z0-9][a-z0-9._-]{2,79}$/`. It is a persisted key. Never rename it;
   introduce `.v<N+1>` deliberately if re-delivery of history is intended.
3. `eventTypes`: add new names to `OutboxEventType` (`outbox.tokens.ts`) or a
   domain constant. They are persisted values: never repurpose an old name.
4. Submit a coordinator change request adding the class to
   `OutboxModule.forRoot({ handlers, imports })` in `apps/api/src/app.module.ts`.
   That file is coordinator-owned. An unregistered event type is
   dead-lettered with `No handler registered…`.
5. The worker validates the registry at boot. Duplicate names, empty
   `eventTypes` or invalid names fail startup.
6. Classify failures. Throw `OutboxPermanentError` when retrying cannot help.
   Throw `OutboxTransientError(msg, retryAfterMs?)` or any other error to
   retry. Never swallow an error to "succeed".
7. Write every durable effect with the supplied `tx`. Return external effects
   (realtime, e-mail, vendor calls that are safe to lose or repeat) as
   `afterCommit`. They run after commit, at most once per successful delivery,
   and are not retried.
8. Add a real-Postgres test that delivers the event twice and asserts one
   effect.

## 3. Additional rules for money, webhook and subscription handlers

These are interface obligations only. Whether such handlers are enabled at all
is decided by the live-money gate and owner decisions, not by registration.

### 3.1 Money (ledger postings, payout requests, refunds)

- **Domain idempotency key, enforced by a unique constraint and written in
  `tx`.** Examples: ledger posting key `(sourceType, sourceId, purpose)` or the
  R15 posting idempotency key. The handler inserts with that key; a conflict
  means "already applied" and is success. The outbox marker is a second line
  of defence, never the only one.
- Amounts, currencies and the source of truth are read from the database inside
  `tx`, never from the event payload. The payload carries identifiers only.
- Never call a payment provider inside `handle`. Persist an intent row in
  `tx`, and let a provider-specific worker or `afterCommit` act on it with
  the provider's own idempotency key. A provider call is not transactional.
- Corrections are new reversing entries, never updates or deletes of posted
  history. Replay must therefore be harmless: the unique key turns a
  re-run into a no-op.
- `OutboxPermanentError` for a business rejection (closed account, policy
  refusal), recorded as a domain row first so the dead letter is explainable.

### 3.2 Inbound provider webhooks

- Verify the signature **before** enqueueing, in the HTTP handler. The
  outbox carries only verified events.
- Store the raw verified event in a domain table keyed by the provider's
  event id (unique), in the same transaction as the enqueue
  (`dedupeKey = <provider>:<eventId>`). Duplicate webhook deliveries then
  collapse at the producer.
- The handler applies state changes conditionally on the current state
  (compare-and-set). Provider events arrive out of order. Treat an older
  event as a no-op, not an error.
- Unknown provider event types are recorded and acknowledged, not
  dead-lettered.

### 3.3 Subscriptions

- Period-scoped key, e.g. `(subscriptionId, periodStart)`, with a unique
  constraint for any entitlement or invoice row.
- Subscription revenue is **not** provider withdrawable earnings. A
  subscription handler must not write to provider balances.
- A plan purchase never confers identity verification or work access. Those
  remain owned by the verification and work-access modules.

## 4. Observability contract for R23

Per event, the worker emits `outbox_events_processed_total{event_type,
outcome}`. `outcome` takes exactly these values: `processed`,
`skipped-duplicate`, `retried`, `dead`, `lease-lost`. It also emits
`outbox_event_duration_seconds{event_type}`. Queue gauges are
`outbox_queue_depth{status}` and `outbox_oldest_pending_age_seconds`;
reclaims are counted by `outbox_reclaimed_total`.

`event_type` cardinality equals the number of registered event names. Never
put ids, user data or error text in labels. Extra worker-health series are
requested in CR-05.

Structured log events: `outbox.processed`, `outbox.retry_scheduled`,
`outbox.dead_letter` (with `reason` = `permanent-error` |
`retry-budget-exhausted`), `outbox.lease_lost`, `outbox.no_handler`,
`outbox.reclaimed_stale`, `outbox.heartbeat_failed`,
`outbox.after_commit_failed`, `outbox.shutdown.released`,
`outbox.shutdown.grace_exceeded`, `outbox.tick.failed`.
