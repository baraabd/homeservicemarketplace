# R36 — Rollback boundaries; rehearsal not executed

This PR changes documentation only. Revert its documentation commit through a
reviewed PR if required. There is no runtime rollout to undo, and reverting
the report does not remove the observed G3/hosting blockers.

## Application rollback after separate authorization

Do not treat `staging.cjs --apply` with an old release file as an application-
only rollback: the current implementation always runs `api-migrate`. The
existing R18 instruction conflict is reported in CR-001. No operational
rollback command is issued here.

A later authorized rehearsal must bind the prior accepted immutable API/web
digests to the actual forward schema and accepted source, keep the current
migration lineage intact, and prove compatible startup, login, private-media
authorization and safe replay through useful service. Record every image,
resource, configuration fingerprint and timeline point. Mere readiness is not
compatibility evidence. The migrator digest remains part of recovery lineage,
but an older migrator must not run as a side effect of application rollback.

## Three separate operations

- Application rollback changes accepted executable images against a compatible
  forward schema. It does not undo financial facts.
- A financial correction uses the existing authorized refund/reversal domain
  flow, immutable linked history and unchanged idempotency identities. Restoring
  a database or rewriting a ledger is not a refund.
- Point-in-time recovery restores an independently authorized isolated target.
  Reconcile known external outcomes, access revocations and deletion/hold state
  before any separately approved cutover. Never reconnect a restored outbox to
  real recipients or money rails merely because the database is healthy.

## Operator stop conditions

Stop on partial deployment, failed migration, unavailable object storage,
expired credentials, missing required object versions, inaccessible keys,
failed integrity checks, unproved isolation or unknown external money outcome.
Keep outbound effects disabled; preserve immutable evidence and incident IDs.
Inspect current images, migration history, restore point, job leases and known
external references using least-privilege read access. The incident commander
assigns database, storage/key, money and mail owners to a reviewed repair plan.

There is no autonomous rollback, payment retry, credential workaround or
cutover. Never run `migrate reset`, drop applied finance tables, edit posted
ledger history, flush shared Redis or remove shared volumes as an operational
rollback. Achieved RPO/RTO and authorized cutover identities remain unmeasured
and unassigned until the real drill occurs.
