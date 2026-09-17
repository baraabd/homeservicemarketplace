# ADR 12B — durable erasure with scoped proof, not a DELETE response

Status: **PROPOSED; not Product, Security or Privacy approval.**
Scope: finalized restricted KYC evidence. This amends the _implementation claims_
of ADR 0012; it does not retroactively approve that ADR's durations or permanence.

## Baseline and authority

12A head `7b739705322887d3b404a38aa37ac29f00f2dc37` has green CI/CodeQL.
`EvidenceCleanupService` only handles expired _unfinalized_ preparations. It
is not proof that finalized identity evidence is erased. `retainUntil` existed
without a reliable production lifecycle. The restricted port's ordinary
`deleteObject` could not prove removal of S3 versions. Local `head` incorrectly
converted all filesystem errors to absence.

## Decision

A separate `dist/evidence-retention.worker.js` process uses a durable PostgreSQL
job table, not an API-process cron. Mode defaults off; the deployment example
defaults shadow. No HTTP endpoint can enqueue a deletion. Shadow is read-only.
An explicit policy approval reference and a separate infrastructure inventory
reference are mandatory to enter enforce mode. These strings are operational
cross-references, **not proof that someone approved anything**.

Each job pins a validated, content-hashed retention policy snapshot and the
case's requirement-policy version, immutable decision timestamp (or last real
DRAFT activity), due date and intent. Environment changes do not re-date queued
work. Quarantine can lengthen, not shorten, the applicable window. Live review
states are not "abandoned". Missing/corrupt sources are surfaced for review;
missing canonical links on a claimed job dead-letter without clearing its
access deadline.

Planning takes case -> asset locks. Claims use bounded `SKIP LOCKED`, one at a
time, expiring random lease tokens and attempt counts that include crashes.
Beginning rechecks the pinned basis, deadline and hold under case -> asset ->
job locks. A resumed draft cancels an _unstarted_ plan. Once the durable
`erasureStartedAt` fence is committed it is irreversible: a storage operation
may already have succeeded, so retries complete instead of re-exposing bytes.
KYC submission, upload preparation/finalization and decisions coordinate on
the same case row. New reads and approval reject expired/fenced evidence. A
late scan result cannot write across the fence.

The storage operation is outside DB transactions. `eraseObject` is stronger
than compensation `deleteObject`: unsupported adapters fail closed. Local
storage checks actual absence and propagates operational errors. S3 deletes
exact-key versions and delete markers with bounded work and a timeout, never
prefix-neighbour keys or object-lock/governance bypass. It then verifies empty
version inventory plus current-object absence. Permission errors and partial
inventory are failures, not erasure.

A successful **scoped** receipt permits one fenced DB transaction to mark the
job complete, tombstone the asset key, scrub display/owner/scanner/pending
metadata, clear private case notes once appropriate, append a structured audit
and enqueue `evidence.erased.v1`. Rollback leaves the earlier fence and job
retryable; the next attempt re-verifies storage absence. A registered idempotent
Outbox consumer checks the completed receipt and never erases a second time.

Original decisions and work-access grants are not destroyed or revoked by this
worker. Scan history and decision history are distinct from current availability.
A new additive server-authored `retentionState` lets both Admin surfaces explain
EXPIRED / ERASING / ERASED in EN/AR without computing authority in the browser.
"In progress" is never labelled "deleted".

## Deliberate minimization change needing approval

ADR 0012 proposed indefinite checksums and decision records. A checksum can be
linkable personal data; absence of document bytes does not make all remaining
metadata anonymous. This implementation defaults `retainChecksum=false` and
makes an approved exception explicit in the immutable job snapshot. It does
not claim an unlimited legal basis to retain decisions or identifiers.
Account erasure/pseudonymisation and the existing provider->case cascade still
need separate authority, policy and lifecycle work.

## Proof boundary and remaining blockers

`PRIMARY_OBJECT_AND_VERSIONS` means only that the configured primary evidence
store and that exact key's versions are absent. It is **not** proof of erased
replicas, backups, application scratch files, a previously opened browser or
physical disk sectors. The deployment must inventory those copies and define
independently verified expiry before enforce approval. The existing upload
pipeline's unfinalized/crash-staging lifecycle is not closed by this worker.
No new restricted derivatives are introduced; any future thumbnail/redaction
pipeline must register all derivatives and extend the erasure contract first.

Authorized hold/requeue administration, user-requested account erasure,
independent policy publication, operator ownership and external privacy signoff
are still gates. Direct edits to jobs are not a public control API. Enforce is
not enabled by this PR and the sprint remains open.

## Validation

See `retention/RUNBOOK.md` and the exact-head PR evidence. Local mocks prove
ordering and failure branches, not storage deletion. The separate required CI
job runs real PostgreSQL, filesystem, a versioned S3-compatible store and real
ClamAV, including a standalone worker process, metrics and SIGTERM. Only actual
run results count; adding this job is not a passing result.
