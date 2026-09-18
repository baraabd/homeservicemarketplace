# Finalized KYC evidence retention — operator runbook

## Non-negotiable rollout boundary

Not deployed or activated by the PR. No production evidence is used in tests.
This is a 12B slice, **not Sprint 12 completion**. Start only after reviewing
ADR-12B, the immutable policy, all storage copies and release approvals.
Do not run a migration or deletion against a populated database without an
authorized maintenance plan. Forward migrations are additive; rollback uses
old application code with the new columns/tables intact, not schema deletion.

## Process and configuration

The same built non-root API runtime image includes:

```text
node dist/evidence-retention.worker.js
```

It does not import AppModule, run HTTP business routes or require IAM signing
keys, mail or payment credentials. `docker-compose.evidence-retention.yml` is
an opt-in standalone **S3** example; set an immutable tested image digest and
an existing private service network. It publishes no host ports and has a
separate readiness probe. Inject configuration through your approved secret
manager / a nontracked, permission-restricted environment file. Do not paste
secrets into source, shell history, tickets or reports.

| Setting                                        | Meaning                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| DATABASE_URL                                   | The dedicated least-privilege worker DB identity.                                      |
| EVIDENCE_RETENTION_MODE                        | `off` (code default), `shadow`, or explicitly approved `enforce`.                      |
| EVIDENCE_RETENTION_APPROVAL_REF                | Non-sensitive policy review/ticket reference, required for enforce.                    |
| EVIDENCE_RETENTION_INFRA_REF                   | Non-sensitive storage/replica/backup inventory review reference, required for enforce. |
| EVIDENCE_RETAIN_VERIFIED_DAYS                  | Default 90; engineering default, not a legal rule.                                     |
| EVIDENCE_RETAIN_REJECTED_DAYS                  | Default 30; same approval requirement.                                                 |
| EVIDENCE_RETAIN_ABANDONED_DAYS                 | Default 30 for finalized evidence in DRAFT only.                                       |
| EVIDENCE_RETAIN_QUARANTINE_DAYS                | Default 180; cannot shorten normal retention.                                          |
| EVIDENCE_RETENTION_KEEP_CHECKSUM               | Default `false`; an explicit approved exception is pinned per job.                     |
| EVIDENCE_RETENTION_MAX_ATTEMPTS                | 1–20, default 5; crashes consume attempts.                                             |
| EVIDENCE_RETENTION_BATCH                       | 1–100, default 25; one claim at a time.                                                |
| EVIDENCE_RETENTION_INTERVAL_MS                 | Default 60000, 1000–3600000.                                                           |
| EVIDENCE_RETENTION_PORT                        | Internal metrics/readiness port, default 9091.                                         |
| METRICS_TOKEN                                  | Required >=32 characters in production/staging; Bearer-authenticated scrape.           |
| STORAGE_DRIVER                                 | `s3`, or `local` with an absolute RESTRICTED_STORAGE_DIR.                              |
| S3_RESTRICTED_BUCKET / S3_REGION / S3_ENDPOINT | Dedicated private evidence store, no public CDN route.                                 |
| S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY        | Both injected together, or use the workload identity chain.                            |

The minimal S3 identity needs exact restricted namespace GetObject/Head,
DeleteObject, DeleteObjectVersion and ListBucketVersions. It needs **no** public
bucket access, PutObject, bypass-governance, account-administration or signing
keys. The current adapter shares implementation with the API but this worker
only invokes erase operations. Validate real IAM policy with Security; an
example permission list is not proof that an effective policy is least privilege.
The worker DB role needs the specific read/update/create operations used by
its repository, audit and Outbox only. No roles/users/decision/grant mutation.

## Shadow and approval

Deploy shadow with enforce references unset. It performs bounded, keyset-paged
planning reads, emits counts and **does not** stamp retainUntil, fence, jobs,
audit or delete objects. Verify eligible volume and investigate every
`reviewRequired` observation. The metric counts observations across sweeps,
not distinct evidence. Review durations and checksum policy explicitly.
Audit storage versioning, all replicas/backups, scratch locations and previously
issued cache routes. Confirm no untracked derivative store exists. Approval
references point to external reviews; merely setting them is not approval.

Canary enforce must use a separate synthetic environment first. The automated
CI database and S3 endpoint enforce loopback isolation and `retention_ci`.
Only an authorized, scoped rollout can subsequently target real evidence.

## Jobs, failure and recovery

`PENDING -> RUNNING -> COMPLETED`, or `RUNNING -> RETRY -> RUNNING`, with
`DEAD` after the configured attempt budget. Lease is 120 seconds; storage S3
operation bound is 45 seconds. Expired RUNNING leases can be reclaimed.
The token in a previous worker cannot acknowledge a newer claim. A cancelled
unstarted DRAFT plan is historical; a new activity basis can produce a new job.
A missing canonical source dead-letters; it is not relabelled as safe.

A storage or transaction failure retains the durable read-denial fence. Never
clear erasureStartedAt or mark deletedAt/COMPLETED by hand. Never delete an
asset/job row as evidence that bytes disappeared. Correct the underlying
backend failure first. Investigate DEAD with an assigned operator and deadline;
keep the safe access denial while obtaining an authorized audited replay.
**A self-service authorized requeue/hold API is not implemented in this slice.**
Do not interpret the existence of a holdUntil column as a complete legal-hold
workflow. Its queue and pre-erasure rechecks are tested, but authority, expiry
review, and operator UX remain gates.

SIGTERM/SIGINT stop taking new work, drain the current storage operation and
its receipt, then close HTTP, storage sockets and DB. A forced crash is recovered
through the lease; it never clears the fence. Restart is safe. Changing the
current environment does not change old jobs' pinned policies.

## Monitoring

Scrape the worker (not API): `GET /metrics`, using the injected Bearer token.
`GET /health/ready` carries no content/identifiers and no mutation. Configure
Prometheus job name `evidence-retention`, import the reviewed example alerts in
`infra/monitoring/evidence-retention.rules.yml`, and assign a real on-call owner.
The rules are checked in, **not installed in a live monitoring system**.

Counters: `evidence_retention_operations_total{outcome=examined|eligible|planned|
reviewRequired|processed|completed|failed}`, `evidence_retention_tick_failures_total`.
Gauges: `evidence_retention_last_success_unixtime`,
`evidence_retention_jobs{state=dead|overdue|completed}`. No labels contain user,
asset, filename, key, hash, document contents or exception messages. A green
readiness response is not a claim that the backlog is empty; alert on DEAD,
overdue and unplannable independently. Tune stale thresholds for measured batch
size/backend latency; do not suppress failure alerts to get a green dashboard.

## Erasure receipt and limits

The durable job/audit/outbox records preserve phase, SYSTEM_RETENTION actor,
case policy version, pinned retention version, attempt and timestamp. Successful
receipt verifies only PRIMARY_OBJECT_AND_VERSIONS; decisions are unchanged.
Original filename, owner, pending fields, content metadata and (by default)
checksum are scrubbed, and the old key becomes an opaque tombstone. Scan verdict
history remains a historical fact, not access authority. The Admin notice shows
EXPIRED, ERASING or ERASED based on the server, never a fabricated UI success.

Backups/replicas/staging/browser buffers and complete account erasure require
separate proof. Source unlink is not a disk-sector sanitization claim. Existing
unfinalized cleanup and upload/staging crash races remain outside this gate.

## Remaining Sprint 12 delivery

Unfinalized/staging lifecycle and complete account erasure; dispute restricted
attachments; authenticated HTTP/browser persistence; server drafts; information
requests, responses and deadlines; safe localized actionable notifications;
centralized Admin authority/analysis, compound remedies and execution consent;
independent appeals; complete WCAG/RTL/device/usability review and explicit
Product/Security/Privacy release approvals all remain. This worker does not
turn the prior intake UI into a complete dispute-resolution platform.
