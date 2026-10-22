# Post-R18 active status index

G2 technical acceptance: `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`; all 38 checks and required artifacts verified.
PR #183 publication remains unmerged. Wave 3 and Wave 4 remain blocked.

Authority: `SPRINT_REGISTRY.json`. Package recovery on 2026-10-22.
G1 remains accepted and owner-published at its immutable frozen source. The active
G2 source manifest controls the current integration decision and publication hold.
All restored R29–R33 packages remain PLANNED behind G2; R34–R38 remain PLANNED
behind the separate G3 gate. No future lane is released by this preparation.

| ID  | Title                                                                              | Wave | Status           | Branch                             | PR         |
| --- | ---------------------------------------------------------------------------------- | ---- | ---------------- | ---------------------------------- | ---------- |
| R19 | Extend and certify the existing money authority; freeze shared financial contracts | 1    | SANDBOX_ACCEPTED | feat/r19-money-authority-contracts | #159       |
| R20 | Production storage, private media authorization and persistence                    | 1    | SANDBOX_ACCEPTED | feat/r20-storage-production        | #161       |
| R21 | Production email delivery and durable feedback                                     | 1    | SANDBOX_ACCEPTED | feat/r21-email-production          | #160       |
| R22 | Outbox and worker execution reliability                                            | 1    | SANDBOX_ACCEPTED | feat/r22-worker-outbox-reliability | #158       |
| R23 | Observability, privacy-safe diagnostics and incident detection                     | 1    | SANDBOX_ACCEPTED | feat/r23-observability-incidents   | #163       |
| R24 | Money application API and module wiring; freeze adapter integration boundaries     | 2    | READY_TO_START   | feat/r24-money-api-integration     | #176       |
| R25 | Realtime multi-instance activation and reconnect recovery                          | 2    | READY_TO_START   | feat/r25-realtime-multi-instance   | #175       |
| R26 | Application security and effective authorization hardening                         | 2    | READY_TO_START   | feat/r26-application-security      | #174       |
| R27 | Measured startup, bundle and database performance                                  | 2    | READY_TO_START   | feat/r27-performance-capacity      | #173       |
| R28 | Authorized hosted topology, infrastructure and release inputs                      | 2    | READY_TO_START   | feat/r28-hosted-platform           | #179, #181 |
| R29 | Stripe sandbox subscription collections, signed webhooks and refund adapter        | 3    | PLANNED          | feat/r29-stripe-sandbox-webhooks   | —          |
| R30 | Manual subscription payment rails and protected receipt review                     | 3    | PLANNED          | feat/r30-manual-payment-review     | —          |
| R31 | Subscription plans, My Plan and atomic entitlements                                | 3    | PLANNED          | feat/r31-subscription-entitlements | —          |
| R32 | Refund eligibility, reservations and ambiguous-outcome recovery                    | 3    | PLANNED          | feat/r32-refund-recovery           | —          |
| R33 | Financial read models and Admin/Provider operations UI                             | 3    | PLANNED          | feat/r33-financial-operations-ui   | —          |
| R34 | Cross-rail reconciliation, settlement exceptions and financial acceptance          | 4    | PLANNED          | feat/r34-reconciliation-settlement | —          |
| R35 | Three-application and subscription lifecycle acceptance                            | 4    | PLANNED          | test/r35-cross-role-certification  | —          |
| R36 | Backup restore, disaster recovery and compatible rollback                          | 4    | PLANNED          | test/r36-backup-restore-recovery   | —          |
| R37 | Hosted security, load and operational failure acceptance                           | 4    | PLANNED          | test/r37-hosted-load-security      | —          |
| R38 | Release-candidate packaging and final launch certification                         | 4    | PLANNED          | release/r38-release-certification  | —          |

## Execution, planning and acceptance are separate

Wave 1 `SANDBOX_ACCEPTED` retains G1 scope. Wave 2 `READY_TO_START` is the
historical published G1 start contract, not its current implementation verdict.
The status column preserves that machine contract. All five Wave 2 deliveries are now merged; their nested `execution` records and G2 successor evidence describe actual delivered source and technically accepted integration pending G2 publication. R28 includes the corrective owner-merged PR #181. Retaining historical source identities does not treat
old checks as proof of a newer build.

The original full prompt pack for R29–R38 was recovered with its previously
recorded SHA-256. Every title, branch, dependency and legacy alias now comes from
`gates/g2/prompts/R29.md` through `R38.md`; provenance is recorded in
`gates/g2/PROMPT_PROVENANCE.md`. These are planned packages, not implemented work.
The original 21-file R32 conditional package remains intact.

`waves/wave-03.plan.json` holds all five Wave 3 lanes until accepted source-bound
G2 evidence and a separately verified merged owner-reviewed publication. A
technically accepted review record can retain a tested frozen source while start
readiness remains blocked. `waves/wave-04.plan.json` has no source assigned and
requires a separate accepted and published G3 after actual Wave 3 integration.
R38 Phase B additionally requires the serialized R34–R37 final evidence join
and G4 owner scope approval; Phase A preparation does not certify future peers.

See `waves/OWNERSHIP_R29_R38.md` for exact conditional file scope, existing
authorities, separate resource/session identities and global coordinator
boundaries. R16 payout and unresolved R18/live-money/hosting decisions remain
visible. No planning status, source check or configuration report grants live
money, resource spend, account access, merge, deployment or release acceptance.
