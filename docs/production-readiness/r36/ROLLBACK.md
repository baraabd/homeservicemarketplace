# R36 — Rollback boundaries; rehearsal not executed

## This documentation follow-up

Revert only the seven-file documentation diff through a reviewed PR if needed.
Do not revert the owner-merged G3 source or shared dependency repairs brought
in by the inspection branch's fast-forward. There is no runtime rollout to
undo; reverting this report does not resolve the observed blockers.

## Application rollback after separate authorization

Do not use `staging.cjs --apply` with an old release file as an application-only
rollback: it always invokes `api-migrate`. Both R18 and R28 instruction conflicts
are covered by [CR-001](shared-change-requests/CR-001-integration.md). No
unimplemented flag or operational rollback command is advertised here.

A later rehearsal must bind prior accepted immutable API/web digests and their
source to the actual forward schema, keep migration lineage intact, and prove
compatible useful service: real login, role/permission checks, authorized and
denied private previews, financial reads/allowed transitions and isolated job
replay. In particular, the G3 migration replaces the reconciliation exception
guard; test legacy and provenance-backed cases with the old executable.

The migrator digest belongs in recovery lineage but must not be executed as a
side effect of image rollback. Verify zero migrator invocation and unchanged
schema history. Readiness alone is not compatibility evidence.

## Three different operations

- Application rollback changes accepted executable images against a compatible
  forward schema. It does not undo financial facts.
- Financial correction uses authorized refund/reversal commands, immutable
  linked history and original idempotency identities. Restoring a database or
  rewriting a ledger is not a refund.
- Point-in-time recovery restores an independently authorized isolated target.
  Reconcile external outcomes, post-snapshot access revocations and
  deletion/hold state before a separately approved cutover.

## Operator stop conditions and repair ownership

| Stop condition                                               | Current-state inspection and owner                                                                                                                                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Partial image replacement or failed migration                | Release/database owners inspect actual digests, applied migration history, failed phase and cooperative lock. Retain evidence; review a forward repair or separately authorized compatible image rollback. |
| Missing version, wrong namespace or unavailable object store | Storage owner compares protected inventory/version mapping and checksums. Keep target sealed; recover the correct authorized version or record irrecoverable loss.                                         |
| Missing/wrong KMS or mail-envelope key; expired credentials  | Key/credential operator verifies protected version and validity references. Do not substitute plaintext, broaden grants or treat undecryptable work as recovered.                                          |
| Unknown payment/refund or ambiguous accepted-mail outcome    | Money/mail operators retain original provider/message identities and independent observations. No automatic retry, replacement operation key, reservation release or real-recipient replay.                |
| Ledger/dedupe/history, permission or erased-media mismatch   | Database/privacy/identity owners compare the approved snapshot and later deletion/revocation facts. Keep egress and user access closed pending a reviewed repair.                                          |
| Isolation or useful-service verification fails               | Incident commander keeps the isolated target disconnected and assigns a bounded repair. A healthy DB alone cannot authorize cutover.                                                                       |

Record the incident, owner, actual state and repair approval before resuming.
Disable Outbox and mail schedulers, deny real payment/refund/SMTP egress and
isolate webhook ingestion; remember that direct and immediate mail paths
also need transport/network isolation. Preserve protected key versions for
only the approved retention/rollback window.

Never run `migrate reset`, drop applied finance tables, edit posted ledger
history, flush shared Redis or delete shared volumes as operational rollback.
No autonomous rollback/retry is allowed while external money outcome is
unknown. Achieved RPO/RTO, actual effect counts and cutover resource identities
remain **NOT MEASURED / UNASSIGNED** until the authorized real drill.
