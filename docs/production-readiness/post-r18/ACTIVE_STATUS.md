# Post-R18 active status index

G2 technical acceptance: `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`; all 38 checks and required artifacts verified.
Owner-merged PR #183 publication is independently verified at
`986b4707776711e80564f0642133ede90ba16f3c`. R30, R31, R32 and R33 source
assignments are retained. R30 #184, R31 #186, R32 #187 and R33 #185 are owner-merged. Their source
ancestry is verified at `5ff2b7e6a46b4e42114184fac89928372f4c8d4c`; see
the owner-merged source history. Existing lane lease history is preserved.
R29 integration and all Wave 4 starts remain held; merged source is not G3 financial acceptance.

Authority: `SPRINT_REGISTRY.json`. Package recovery on 2026-10-22.
G1 remains accepted and owner-published at its immutable frozen source. The active
G2 source manifest controls the current integration decision and publication hold.
R30/R31/R32/R33 retain their historical READY_TO_START source assignments; their
nested execution records describe progress without claiming assembled acceptance.
R29 partial implementation is under review in Draft PR #193; the registry in
each branch remains authoritative for its start status. R34–R38 remain PLANNED
behind G3. No open PR is treated as accepted or owner-merged source.

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
| R30 | Manual subscription payment rails and protected receipt review                     | 3    | READY_TO_START   | feat/r30-manual-payment-review     | #184       |
| R31 | Subscription plans, My Plan and atomic entitlements                                | 3    | READY_TO_START   | feat/r31-subscription-entitlements | #186       |
| R32 | Refund eligibility, reservations and ambiguous-outcome recovery                    | 3    | READY_TO_START   | feat/r32-refund-recovery           | #187       |
| R33 | Financial read models and Admin/Provider operations UI                             | 3    | READY_TO_START   | feat/r33-financial-operations-ui   | #185       |
| R34 | Cross-rail reconciliation, settlement exceptions and financial acceptance          | 4    | PLANNED          | feat/r34-reconciliation-settlement | —          |
| R35 | Three-application and subscription lifecycle acceptance                            | 4    | PLANNED          | test/r35-cross-role-certification  | —          |
| R36 | Backup restore, disaster recovery and compatible rollback                          | 4    | PLANNED          | test/r36-backup-restore-recovery   | —          |
| R37 | Hosted security, load and operational failure acceptance                           | 4    | PLANNED          | test/r37-hosted-load-security      | —          |
| R38 | Release-candidate packaging and final launch certification                         | 4    | PLANNED          | release/r38-release-certification  | —          |

## Execution, planning and acceptance are separate

Wave 1 `SANDBOX_ACCEPTED` retains G1 scope. Wave 2 `READY_TO_START` is the
historical published G1 start contract, not its current implementation verdict.
The status column preserves that machine contract. All five Wave 2 deliveries are now merged; their nested `execution` records and G2 successor evidence describe actual delivered source and technically accepted integration with G2 owner publication now independently verified. R28 includes the corrective owner-merged PR #181. Retaining historical source identities does not treat
old checks as proof of a newer build.

The original full prompt pack for R29–R38 was recovered with its previously
recorded SHA-256. Every title, branch, dependency and legacy alias now comes from
`gates/g2/prompts/R29.md` through `R38.md`; provenance is recorded in
`gates/g2/PROMPT_PROVENANCE.md`. The recovered prompts are requirements, not implementation evidence. R30–R33
now have merged source. R29 has a partial component implementation under review
in #193; its global bindings and independent provider sandbox acceptance remain
outstanding. R34–R38 have no accepted implementation under this gate.
The original 21-file R32 conditional package remains intact.

`waves/wave-03.plan.json` preserves the assigned R30, R31, R32 and R33 source
sessions. The owner completed the ordered #187 then #185 merges. Git ancestry
proves R30, R31 and R32 merge commits and the reviewed R33 head are included in
`5ff2b7e6a46b4e42114184fac89928372f4c8d4c`; its tree exactly matches the R33
head `25fec75db092cd68ea1f08297601d8baecde6b1a`. This corrects the earlier
pending-merge prose without changing historical writer/lease records or
refreezing G2. G3 is still blocked by unintegrated R29, unavailable refund policy and
consequence bindings, missing integrated real-rail acceptance and publication.
`waves/wave-04.plan.json` still has no assigned source.
R38 Phase B additionally requires the serialized R34–R37 final evidence join
and G4 owner scope approval; Phase A preparation does not certify future peers.

See `waves/OWNERSHIP_R29_R38.md` for exact conditional file scope, existing
authorities, separate resource/session identities and global coordinator
boundaries. R16 payout and unresolved R18/live-money/hosting decisions remain
visible. No planning status, source check or configuration report grants live
money, resource spend, account access, merge, deployment or release acceptance.
