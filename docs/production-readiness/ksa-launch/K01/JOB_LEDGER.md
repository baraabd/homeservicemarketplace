# K01 — Per-job ledger

The source candidate is `ad12eed180fdfbb783917f98e0957bb5e637f5e6` (tree
`2a2e84949de40bbdb2b2273f6e88d3348e104532`). The commit adding this ledger
is documentation-only. Its own hosted checks, the final head SHA and the PR
body binding are recorded on PR #210. Rows are the latest attempt per check
name, taken from the GitHub check-runs API; the raw data is in
`evidence/checks-*.json`.

## Result

**Source candidate: 40 / 40 checks pass. Every required final-SHA check
(13, including `CodeQL`) is present and passing.** On develop `92770ea6`
(push) 28 passed and 4 failed. The 4 failures had two root causes: the
dependency audit (security scan → R18 → CI gate) and the Windows startup stall.

| Check                                                          | Required | develop `92770ea6` (push) | candidate `ad12eed1` (PR)                                                                                 | Note                                              |
| -------------------------------------------------------------- | -------- | ------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Admin review real-route and persistence evidence               |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126222786836)) |                                                   |
| Analyze JavaScript/TypeScript                                  | yes      | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636379/job/126219127837)) |                                                   |
| Auth cookie contract (real browser + real API)                 |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126222787217)) |                                                   |
| Browser E2E (Playwright / Chromium)                            |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126222786905)) |                                                   |
| CI gate                                                        | yes      | failure                   | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126230867094)) |                                                   |
| CodeQL                                                         | yes      | not reported              | pass ([run](https://github.com/baraabd/homeservicemarketplace/runs/126220934989))                         | Code-scanning result; published for PR heads only |
| Compose stack smoke (migrate / boot / readiness / media / OTP) |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126222786926)) |                                                   |
| Dependency, secret, and container scans                        |          | failure                   | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126222786670)) |                                                   |
| Dev browser startup (ubuntu-latest)                            | yes      | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722687277/job/126219307253)) |                                                   |
| Dev browser startup (windows-latest)                           | yes      | failure                   | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722687277/job/126219307667)) |                                                   |
| Dispute journey / real HTTP, browser, Postgres and ClamAV      |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126222786899)) |                                                   |
| Docker cold build + production boot                            |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126222786823)) |                                                   |
| Evidence retention / real Postgres, S3 versions and ClamAV     |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126222787051)) |                                                   |
| Integration & E2E (real Postgres / Redis)                      |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126222786758)) |                                                   |
| Phase 5 real-route and persistence evidence                    |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126224505257)) |                                                   |
| Phase 5 visual, responsive and accessibility gate              |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126222786864)) |                                                   |
| Production governance                                          | yes      | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722995547/job/126220354256)) |                                                   |
| R04 real browser, SMTP and Postgres                            | yes      | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636120/job/126219125378)) |                                                   |
| R18 functional completion acceptance                           |          | failure                   | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126230816840)) |                                                   |
| R23 Linux firing and recovery delivery                         |          | not reported              | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636118/job/126219834874)) | Path-filtered PR lane; not required               |
| R25 real replicas and recovery                                 |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126222787036)) |                                                   |
| R26 cookies, authorization and enforced CSP                    | yes      | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636138/job/126219125297)) |                                                   |
| R27 comparable measurements and unchanged budgets              |          | not reported              | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636223/job/126223105799)) | PR-only lane; not required                        |
| R27 real services (baseline)                                   |          | not reported              | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636223/job/126219125815)) | PR-only lane; not required                        |
| R27 real services (candidate)                                  |          | not reported              | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636223/job/126219126328)) | PR-only lane; not required                        |
| R27 real services (repair-baseline)                            |          | not reported              | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636223/job/126219126273)) | PR-only lane; not required                        |
| R30 manual payments / real services and browser                |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126222786874)) |                                                   |
| R31 subscriptions real API and browser                         |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126222787109)) |                                                   |
| Real Seeker Provider Admin startup                             | yes      | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636293/job/126219126668)) |                                                   |
| Recovery and native Sharp (ubuntu-latest)                      |          | not reported              | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636123/job/126219125662)) | Path-filtered PR lane; not required               |
| Recovery and native Sharp (windows-latest)                     |          | not reported              | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636123/job/126219124914)) | Path-filtered PR lane; not required               |
| Staging boundary gate                                          | yes      | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636227/job/126221055669)) |                                                   |
| Staging image boundaries                                       | yes      | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636227/job/126219125585)) |                                                   |
| Staging release controls (ubuntu-latest)                       | yes      | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636227/job/126219125748)) |                                                   |
| Staging release controls (windows-latest)                      | yes      | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636227/job/126219125837)) |                                                   |
| Verify / Install & lockfile integrity                          |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126219937652)) |                                                   |
| Verify / Verify API (lint / typecheck / unit / build)          |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126221200495)) |                                                   |
| Verify / Verify Contracts                                      |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126220305263)) |                                                   |
| Verify / Verify Database                                       |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126220714439)) |                                                   |
| Verify / Verify Web (lint / typecheck / unit / build)          |          | pass                      | pass ([run](https://github.com/baraabd/homeservicemarketplace/actions/runs/41722636401/job/126220714588)) |                                                   |

Candidate summary: {"pass":40}; required checks missing: []; required not passing: []. Collected 2026-11-03T21:55:06.989Z.

## Failures, cancellations and retries during K01

| Event                                                        | Cause                                                                                                                 | Category                  | Resolution                                                                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| R27 × 4 failed on `02bd845b`                                 | No registered dependency controls for the changed graph                                                               | expected protocol failure | v1, then v2 controls registered; R27 passes on `ad12eed1`                                                       |
| Production governance failed on `ad12eed1` (run 41722636449) | The `synchronize` event carried the PR body before `Final SHA` was updated; the concurrent `edited` run was cancelled | process sequencing        | A body edit re-triggered the check, which passed (41722995547). For later pushes, write the body before pushing |
| Runs on `02bd845b` and `84b8d662` cancelled                  | A newer push (`cancel-in-progress`)                                                                                   | superseded                | Not counted as evidence                                                                                         |
| Local `gh pr checks --watch` stopped                         | Host memory pressure (Claude Code reaper)                                                                             | local tooling             | Replaced by a one-off read and a monitor; no CI effect                                                          |

## Test counts on the source candidate (hosted)

| Job                                      | Result                                                                                       | Same as develop?                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Verify API (Jest unit)                   | 310 suites / 5,468 tests passed; 101 suites / 1,880 tests skipped (DB-gated, executed below) | identical                                               |
| Verify Web (Vitest)                      | 226 files / 2,730 passed; lint 0 errors / 34 warnings                                        | +1 test (new error-transition case); warnings identical |
| Integration & E2E (real Postgres/Redis)  | 396 suites / 7,248 tests passed; 15 suites / 100 tests skipped; extra suite 3/3              | identical                                               |
| Browser E2E (Chromium)                   | 836 + 6 passed; 349 skipped                                                                  | identical                                               |
| Phase 5 visual / a11y                    | 108 + 131 passed                                                                             | —                                                       |
| Admin review real-route                  | 15 + 3 passed                                                                                | —                                                       |
| Dispute journey (+ClamAV)                | 31, 1, 22, 1, … passed                                                                       | —                                                       |
| R30 manual payments (+ClamAV)            | 16, 6, 1 passed                                                                              | —                                                       |
| Evidence retention (S3 versions, ClamAV) | 29 + 40 passed                                                                               | —                                                       |
| Auth cookie contract                     | 8 passed                                                                                     | —                                                       |

The remaining skips match develop exactly. K01 adds no skip and lowers no
worker count. The individual skip reasons were not re-audited here.

## Repeated Windows startup evidence

| Run         | Event             | Head       | windows-latest | ubuntu-latest |
| ----------- | ----------------- | ---------- | -------------- | ------------- |
| 41716956954 | pull_request      | `02bd845b` | pass           | pass          |
| 41721260487 | pull_request      | `84b8d662` | pass           | pass          |
| 41721328924 | workflow_dispatch | `84b8d662` | pass           | pass          |
| 41722636219 | pull_request      | `ad12eed1` | pass           | pass          |
| 41722687277 | workflow_dispatch | `ad12eed1` | pass           | pass          |

Five out of five pass. That is supporting evidence for a stall which
occurred about once in 40 runs on develop; it does not prove the stall is
gone (see [WINDOWS_STARTUP.md](WINDOWS_STARTUP.md)).
