# R18 — Go / no-go

Decision on 2026-10-11 for `release/r18-closure-rc1` (PR #155) on
`develop@ffe9a398c777a892ba1227989a84c2a60fe8a041`: **NO-GO.**
Final status: **`R18_BLOCKED`**.

History: the R18 baseline was `fabeb07`. PR #153 merged as `9bc4181` with
this file at NO-GO, and PR #154 (startup repair) merged as `ffe9a39`. All
seven post-merge workflows on `ffe9a39` succeeded: CI 38152627363, CodeQL
38152627072, Production governance 38152627114, Real application startup
performance 38152627102, Web development startup 38152627071,
Authentication lifecycle acceptance 38152627089, and Staging release
boundary 38152627142. The gate model is in `RELEASE_GATES.md`; the
proposals awaiting the owner are in `OWNER_DECISIONS.md`.

## Findings

| ID     | Class    | Finding                                                                                                                                                        | Next step                                             |
| ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| D-2    | P1       | One integer shown in two scales: 150 USD on bid cards, "$2" in wallet/admin; cross-currency sums; a 10 % fee still computed in financials/earnings read models | owner decision; proposal (a) in `OWNER_DECISIONS.md`  |
| D-3    | P1       | Dispute policy unset; intake closed; no admin UI for the two policy keys                                                                                       | owner decision                                        |
| D-8    | P1 → P2  | Last-admin floor implemented on this branch (409, platform-wide lock); minimum count and break-glass owner still undecided                                     | owner decision                                        |
| D-13   | P1       | Custom-text requests reach nobody; the seeker is now told so (this branch), but intake is not limited                                                          | owner decision                                        |
| D-19   | P1       | Enforcement flags default off; readiness check and bounded backfill added; a dev-seeded database shows 7 of 7 working providers without a grant                | owner decision                                        |
| R18-S2 | P1       | CodeQL #2 high open on `develop`; false-positive proposal awaits the owner                                                                                     | owner disposition                                     |
| R18-G1 | P1       | `develop` and `main` unprotected, no rulesets (re-read 2026-10-11)                                                                                             | owner applies or authorizes the payload               |
| R18-H1 | P1       | No hosted staging or production target, no registry                                                                                                            | owner names target, registry, budget                  |
| R18-O1 | P1       | No backup restore, rollback rehearsal or alert test                                                                                                            | needs R18-H1                                          |
| R18-J1 | P1 (CI)  | The 7-case R18 aggregate must pass again on this PR's final head                                                                                               | CI on PR #155                                         |
| R18-I1 | RESOLVED | The production seed published five invented ACTIVE providers                                                                                                   | fixed by `eb3431b` (this branch)                      |
| R18-A1 | RESOLVED | Admin-access approvals and operator admin grants left no attributable audit row                                                                                | fixed by `64ccdb2`, `711fd92` (this branch)           |
| R18-O3 | RESOLVED | API did not report its build                                                                                                                                   | `9c17a31`: `/health/live` `sourceSha`, launcher check |
| R18-W1 | RESOLVED | nginx served hashed assets uncached and uncompressed                                                                                                           | `c35a1cf`; checked by the image smoke in CI           |
| R18-T1 | P2       | Real-API browser journeys run on desktop only (`SKIPPED_COVERAGE.md`)                                                                                          | coverage work                                         |
| R18-O2 | P2       | GitHub secret scanning and Dependabot alerts disabled (gitleaks and audit cover CI)                                                                            | owner                                                 |
| CQ-20  | P2       | CodeQL #20 medium, dev-only storage driver                                                                                                                     | owner disposition                                     |
| R18-C1 | P2       | Vercel CSP is report-only and conflicts with external Google Fonts CSS                                                                                         | follow-up with the font decision                      |
| P3-1   | P3       | Dead `EcosystemContext` seed data and unused translation keys                                                                                                  | follow-up                                             |
| P3-2   | P3       | CodeQL #13, #16 medium in test and CI tooling                                                                                                                  | owner disposition                                     |

P0: none.

## Gates (`RELEASE_GATES.md`)

| Gate                       | State       |
| -------------------------- | ----------- |
| A. Candidate eligible      | **not met** |
| B. Hosted staging accepted | not started |
| C. Ready for production    | not started |
| D. Production live         | not started |

## States

| State                      | Claimed | Why                                                                |
| -------------------------- | ------- | ------------------------------------------------------------------ |
| `R18_FUNCTIONAL_ACCEPTED`  | no      | D-2, D-3, D-13 and D-19 remain open                                |
| `R18_RC_BUILT`             | no      | no registry; no digests or provenance; the manifest is `NOT_BUILT` |
| `R18_STAGING_ACCEPTED`     | no      | no target                                                          |
| `R18_READY_FOR_PRODUCTION` | no      | the above                                                          |
| `R18_PRODUCTION_LIVE`      | no      | nothing deployed                                                   |
