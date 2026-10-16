# G1 rollout and rollback contract

Review instructions only; no deployment is authorized or performed.

## Avatar write-once coordination

Release the web client that sends `If-None-Match: *` first. Verify requests carry
that header and allow it in the selected storage CORS policy. Then release the
API that signs it for avatar keys. Keep the unchanged key, size, MIME and finalize
authority checks. A 412 is an unsuccessful upload and must never be finalized.
Do not rewrite or delete a finalized object to make a retry succeed; start a new
upload with a newly minted key.

Rollback the enforcing API first, then the web client if needed. Leaving the
extra client precondition in place is safe. Old web builds or service-worker
caches that omit the signed header may fail new avatar uploads; verify the
frontend-first transition before any hosted rollout. Private portfolio and
request upload clients already send the precondition.

## Database and permissions

Take the approved backup and inspect migration preflight results before any
hosted rollout. The additive enum and nullable unique notification dedupe key
are backward compatible with older application readers. Keep them when rolling
back application binaries. Do not delete audit history, financial history or
notification dedupe keys. The strengthened refund trigger is forward-only:
a rejected historical compensation requires owner reconciliation, not automatic
rewriting, disabling the guard or editing an applied migration.

No role receives `outbox:replay` from seed. Registration alone cannot execute a
replay. A future emergency grant/revoke remains a separately reviewed operation.

## Telemetry and workers

Remove the collector endpoint and headers and retain sample ratio zero to
stop export; API operation and protected metrics continue. Revert scheduler/
instrumentation source through a reviewed PR if necessary. Do not disable the
outbox to hide failures: pending work must remain observable and recoverable.
Existing worker modes and claim fences are unchanged. Use graceful shutdown;
crash recovery remains lease-based and is verified with independent processes.

## CI and gate

Temporary service infrastructure and test credentials disappear with the CI
runner. Failure of a newly activated required scenario blocks acceptance; do
not undo its gate or reintroduce a skip. Keep G1 BLOCKED and R26 closed until the
corrective result and the separate accepted record meet the publication rule.
