# R32 — Compatible rollback and recovery

No deployment is performed by this sprint. The following procedure is for an
authorized operator/coordinator after integration; it is not approval to change
production, revoke grants or stop shared services now.

## Stop new work without destroying evidence

1. Record the deployed source/image identity and inventory active refund IDs,
   payment scopes, statuses, held capacity, unresolved exceptions and outbox
   lag through the authorized redacted interfaces. Keep restricted provider
   proof in its existing access-controlled store, not a ticket or public log.
2. Quiesce new refund requests/reservations and review execution through the
   existing authorized deployment/traffic controls. An unavailable policy
   source blocks new reservations. Do not manufacture a policy to clear a queue.
3. Stop automatic delivery in all affected replicas using existing worker
   controls. `OUTBOX_WORKER_ENABLED=false` stops the domain scan and R22 worker,
   and also affects other outbox consumers; assess that shared impact first.
   It does not disable an authorized HTTP dispatch call. There is no separate
   R32-only environment flag in this change.
4. Let active requests reach their bounded deadline and inspect durable state.
   Lease expiration alone proves neither failure nor absence of a payment.

## Preserve financial compatibility

Retain MoneyRefund/Request, MoneyDispatch, provider idempotency keys, immutable
MoneyCommand records, validated observations, reconciliation exceptions, audit,
outbox and posted ledger history. No database rollback, row deletion, capacity
release, status rewrite or compensating full REVERSAL is prescribed.

A timeout or unknown operation must be queried using its original provider
identity. A stored authoritative terminal observation can complete locally
through the compatible confirmation participant and captured policy version.
If a reversal/exception blocks compensation, keep its proof and held reservation
for reconciliation. A request or local ledger entry is not rail payment proof.

Do not restore an older submit-on-retry implementation while unresolved refunds
exist. Although R32 adds no schema migration, protocol compatibility matters.
Retain a compatible recovery build or reconcile/quiesce every in-flight record
before an authorized source/image rollback. Restoring a database snapshot over
newer payment outcomes can lose the only durable operation identity and is not
an acceptable code rollback.

## Verify an authorized rollback

Verify current permissions, strict operator scope/revision, no unexpected
outbound submission, unchanged reservation totals, durable terminal evidence,
exactly one linked compensation and consequence, immutable original postings,
and correct exception/audit/outbox state. Run the real R24/R32 regression and
the assembled adapter tests on the proposed compatible build. Check readiness,
outbox lag and recovery diagnostics before restoring traffic.

Use the CLI in inspect-only or default dry-run mode first. Explicit execution
requires the scoped approval reference and stable command request/key. A lost
client response is ambiguous; retry the same accepted request or inspect its
state before authorizing a new command. Never rotate the provider key to make a
retry look new.

The source rollback unit is the R32 implementation/composition commit plus any
corrective source commits. Historical G2 acceptance/publication records should
remain truthful. A coordinator must review reverting central registry records
separately; do not restore a false G2 publication hold as a side effect.
