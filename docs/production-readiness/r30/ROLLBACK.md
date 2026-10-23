# R30 — containment, recovery and rollback

## Scope and preserved authority

This runbook describes the current sandbox implementation. It is not evidence
of a production deployment, a completed recovery rehearsal or an authorized
live operation. Use `ACCEPTANCE.md` for checks actually executed against the
candidate. Actual grants, merchant changes, deployment and live funds retain
their separate owner authority.

Keep the accepted G2 runtime source
`72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`, tree
`43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`, distinct from its owner-merged
publication `986b4707776711e80564f0642133ede90ba16f3c`. PR #183 resolved the
publication barrier; rolling back R30 source must not erase that fact, undo
the inherited R28/G2 repairs or alter another lane's ownership. Continue the
same R30 branch/PR with reviewed corrective commits and the exact writer leases.

## Contain new work and retain evidence

1. Identify the exact candidate, affected instruction version, payment intent,
   review/decision, receipt revision and event or refund operation. Preserve
   safe identifiers, current statuses and error codes. Keep receipt bytes,
   merchant references, notes, credentials and session traces out of public
   logs and PR artifacts.
2. For an affected method, the existing version's `enabled` flag can be set
   false through the authorized configuration path. Other instruction fields
   are immutable; changed instructions require a new version. Disabling the
   version stops its availability checks for new work and existing operations
   that require that binding. It does not cancel an obligation, mark money
   returned or erase history. Authenticated receipt reads remain subject to
   their own fresh authorization and CLEAN/not-erasing checks.
3. If necessary, coordinate a pause of the affected application runtime. The
   R30 worker uses the shared `OUTBOX_WORKER_ENABLED` setting, which also affects
   other workers; it is not a payment-specific switch. Decision and explicit
   retry requests can invoke processing directly, so pausing only the scheduled
   worker does not disable every caller. Do not change a shared environment or
   kill another session's process to contain a disposable test failure.
4. Preserve instruction versions, receipt metadata and stored bytes, immutable
   decisions/inspections, settlement claims, command and event identities,
   notification/outbox records, confirmations, ledger entries, periods and
   refund observations. A pending candidate is not a completed payment. Never
   repair status by manually setting APPROVED, SUCCEEDED, CLEAN or PROCESSED.

## Recover a pending manual confirmation

The approved candidate is an immutable `PENDING_APPROVAL` decision. Its review
cursor remains CONFIRMING while the worker calls the existing R24 acceptance
and processing commands. Final review, the unique settlement claim, financial
confirmation, ledger posting, activation participation and private notice must
commit in the authoritative transaction. A failing participant leaves the
candidate available without manufacturing financial success.

Use the authenticated admin detail at
`GET /v1/money/manual/review/intents/:id` to inspect the safe processing
projection. It reports the reason, attempt count, reconciliation requirement
and whether the current actor may retry. Provider projections do not expose
internal notes or operational reconciliation details.

The current worker immediately halts automatic processing for permanent
authorization, not-found, validation or conflict errors. Other failures use
bounded backoff and a configured budget of eight failed automatic attempts.
When `reconciliationRequired` is true, the worker no longer selects that cursor;
`lastErrorCode` retains a safe reason and `nextAttemptAt` is cleared. Resolve the
underlying condition before requesting another attempt.

The explicit retry request is:

```text
POST /v1/money/manual/review/intents/:id/retry
Authenticated original reviewer; CSRF protection; Idempotency-Key
Body: { "expectedVersion": <current review version> }
```

This path checks fresh `money:receipt:review` and `money:receipt:view`
permissions, an active admin role, the original reviewer identity, current
review version, current CLEAN submitted receipt and matching inspection,
unexpired eligible obligation, enabled bound instructions and independently
permitted matching settlement. It resets only operational retry fields. It
does not rewrite the decision, select another settlement, change payment
amounts or create a new external-payment identity. R24 processing continues
under the original deterministic acceptance/event keys.

If the reviewer's permission was revoked, only that same reviewer can resume
this candidate after the relevant grant is legitimately restored and all other
checks still pass. This runbook grants no permission itself. The settlement
recorder's current authority must also pass validation. A replacement reviewer
cannot take over by changing `reviewerUserId`, inspection ownership or the
decision. There is no reassignment path in the current implementation.

Expired obligations/instructions, a consumed deposit, invalid or erased
evidence, and permanently unavailable reviewer authority may remain blocked.
Preserve that state for approved reconciliation. Do not extend dates, clear
claims, replace receipt hashes, edit command responses or repeatedly reset the
retry counter to bypass those conditions. The missing R31 production
participant must be integrated by its owner; a test component must never be
installed as operational activation authority.

## Recover receipt upload and scanning

Receipt reservations use a new immutable financial asset version for each
replacement. Stored objects use conditional first-write semantics, and a
retry may recover the same bytes after a write-before-metadata interruption.
A submitted or historical approved receipt is not overwritten. Preserve the
predecessor chain and the exact intent association.

Restore the actual private storage or ClamAV service when a scan fails. The
scan retry path considers the current eligible unsubmitted revision and
rechecks its owner, configuration and actual bytes. PENDING or SCAN_FAILED is
not CLEAN; an unavailable or deterministic test scanner cannot establish
finance evidence. QUARANTINED and REJECTED are terminal evidence states, and
their bytes/history must not be rewritten to make submission succeed.

For a correction request, the provider uploads and submits a newly reserved
revision. The previous revision and provider-visible reason remain in history.
A successful receipt read records an inspection for those bytes; a stale
inspection is not authority to approve a different revision. Missing,
truncated or altered storage is a reconciliation condition, not permission to
edit the recorded hash or size.

## Recover manual-refund observations

Keep the existing R24/R32 refund reservation, `providerIdempotencyKey`, binding
and any recorded `externalOperationId`. R30's PENDING operator task and UNKNOWN
dispatch state are not money returned. Query an uncertain operation before any
new external action; do not mint another provider key to escape ambiguity.

An independently permitted operator records authoritative bound SUCCEEDED or
definitive FAILED evidence through the manual transport workflow. The
dispatcher cannot confirm their own operation. The current implementation
accepts only explicitly labeled sandbox operator simulation; it supplies no
vendor API or live settlement proof.

If final evidence exists but configuration or a downstream participant blocks
completion, retain the observation and reservation for reconciliation. Do not
rewrite an immutable terminal outcome or treat an unrun lookup as absence.
R32 owns production eligibility, refund consequences and the required
confirmation-participant integration. A local compensating ledger entry never
proves an external transfer; compensation and external settlement remain
separate facts.

## Roll forward or revert compatible source

Prefer a reviewed corrective source change that preserves existing records.
The R30 migration is additive and introduces constraints protecting financial
history. Do not drop its tables, remove immutability/claim guards, reset the
database, flush Redis, delete volumes or rewrite posted ledger entries as a
rollback mechanism.

If application source must be reverted, retain a compatible version of the
financial-purpose isolation in identity scan, cleanup and retention workers.
A pre-R30 binary that treats every restricted asset as identity evidence is
not a safe rollback once financial receipts exist. Verify compatibility of
the selected binary, schema and stored events before any separately authorized
deployment. Keep unavailable methods disabled until the repaired source and
its integration evidence are reviewed.

The financial evidence lifecycle has no erasure worker here. Retention dates
do not authorize ad hoc object deletion or establish backup/replica erasure.
Preserve evidence and holds while finance/privacy/storage owners define and
implement the approved lifecycle. Do not route financial receipts through
identity erasure, public media or portfolio code as a workaround.

## Verify recovery and close disposable infrastructure

Record the candidate SHA/tree and exact checks used to establish recovery.
Relevant verification includes failed-transaction rollback, duplicate and
concurrent review exclusion, fresh permission revocation, retry exhaustion,
cross-provider isolation, replacement/relogin persistence, real private bytes
and scanner outcomes, and the actual browser journey. Final-head CI and
CodeQL remain separate evidence. Do not infer a pass from service health or
from an earlier G2 result, and do not weaken assertions or global budgets.

After the coordinator finishes the authorized tests, stop only the recorded
task-owned PostgreSQL, Redis and ClamAV processes. Their service-state record
and scoped shutdown helper are under `/tmp/hsm-r30-590834-runtime`; the helper
checks process executable identities. The task's browser distributions are
under `/tmp/hsm-r30-590834-playwright` and use isolated temporary contexts.
Do not stop sibling services, erase shared caches or reuse another session's
database/profile. Preserve sanitized evidence needed for the final review;
private environment files and credentials never enter Git.
