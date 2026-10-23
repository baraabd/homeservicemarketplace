# CR-004 — final manual review in the existing money transaction

## Current disposition — 2026-10-23

Atomic R24 participation and bounded durable retry are implemented. Actual R31 and R32 production integration remains pending. See `../RUNTIME_OWNERSHIP.json`, `../IMPLEMENTATION.md` and `../ACCEPTANCE.md`.

## Historical request (preserved)

The following source observation/request predates authorized runtime work. Its blocked/unapplied status is historical, not the current disposition above.

Status: **REQUESTED / UNAPPLIED / G2_BLOCKED**. Runtime: **NOT_IMPLEMENTED**.
Source inspected: `96e92825f9b65cf124317f43b55ce42fc97f5b49`; source tree:
`68f4e926eabeb37bb70382c62b75272cf67bd02c`. No runtime lease, participant,
production caller, worker or test implementation is created by this request.

## Verified current boundary

`apps/api/src/modules/money/ports/collection.port.ts` exposes
`MoneyReceiptAcceptancePort.accept(input, tx)` through
`MONEY_RECEIPT_ACCEPTANCE`. Its unavailable default fails closed. It accepts
server binding, intent/asset/owner/reviewer IDs and idempotency key and returns a
`NormalizedMoneyExternalEvent`.

`MoneyCommandService.acceptReceipt` in
`apps/api/src/modules/money/application/money-command.service.ts` invokes that
port in a command transaction, checks the normalized manual event, changes the
intent to PROCESSING and stores a RECEIVED inbox event. It does not activate the
subscription. `processExternalEvent` later opens a different command transaction
and performs binding/receipt and fresh reviewer checks as command prechecks. Its
execution then locks the intent and event, rechecks binding/receipt, calls
`SubscriptionActivationService.confirmAndActivate`, invokes the configured R31
activation participant, marks the event processed and records audit. The fresh
reviewer precheck currently precedes those execution locks. There is no final
R30 review callback in that second transaction.

Consequently, writing APPROVED, consuming a deposit or issuing a final notice
inside the first `accept(..., tx)` would commit those facts before payment,
ledger and activation. The existence of a transaction argument on `accept`
does not provide the requested cross-stage atomicity. Existing `requireReceipt`
checks restricted/CLEAN/uploaded/hash/owner/not-deleted/not-erasing, but does not
establish financial purpose or same-intent immutable receipt revision.

The current production source contains the definition of `processExternalEvent`
but no production call site; direct invocations are in tests. Persisting the
event alone therefore does not establish runtime completion or crash recovery.

## Exact shared paths requested

| Path                                                                   | Minimal semantic patch                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/money/ports/collection.port.ts`                  | Add the finalization method below to the existing receipt participant; update its unavailable default. Define narrow optional exact-version configuration lookup as described below.                                                                                                                                 |
| `apps/api/src/modules/money/application/money-command.service.ts`      | Invoke final manual review after locks/current checks and before existing activation, in the same transaction. Strengthen receipt association and exact-version policy checks without changing economic idempotency. Preserve R32's existing refund participant contract for its separately coordinated integration. |
| `apps/api/src/modules/money/application/money-command.service.spec.ts` | Update receipt doubles and verify finalizer ordering, unavailable handling, fresh checks, idempotency and rollback semantics.                                                                                                                                                                                        |
| `apps/api/test/integration/r24-money-api.integration.spec.ts`          | Update the test receipt participant and add real database rollback/race/replay coverage across review, existing financial writes and activation. Existing tests remain.                                                                                                                                              |
| `apps/api/src/modules/money/money.module.ts`                           | Wire reviewed manual providers through the existing tokens using one coordinator-owned composition boundary. Preserve unavailable defaults for unconfigured rails and all R29/R31/R32 tokens.                                                                                                                        |
| `apps/api/src/modules/money/money.module.spec.ts`                      | Assert default-off behavior, the existing R32 participant and the absence of provider replacement/duplicate-module DI errors.                                                                                                                                                                                        |
| `apps/api/test/e2e/app-module-di.e2e.spec.ts`                          | Verify the integrated real module can boot with defaults and approved test bindings; no production scanner substitute or missing provider.                                                                                                                                                                           |

These are proposed shared edits, not current ownership. No new ledger service,
payment confirmation API or second MoneyModule is requested.

## Proposed minimal port addition

The following is an unapplied contract proposal, not compiled source:

```ts
finalizeAcceptedEvent(
  input: { eventId: string; event: NormalizedMoneyExternalEvent },
  tx: PrismaTx,
): Promise<void>;
```

Add it to `MoneyReceiptAcceptancePort`; the unavailable implementation throws
the existing receipt-unavailable error. The R30 adapter resolves its immutable
candidate from the event identity, so the generic R24 wire does not need to
acquire mutable UI fields or free-text reviewer input. Initial `accept` freezes
only a pending candidate and validates its current preconditions; it does not
record final APPROVED, consume the final deposit claim or announce success.

For a MANUAL_REVIEW event, `processExternalEvent` calls this finalizer after
locking the intent and inbox event and reloading their authoritative state.
Recheck reviewer capability/status inside this locked execution path as well as
the existing command replay check. The finalizer uses the same `PrismaTx` and:

1. Locks the current review cursor and inspected receipt revision in a documented
   order consistent with replacement/rejection and all money operations.
2. Re-resolves the actor's active account and finance permission, denies self
   review, and enforces the approved separation/threshold policy. Missing policy
   cannot be replaced by a guessed default or an admin-role shortcut.
3. Checks the immutable financial purpose/intent association, current expected
   review version, actual inspected receipt revision and persisted scan/byte
   provenance, plus retention/erasure fences. A different receipt submitted
   after inspection makes the old decision conflict.
4. Checks the independently permitted deposit source, scoped canonical reference,
   exact server amount/currency, occurrence time, instruction version and
   approved expiry rule. Browser amount, receipt hash or uploaded screenshot is
   not settlement evidence.
5. Acquires the unique economic claim and appends the final approval plus a
   deduplicated private notice in this transaction. The original candidate
   remains an immutable historical fact. A candidate alone does not consume the
   final claim.

R24 then invokes its existing `confirmAndActivate` and R31
`MoneyActivationParticipantPort.activatePeriod(input, tx)`, and commits the
event/command result. Failure of review, claim, ledger, coupon, period, R31,
audit or notice/outbox writes rolls back every final fact. The previously
received candidate remains available for safe reconciliation/retry. No network
call, storage read or malware scan is permitted in this financial transaction;
those operations precede it, and immutable inspected provenance is revalidated
inside it.

Finalization is idempotent for a proven same candidate/economic confirmation,
including distinct valid deliveries. It must not duplicate a decision, claim,
period or notice. A different intent, revision or payload for the same identity
is a conflict. Preserve R24's scoped economic confirmation hash and its existing
reconciliation check for an activation replay lacking a committed matching R24
event. Never clear that check to make duplicate delivery succeed.

## Binding version and expiry integration

Keep `MoneyConfigurationPort.resolve({ planVersionId, method }, tx)` as the
new-purchase selection authority. Propose an optional additive lookup:

```ts
resolveBoundVersion?(
  binding: MoneyTransportBinding,
  tx: PrismaTx,
): Promise<MoneyBindingConfiguration | null>;
```

Only an approved manual provider implements that lookup against immutable
instruction versions and explicit acceptability/retirement policy. For a manual
bound obligation, use the exact lookup when available; otherwise retain the
current fail-closed equality behavior. Nonmanual configuration is unchanged.
Compare every returned binding field as today; never substitute a new recipient,
currency or account into an older obligation. Absence or revoked authorization
must fail closed. The optional method is a review proposal, not a claim that
older versions are currently supported or allowed forever.

Current `acceptReceipt` does not enforce the collection-start expiry check.
The candidate/finalizer must distinguish funds received on time but reviewed
later from late funds using approved policy. No guessed grace period, rewritten
intent expiry or silent payment to new instructions is permitted.

## Runtime caller and recovery proposal

The owned `manual-event-processing.job.ts` is the proposed bounded caller of
`MoneyCommandService.processExternalEvent`, registered through the same money
composition. It is absent today. Use the CR-002 current review cursor to durably
track pending inbox event ID, next attempt, attempts, lease token/expiry and
fenced completion. Claim work in a short transaction, run the existing financial
command transaction, and acknowledge/reconcile in a separate fenced operational
update. A crash after financial commit but before acknowledgement must recover
the committed result without another economic effect. A crash before commit
retains an eligible candidate; lease expiry does not prove payment failure.

Retry only transient failures with bounded backoff. Revoked reviewer rights,
replaced evidence, invalid policy or conflicting settlement require visible
reconciliation and a newly authorized decision where appropriate. They do not
become an infinite hot retry loop. Keep recovery leases separate from immutable
review history. The job does not grant a worker finance authority or invent a
new reviewer; it revalidates the recorded human actor.

Register the job from owned module providers using the existing runtime
composition; no standalone worker entrypoint or guessed environment variable is
included in this lease request. If a later implementation needs additional
central worker/env/CI wiring, the coordinator must first name and lease its
exact paths. Missing configuration keeps the manual method unavailable.

An alternative R22 outbox handler is not part of this proposal. If selected
later, the actual registration location is `apps/api/src/app.module.ts`, event
names are in `apps/api/src/infrastructure/outbox/outbox.tokens.ts`, and worker
tests are in `apps/api/src/infrastructure/outbox/outbox.worker.spec.ts`. Calling
a separately committing `processExternalEvent` from inside an outbox handler
does not make their transactions atomic; a caller-transaction contract would
need separate review. Those alternative paths have no requested runtime lease.

## Durable provider notices without new infrastructure

Reuse `NotificationsService.createForUser(input, tx)` from
`apps/api/src/modules/notifications/notifications.service.ts` and the existing
`NotificationsModule`. It writes a deduplicated notification plus
`notification.created` outbox row in the caller transaction and publishes after
commit. Final decisions use the final financial transaction; rejection and
replacement requests use their own review state-change transaction.

Keep notification content generic with an authenticated deep link. The precise
provider-visible reason is read from its authorized review projection; internal
notes, deposit references, receipt keys/bytes and private financial details do
not enter notification/outbox payloads. A new notification enum, outbox event or
handler is not required merely to reuse this existing mechanism.

## Manual refunds and the merged R32 authority

Preserve `apps/api/src/modules/money/ports/refund.port.ts` as merged. R30 implements
the existing `MoneyRefundAdapterPort.isConfigured`, `submit` and `query` methods
using their existing `MoneyRefundTransportCommand`/`MoneyRefundObservation`
types. Operator-reviewed dispatch records an action, not returned funds.
SUCCEEDED requires independently confirmed return evidence for the exact bound
refund/payment/amount/currency/account/operation. Definitive FAILED requires
evidence for that external operation. Timeout, expired lease or inconclusive
lookup remains UNKNOWN and keeps the reservation and provider key. Query an
uncertain operation before another approved external action; never invent a
new idempotency key to escape uncertainty.

The current source already defines and registers
`MONEY_REFUND_CONFIRMATION_PARTICIPANT`,
`MoneyRefundConfirmationParticipantPort.applyConfirmedRefund(input, tx)` and
`MoneyConfirmedRefund`. Its unavailable implementation is intentional.
`MoneyCommandService.recordRefundResult` currently performs local compensation
and terminal state updates but does **not** invoke that participant. R32/the
coordinator must integrate it only after authoritative SUCCEEDED evidence and
linked compensation, before committing local success. Its request/policy and
original obligation checks, consequences and refund-ID deduplication share the
same transaction; a participant failure rolls back local financial/consequence
state. R30 neither redefines this port nor creates refund eligibility, entitlement
policy, ledger posting or a second implementation of R32.

`MoneyModule` has single collection/refund tokens. The coordinator composes
reviewed R29/R30 bindings by trusted server adapter/mode/account configuration;
one lane must not overwrite the other token's provider. Preserve default-off
behavior, the R31 activation participant, R32 policy/confirmation participant and
published workspace imports. Do not introduce circular MoneyModule/R30 imports.

## Required evidence after integration

In the exact shared tests and the proposed R30 lifecycle/concurrency/refund
suites, verify permission revocation after stage one, account suspension,
self-review, stale inspected revision, wrong purpose/intent, missing independent
funds proof, duplicate scoped deposits across intents, double-review races,
instruction rotation, expiry distinctions and separate deliveries of one
confirmation. Inject failure after claim, ledger, R31 and notification/outbox
writes; assert no committed final decision/payment/period/notice survives.

Verify crash recovery before finalization and after commit-before-acknowledgement,
stale worker lease fencing, replay with fresh authorization and absence of
network/storage work inside the transaction. Refund tests must separate dispatch
from confirmation, preserve UNKNOWN, validate exact operation scope, and exercise
the R32 participant's rollback through coordinated integration. A direct test
call proves the command component only; real API/worker/storage/ClamAV evidence
is required for the full R30 journey. No such runtime checks were run here.

Rollback disables new manual availability/processing while preserving pending
events, immutable evidence, economic claims and posted history for authorized
reconciliation. There is no ledger rewrite, automatic reversal of an external
transfer, merge, deployment or live-rail activation in this request.
