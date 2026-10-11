# R18 — Go / no-go

Decision on 2026-10-11 for this PR with `develop@ab7e473` integrated: **NO-GO.**
Final status: **`R18_BLOCKED`**.

`fabeb07` remains the historical R18 baseline. PR #152 was merged as
`ab7e473a66601545b5cd0d616b9d315163b619bf` on 2026-10-10T21:26:17Z and is
included in this branch. The latest technical acceptance is recorded on
[PR #153](https://github.com/baraabd/homeservicemarketplace/pull/153), bound
to its current head; it does not approve production deployment.

## Findings

| ID     | Class    | Finding                                                                                                                             | Owner of the next step                                      |
| ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| R18-F2 | RESOLVED | Wallet, admin and seeker truth fixes from #152 are merged and integrated (`ab7e473`)                                                | closed by #152; retain the separate money-unit decision D-2 |
| D-2    | P1       | One integer shown in two scales (bids/bookings whole units, wallet/admin `/100`)                                                    | owner decision                                              |
| D-3    | P1       | Dispute windows unset: production intake is closed                                                                                  | owner decision                                              |
| D-8    | P1       | No minimum-active-admin guard                                                                                                       | owner decision                                              |
| D-19   | P1       | `WORK_ACCESS_ENFORCED` / `VERIFICATION_ENFORCED` default off; their production values and the ADR 0013 backfill check are undecided | owner decision                                              |
| D-13   | P1       | A custom-text request is visible to no provider and the seeker is not told                                                          | owner decision                                              |
| R18-S2 | P1       | CodeQL #2 high open; exception proposed, not accepted (`SECURITY_ACCEPTANCE.md`)                                                    | owner disposition                                           |
| R18-G1 | P1       | `develop` unprotected (`BRANCH_PROTECTION_EVIDENCE.md`)                                                                             | owner applies the payload                                   |
| R18-H1 | P1       | No hosted staging or production target                                                                                              | owner supplies the target                                   |
| R18-O1 | P1       | No backup restore, rollback rehearsal or alert test                                                                                 | needs R18-H1                                                |
| R18-J1 | P1 (CI)  | Require exactly 7 passing R18 cases on the current PR head, with no failures, flakes or skips                                       | current-head CI summary and aggregate acceptance on PR #153 |
| R18-O2 | P2       | GitHub secret scanning disabled (gitleaks covers CI)                                                                                | owner                                                       |
| R18-O3 | P2       | API does not report its version or SHA                                                                                              | follow-up                                                   |
| CQ-20  | P2       | CodeQL #20 medium in the local-disk adapter (refused in production)                                                                 | follow-up                                                   |
| P3-1   | P3       | Dead `EcosystemContext` seed data and unused translation keys                                                                       | follow-up                                                   |
| P3-2   | P3       | CodeQL #13, #16 medium in test and CI tooling                                                                                       | follow-up                                                   |

P0: none.

## GO requirements

| Requirement                            | State                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| PR #149 merged and post-merge accepted | met (`FUNCTIONAL_ACCEPTANCE.md`)                                                                           |
| R17 integrated state reconciled        | met (`r17/ACCEPTANCE.md`)                                                                                  |
| Zero P0                                | met                                                                                                        |
| Zero P1                                | **not met** (9 policy, security, governance and hosted blockers, plus R18-J1 until current-head CI passes) |
| R18 functional journeys pass           | require the current-head summary and aggregate acceptance on PR #153                                       |
| Hosted staging accepted                | **not met**                                                                                                |
| CodeQL accepted                        | **not met** (#2)                                                                                           |
| Dependency and secret gates            | met in CI                                                                                                  |
| Container scans                        | met in CI                                                                                                  |
| Backup restore executed                | **not met**                                                                                                |
| Rollback rehearsed                     | **not met**                                                                                                |
| Migrations accepted                    | met in CI; hosted upgrade not run                                                                          |
| Observability active                   | **not met** (no hosted backend)                                                                            |
| Branch protection effective            | **not met**                                                                                                |
| Immutable release manifest complete    | **not met** (no registry digests; `RELEASE_MANIFEST.json`)                                                 |
| Owner-approved release scope           | **not met** (`RELEASE_SCOPE.md` awaits approval)                                                           |
| Live money disabled and truthful       | met by merged #152; D-2 remains a separate amount-display blocker                                          |
| Production credentials validated       | **not met**                                                                                                |
| Production approval gate present       | **not met** (`PRODUCTION_RELEASE_APPROVED` absent)                                                         |

## States

| State                      | Claimed | Why                                                                                |
| -------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `R18_FUNCTIONAL_ACCEPTED`  | no      | D-2, D-3, D-8, D-13 and D-19 remain open; passing R18-J1 alone does not close them |
| `R18_RC_BUILT`             | no      | no registry digests or provenance                                                  |
| `R18_STAGING_ACCEPTED`     | no      | no target                                                                          |
| `R18_READY_FOR_PRODUCTION` | no      | the above                                                                          |
| `R18_PRODUCTION_LIVE`      | no      | nothing deployed                                                                   |
