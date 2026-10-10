# R18 — Go / no-go

Decision on 2026-10-11 for `develop@fabeb07` plus this PR: **NO-GO.**
Final status: **`R18_BLOCKED`**.

## Findings

| ID     | Class | Finding                                                                                                                             | Owner of the next step                   |
| ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| R18-F2 | P1    | Wallet "balance" after an unapproved fee, admin fee/net/"Refunds $0", and three seeker copy claims (`PRODUCT_TRUTH_INVENTORY.md`)   | merge #152 (Draft until its CI is green) |
| D-2    | P1    | One integer shown in two scales (bids/bookings whole units, wallet/admin `/100`)                                                    | owner decision                           |
| D-3    | P1    | Dispute windows unset: production intake is closed                                                                                  | owner decision                           |
| D-8    | P1    | No minimum-active-admin guard                                                                                                       | owner decision                           |
| D-19   | P1    | `WORK_ACCESS_ENFORCED` / `VERIFICATION_ENFORCED` default off; their production values and the ADR 0013 backfill check are undecided | owner decision                           |
| D-13   | P1    | A custom-text request is visible to no provider and the seeker is not told                                                          | owner decision                           |
| R18-S2 | P1    | CodeQL #2 high open; exception proposed, not accepted (`SECURITY_ACCEPTANCE.md`)                                                    | owner disposition                        |
| R18-G1 | P1    | `develop` unprotected (`BRANCH_PROTECTION_EVIDENCE.md`)                                                                             | owner applies the payload                |
| R18-H1 | P1    | No hosted staging or production target                                                                                              | owner supplies the target                |
| R18-O1 | P1    | No backup restore, rollback rehearsal or alert test                                                                                 | needs R18-H1                             |
| R18-J1 | P1    | The R18 cross-role journey has not yet passed on this PR's head                                                                     | this PR's CI                             |
| R18-O2 | P2    | GitHub secret scanning disabled (gitleaks covers CI)                                                                                | owner                                    |
| R18-O3 | P2    | API does not report its version or SHA                                                                                              | follow-up                                |
| CQ-20  | P2    | CodeQL #20 medium in the local-disk adapter (refused in production)                                                                 | follow-up                                |
| P3-1   | P3    | Dead `EcosystemContext` seed data and unused translation keys                                                                       | follow-up                                |
| P3-2   | P3    | CodeQL #13, #16 medium in test and CI tooling                                                                                       | follow-up                                |

P0: none.

## GO requirements

| Requirement                            | State                                                      |
| -------------------------------------- | ---------------------------------------------------------- |
| PR #149 merged and post-merge accepted | met (`FUNCTIONAL_ACCEPTANCE.md`)                           |
| R17 integrated state reconciled        | met (`r17/ACCEPTANCE.md`)                                  |
| Zero P0                                | met                                                        |
| Zero P1                                | **not met** (11)                                           |
| R18 functional journeys pass           | pending this PR's CI                                       |
| Hosted staging accepted                | **not met**                                                |
| CodeQL accepted                        | **not met** (#2)                                           |
| Dependency and secret gates            | met in CI                                                  |
| Container scans                        | met in CI                                                  |
| Backup restore executed                | **not met**                                                |
| Rollback rehearsed                     | **not met**                                                |
| Migrations accepted                    | met in CI; hosted upgrade not run                          |
| Observability active                   | **not met** (no hosted backend)                            |
| Branch protection effective            | **not met**                                                |
| Immutable release manifest complete    | **not met** (no registry digests; `RELEASE_MANIFEST.json`) |
| Owner-approved release scope           | **not met** (`RELEASE_SCOPE.md` awaits approval)           |
| Live money disabled and truthful       | met after #152                                             |
| Production credentials validated       | **not met**                                                |
| Production approval gate present       | **not met** (`PRODUCTION_RELEASE_APPROVED` absent)         |

## States

| State                      | Claimed | Why                                                                                    |
| -------------------------- | ------- | -------------------------------------------------------------------------------------- |
| `R18_FUNCTIONAL_ACCEPTED`  | no      | #152 unmerged; D-2, D-3, D-8, D-13, D-19 open; R18 journey not yet passed on this head |
| `R18_RC_BUILT`             | no      | no registry digests or provenance                                                      |
| `R18_STAGING_ACCEPTED`     | no      | no target                                                                              |
| `R18_READY_FOR_PRODUCTION` | no      | the above                                                                              |
| `R18_PRODUCTION_LIVE`      | no      | nothing deployed                                                                       |
