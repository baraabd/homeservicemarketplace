# R16 — Withdrawal state machine (design draft, not implemented)

Status: **DESIGN DRAFT under R16_POLICY_BLOCKED.** Nothing here is implemented,
migrated or routed. The rail-dependent parts are marked _[rail]_ and cannot be
finalized until `PAYOUT_POLICY.md` P3/P14/P15 are confirmed.

The purpose is to fix the safety properties now, so that whichever model the
owner approves is implemented against them rather than against a happy path.

## Separated concepts

A single enum must not conflate these facts:

| Concept                     | Owner of the fact                           | Represented by                                                 |
| --------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| Request accepted locally    | HSM API, inside one DB transaction          | `Withdrawal` row + idempotency record                          |
| Funds reserved              | HSM ledger                                  | reservation posting (see § Reservation) committed with the row |
| Submission scheduled        | HSM outbox                                  | outbox row committed with the withdrawal                       |
| External outcome unresolved | HSM worker                                  | `PayoutAttempt` with no definitive provider answer             |
| Externally pending          | Provider, via verified response/callback    | attempt state + provider reference                             |
| Settlement verified         | Provider evidence _[rail]_ + reconciliation | settlement posting                                             |
| Definitive failure          | Provider evidence _[rail]_                  | release posting, exactly once                                  |
| Approved cancellation       | Authorized actor before submission          | release posting, exactly once                                  |
| Returned after settlement   | Provider evidence _[rail]_                  | new return transaction (not a reversal of a reversal)          |

## Proposed logical states (`Withdrawal.status`)

```
REQUESTED ──▶ SUBMITTING ──▶ PENDING_EXTERNAL ──▶ SETTLED ──▶ (RETURNED)
    │             │                 │
    │             ├──▶ OUTCOME_UNKNOWN ──▶ PENDING_EXTERNAL | SETTLED | FAILED
    │             │                         (only via lookup / reconciliation)
    ▼             ▼                 ▼
 CANCELLED      FAILED            FAILED
```

`REQUESTED` already implies "funds reserved" and "submission scheduled" because
the row, the reservation and the outbox intent commit atomically; there is no
reachable state where one exists without the others.

If the owner approves a manual-approval step (P13), an `AWAITING_APPROVAL`
state is inserted before `SUBMITTING`; funds are reserved from `REQUESTED`
onwards either way.

## Transition table

| From → To                                                | Actor                                        | Preconditions                                                                                                                                  | Idempotency identity                                                           | Ledger / reservation effect                                                                                       | External evidence                 | Audit                        | Retry / reconciliation                                                                                                                |
| -------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| ∅ → REQUESTED                                            | Authenticated provider (fresh authorization) | eligible amount ≥ request under the account lock; currency supported; limits; verified destination version owned by the actor; feature enabled | `(actorId, idempotencyKey)` + digest of amount, currency, destinationVersionId | reserve: provider payable → payout reserve (one balanced posting)                                                 | none                              | `WITHDRAWAL_REQUESTED`       | same key + same digest → original result; different digest → 409                                                                      |
| REQUESTED → CANCELLED                                    | Provider or authorized admin                 | no attempt dispatched                                                                                                                          | withdrawal id + cancel command key                                             | release: reserve → payable (exactly once)                                                                         | none                              | `WITHDRAWAL_CANCELLED`       | conditional update on `status = REQUESTED`                                                                                            |
| REQUESTED → SUBMITTING                                   | Worker (single claim/lease)                  | outbox row claimed; feature + provider config present                                                                                          | stable external idempotency id derived from withdrawal id                      | none                                                                                                              | none yet                          | attempt record               | lease expiry → another worker resumes with the **same** external id                                                                   |
| SUBMITTING → PENDING_EXTERNAL                            | Worker / verified callback                   | provider acknowledged with a reference                                                                                                         | provider reference unique                                                      | none                                                                                                              | provider acknowledgement _[rail]_ | `WITHDRAWAL_SUBMITTED`       | —                                                                                                                                     |
| SUBMITTING → OUTCOME_UNKNOWN                             | Worker                                       | timeout, dropped response, crash after send                                                                                                    | same external id                                                               | **none — funds stay reserved**                                                                                    | absence of evidence               | `WITHDRAWAL_OUTCOME_UNKNOWN` | resolve only by provider lookup or dedup-safe resubmit with the same id _[rail]_; otherwise stop and raise a reconciliation exception |
| PENDING_EXTERNAL / OUTCOME_UNKNOWN → SETTLED             | Verified callback or reconciliation          | signature, account, environment, reference, amount, currency all match                                                                         | provider event id unique (inbox)                                               | settle: reserve → payout clearing                                                                                 | rail-documented finality _[rail]_ | `WITHDRAWAL_SETTLED`         | duplicate/late events are no-ops                                                                                                      |
| SUBMITTING / PENDING_EXTERNAL / OUTCOME_UNKNOWN → FAILED | Verified callback or reconciliation          | rail-documented **definitive** failure _[rail]_                                                                                                | provider event id unique                                                       | release: reserve → payable (exactly once)                                                                         | definitive failure evidence       | `WITHDRAWAL_FAILED`          | contradictory terminal events → exception, no second effect                                                                           |
| SETTLED → RETURNED                                       | Verified callback or reconciliation          | rail supports returns _[rail]_                                                                                                                 | provider event id unique                                                       | new `return` transaction clearing → payable; **not** a reversal of the settlement (R15 forbids chained reversals) | return evidence                   | `WITHDRAWAL_RETURNED`        | blocked until approved accounting semantics (P7/P14)                                                                                  |

Forbidden transitions fail closed: no client may set `SETTLED`, `FAILED`,
`RETURNED`, or supply a provider reference; terminal states are never reset by
a replay; `OUTCOME_UNKNOWN` never times out into `FAILED`.

## Reservation and concurrency (design)

- **Boundary:** a per-(provider, currency) row lock — `SELECT … FOR UPDATE` on
  the provider payable `LedgerAccount` row — taken at the start of every command
  that spends the same funds (withdrawal request, cancel/release, any future
  debit). The eligible amount is recomputed from `POSTED` entries **after** the
  lock is held. A plain read-check-insert is not sufficient.
- **Lock order:** provider payable account → payout reserve account → withdrawal
  row. All writers use this order.
- **Retries:** serialization/deadlock errors propagate out of the enclosing
  transaction; the owner retries the whole idempotent unit a bounded number of
  times and surfaces a domain error, never a silent success.
- **Atomicity:** withdrawal row, idempotency record, reservation posting (via
  `LedgerService.post(…, tx)` — R15's caller-owned transaction), audit row and
  outbox intent commit together or not at all. No external call happens inside
  the transaction; dispatch starts only after commit.
- **No double counting:** eligible = credit balance of payable; reserved =
  balance of reserve; neither is derived from withdrawal-row sums.

### Gaps in the reusable infrastructure (verified on `cc41787`)

| Need                                   | Current state                                                                                                                                                    | Required change when policy exists                                                                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spendable-balance guard                | `LedgerService.post` takes no lock and checks no balance; nothing prevents an account going negative (`ledger.service.ts`, R15 tests prove sums, not overdraft). | Withdrawal service takes the payable account row lock (`SELECT … FOR UPDATE`; the `LedgerAccount_immutable` trigger fires on `UPDATE` only, so a lock is permitted) before computing and posting. |
| Balance read inside caller transaction | `LedgerRepository.balance(accountId)` has no `tx` parameter.                                                                                                     | Add an optional `tx` to the repository read (additive; R15 behavior unchanged).                                                                                                                   |
| Bounded retry on P2034 / deadlock      | `TransactionRunner.run` does not retry; P2034 maps to HTTP 409.                                                                                                  | Bounded retry of the whole idempotent unit in the withdrawal service, or an opt-in runner option.                                                                                                 |
| Outbox dispatch                        | `OutboxEvent` with `dedupeKey`, `FOR UPDATE SKIP LOCKED` claim, `reclaimStale` lease, exponential backoff, `DEAD` after `maxAttempts`.                           | Reuse. An outbox retry is a transport retry; it must reuse the attempt's external id and must not `markFailed → DEAD` into a money release.                                                       |
| Webhook inbox                          | None exists.                                                                                                                                                     | New `PaymentProviderEvent` (provider, account, environment, event id unique) — only once a rail with callbacks is selected.                                                                       |
| Fresh permission for `ledger:`         | `PermissionsGuard` reads fresh only for `verification:`, `portfolio:`, `support:` and `user:read:any`.                                                           | Withdrawal/admin payout permissions must be added to the fresh-read list.                                                                                                                         |
| Step-up / recent authentication        | No convention exists.                                                                                                                                            | Owner decision (P11/P12); must not be invented.                                                                                                                                                   |
| Audit identifiers                      | `ALLOWED_METADATA_KEYS` silently drops unknown keys.                                                                                                             | Add `withdrawalId`, `payoutAttemptId` (identifiers only) and extend `merge-integrity.test.mjs`.                                                                                                   |

A reservation posting is an accounting event and still needs approval (P7).

## Idempotency (design)

- Logical identity: `(actorId, idempotencyKey)` unique; digest covers actor,
  amount (decimal string of minor units), currency and destination version.
- Transport identity: `PayoutAttempt` rows; the external idempotency id is
  derived from the withdrawal id, never regenerated after a lost response.
- Another actor's key returns 409 with no disclosure (R15 convention).
- Nothing is deduplicated by amount, text or time window.

## Proof obligations (test design, not yet runnable)

Each must be executed against real PostgreSQL once a policy exists:

1. N concurrent requests with different keys never reserve more than the
   eligible amount (bounded concurrency, direct DB sum assertion).
2. Same key, concurrent → one withdrawal, one reservation, one audit, one outbox row.
3. Same key, changed amount/currency/destination → 409, nothing written.
4. Failed audit write → no withdrawal, no reservation, no outbox (caller-owned rollback).
5. Crash after commit, before dispatch → worker dispatches once.
6. Crash after provider acceptance, before reference stored → same external id on retry; at most one provider transfer in the harness.
7. Lost response → `OUTCOME_UNKNOWN`, funds stay reserved.
8. Duplicate / out-of-order / contradictory events → at most one settle or release posting.
9. Definitive failure → release exactly once, also when reconciliation re-runs.
10. Destination edit during processing → payout stays bound to the original version.
11. Permission or session revoked between request and read-back → denied, no disclosure.
12. Upgrade from `cc41787` schema with existing ledger rows → preserved, no backfill.
