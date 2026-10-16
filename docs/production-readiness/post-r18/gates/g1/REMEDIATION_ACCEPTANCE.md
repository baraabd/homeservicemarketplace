# G1 corrective source verification

This is a verification plan and review handoff, not an ACCEPTED gate record.
Final local results, PR head/tree, workflow attempts and artifact identities
belong in the review PR and its attached GitHub Actions evidence. The original
SOURCE_MANIFEST remains BLOCKED with no frozen base and no accepted sprints.

## Local source gates

Use Node 24.21.0 and pnpm 10.32.1, frozen install, Prisma generation and
validation, API/web typecheck, lint, builds, API unit/route suites, avatar web
regression, governance/storage-plan/worker-CLI checks and secret scanning.
Database-gated skips on a host without disposable services are reported as
skipped and cannot close the real-service requirements below.

## Required isolated runtime evidence

| Requirement                                                      | Runner / report                                          | Acceptance                                                                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| R19 strengthened financial constraints and notification delivery | Full API integration job / g1-api-report                 | all R19 cases pass; direct SQL rejects wrong reference, amount, accounts, direction and missing compensation; rollback/replay leaves one notice |
| R20 S3 semantics and access boundaries                           | evidence-retention job / r20-storage-report              | all 40 cases execute, zero skipped/failed; avatar overwrite returns 412 and original bytes remain                                               |
| R21 actual SMTP                                                  | full API job with disposable Mailpit                     | all three gated cases execute and pass                                                                                                          |
| R22 replay and authority                                         | full API job / g1-api-report                             | migrated execution and negative cases run; missing audit is injected without mutating global enum; no permission grants                         |
| R22 process crashes and shutdown                                 | built API, Linux / r22-process-report                    | every case runs, zero skipped/failed; real processes and signals                                                                                |
| R23 metrics producers and health separation                      | local/full API plus existing real standalone worker jobs | transport success/failure retained; protected metrics contain job series; health contracts unchanged                                            |
| Combined source                                                  | all required workflows on final PR head                  | success on current attempts; CodeQL security result and zero alert annotations checked independently of Actions job                             |

Review each report's actual executed case list, not only its aggregate exit
code. A missing artifact, skipped required scenario or cancelled job is not PASS.
Browser evidence comes from the existing real-route CI jobs on the same head;
this change does not redesign the UI.

## G1-06 owner handoff

1. Review the corrective code, migration, contracts and evidence; merge only by
   owner approval outside this task's no-merge authorization.
2. Re-run mandatory evidence on the exact merged commit and record commit/tree
   identities. A PR check is not merged-source certification.
3. Publish a separate ACCEPTED G1 decision with reviewed evidence and accepted
   Wave 1 boundaries; merge that record.
4. Recheck the frozen source and lane ownership, then start R26 and Wave 2.

Hosted storage/IAM/KMS/CDN, real sender deliverability, alert receivers,
production infrastructure, branch protection and money/payout policy choices
remain separate release work. This handoff neither waives nor substitutes for
them, and does not require unrelated future sprints to exist before G1.
