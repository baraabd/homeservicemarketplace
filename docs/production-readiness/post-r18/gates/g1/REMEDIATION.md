# G1 corrective source for review

Status: implementation candidate; G1 remains BLOCKED until G1-06 publication.
Authority and exact path reservations: `REMEDIATION_OWNERSHIP.md`.
Base commit: `5d3acaf861d74756190854138af485cfbfaa0a43`.
Final source/tree identity and live test evidence are recorded in the review PR,
so this document does not attempt to embed its own commit SHA.

| Blocker | Corrective source                                                                                                                                                 | Mandatory evidence                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| G1-01   | Versioned internal money ports and compile-time consumer; stricter PostgreSQL refund binding; registered activation inbox handler with domain dedupe              | API typecheck; R19 real PostgreSQL direct-SQL negatives, full/partial positives, atomic notice rollback and replay                    |
| G1-02   | All unique public-upload keys use signed `If-None-Match: *`; avatar client sends it; existing CR-R20-01 size/MIME fix retained                                    | Web upload regression; all R20 real S3/IAM/root/authorization/retention cases; storage-plan invariants                                |
| G1-03   | Disposable Mailpit added to the integration job, both R21 gate variables supplied                                                                                 | All three real SMTP cases in the full API report, not only adapter doubles                                                            |
| G1-04   | Additive audit enum; replay permission definition excluded from all role grants; migrated execution tests; validated timing; compiled independent processes in CI | Real replay execute/refusals; seed grant absence; process SIGKILL/recovery, concurrent drain and SIGTERM handoff                      |
| G1-05   | Validated default-off API exporter; bounded periodic diagnostics; real outbox/mail/S3/scanner/standalone sweep metrics                                            | Default-off/config negatives, timeout/recovery and unchanged health tests; boundary result/error tests; real worker protected metrics |
| G1-06   | Reviewable source and verification plan only                                                                                                                      | Owner review/merge, exact merged-source certification, separately published and merged ACCEPTED record                                |

## Runtime choices

- Notification delivery uses the persisted provider owner and identifier-only
  event. Durable effects, handler marker and lease-fenced completion share the
  worker transaction. Duplicate domain keys preserve the existing inbox row.
- Refund source cannot invent a price, rail, account purpose or refund policy.
  Synthetic XTS/XXX fixtures remain non-production. No live money is activated.
- The migration is forward-only and refuses invalid historical compensation;
  it never adjusts monetary amounts to make an inconsistent row pass.
- Replay permission is registered but never granted. The privileged CLI's
  existing fresh-authority, exact-event, reason and audit requirements remain.
- API trace export is absent by default. Telemetry uses bounded static labels;
  exceptions, payloads, object keys, recipients and collector headers are not
  metric labels. A collector outage drops bounded telemetry without changing
  business outcomes.
- SMTP diagnostics use a separate connection, S3 diagnostics use abortable
  HeadBucket, scanner diagnostics use bounded PING. Probes cannot alter health
  liveness/readiness or close an active mail send.
- Standalone worker metrics use their existing authenticated listener and
  registry. Their existing operating modes, fences and shutdown remain intact.

## CI evidence wiring

The existing required integration and evidence-retention jobs are extended;
no gate, test, assertion or skip threshold is weakened. The R20 test principal
and services are disposable. The pinned MinIO client is built from upstream
source using the public Go checksum database; its errors are redacted by the
fixture to avoid leaking temporary credentials. No production storage is used.

Reports: `g1-api-report.json`, `r22-process-report.json` and
`r20-storage-report.json`, retained as G1 artifacts on the exact PR workflow run.
The R22 process suite runs after an actual API build. Its separate invocation
must pass; a locally skipped database-gated suite is not equivalent evidence.

## Review and release boundaries

See `REMEDIATION_ACCEPTANCE.md` for evidence requirements and
`REMEDIATION_ROLLBACK.md` for rollout/rollback ordering. No merge, deployment,
privilege grant or hosted configuration is performed by this source PR.
Existing G1 decisions and leases remain historical and BLOCKED. R26 and Wave 2
start only after a new ACCEPTED G1 record is owner-reviewed and merged.
