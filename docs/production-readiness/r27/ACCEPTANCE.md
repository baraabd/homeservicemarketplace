# R27 acceptance snapshot — continuation 2026-10-17

**IMPLEMENTED / SOURCE_VERIFIED for the local harness repair;
INTEGRATION_PENDING for final-head real-service/browser evidence.** This is
a pre-publication snapshot. The PR's final-source evidence section and linked
current-head checks record subsequent executions without pretending that a
source document can embed its own future SHA. R27 remains Draft while required
evidence or owner performance-budget approval is missing. G1 itself is open.

## Actual identities and retained evidence

Frozen runtime `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`, tree
`109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`. Diagnostic R27 candidate/harness
`5fe27fdbfc63437d7315d2b3820c4345e6aed27f`, tree
`9c1663bc42de4d5387091df7bedaeff307748e84`. Branch and current publication
identity: [PR #173](https://github.com/baraabd/homeservicemarketplace/pull/173).
Merged G1 publication verification is #172 at
`07c8e584c684111bfc80995c7efb0144cfb6161b`.

[Diagnostic workflow 38982468755](https://github.com/baraabd/homeservicemarketplace/actions/runs/38982468755)
retained both artifacts. Their downloaded ZIPs were independently hashed and
matched against GitHub's digest; they expire 2026-10-30.

| Artifact  | GitHub ID   | ZIP SHA-256                                                        |
| --------- | ----------- | ------------------------------------------------------------------ |
| Baseline  | 12081239887 | `bb451d020ca07a3a8cd1f31b8bcd2dbe80211ec44a5df7bf4291faa869af4fd4` |
| Candidate | 12081407762 | `51c89677b01e92659db286ddddb5b06a945c773759b6a5cc7d5b25f093693c24` |

At this diagnostic head, 32 of 34 latest named checks succeeded; the two R27
browser jobs failed. Older same-head governance failures were superseded by
a later PASS. These historical checks do not certify the repaired head.

## Requirement-to-evidence matrix

| Requirement                                    | Verified evidence                                                                                                | Remaining acceptance                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Cold/warm API boot and first read              | Five production-policy boot observations; hardware/cache/env/provenance declared; readiness p50 1282 to 1157 ms  | Small shared-VM sample; no boot p95/p99 or universal latency claim                           |
| Bundle transfer boundaries                     | Seeker-home gzip 369867 to 311655 B; admin 505808 to 380860 B; complete optional charts 507650 B                 | Full chart journey is slightly larger; bytes alone do not establish useful-UI speed          |
| Hot queries and query bounds                   | 17 list scenarios; 10836 requests, 43344 bids, 5418 bookings; admin page counts 22/52 to 10/10                   | Financial-bookings index/real completed-row fixture remains coordinator work                 |
| Request bid aggregation                        | Candidate six bounded SQL statements and no broad Bid scan; data/auth contracts retained                         | Original proposed five-statement ceiling fails; owner must assess the bounded-query tradeoff |
| Cache and authorization                        | 13 real API negatives, ETag cross-user replays and revoked-session rejection in retained reports                 | Explicit private no-store policy is CR-R27-04, owned by the HTTP/security integration lane   |
| Normal/burst/recovery load                     | Three 200-request profiles; p50/p95/p99, status/error counts, CPU/RSS retained                                   | Fixture-only empirical tails; realtime/upload/hosted failure-load capacity belongs to R37    |
| Graceful overload                              | Both sources: 100 HTTP 200, 50 HTTP 429 from 150 requests; natural ~60.3-second recovery                         | Independent production-policy contract, not a high-load capacity claim                       |
| AR/EN desktop/mobile development/production UI | Diagnostic desktop-English production JSON and partial screenshots inspected                                     | Full repaired browser matrix and current-head retained artifacts required                    |
| Harness safety and correctness                 | 36 harness tests + 160 governance tests pass; 62 API and 18 web focused tests pass                               | Real Redis reset/browser execution follows publication; doubles are not runtime proof        |
| Clean artifact provenance                      | Fresh checkout/install/generated Prisma/API/web builds; exact hashes and safe env fingerprints in IMPLEMENTATION | No claim that local compilation proves every live route                                      |
| CI/CodeQL/security                             | Historical source checks known; applicable local checks complete                                                 | New final-head CI, official CodeQL result and nonempty secret scans must pass                |

## Proposed budgets: four findings, none hidden

The unchanged proposal checker returned **47 PASS / 4 FAIL** on retained
candidate measurements (exit 1). These are findings against proposals,
not an approved release policy:

| Proposed check                         | Actual                  | Proposed maximum/condition     | Owner/action                                                                   |
| -------------------------------------- | ----------------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| Seeker requests statements             | 6                       | 5                              | Review extra bounded aggregation versus prior broad scan                       |
| Provider available requests statements | 13                      | 10                             | Unchanged populated-page hydration; original ceiling came from an empty result |
| Provider bookings statements           | 12                      | 7                              | Unchanged populated-page hydration; original ceiling came from an empty result |
| Admin financial bookings large scan    | Booking scan, 5418 rows | No large-table sequential scan | Coordinator migration lane; CR-R27-06 plus completed-booking fixtures          |

No budget value was raised, assertion removed, test skipped or timeout enlarged
to turn these findings green. Owner approval of the current-source budget
contract is still required. Live-money, payout, hosted and verification-policy
holds in R16/R18 remain independent.

## Source, sandbox and hosted states

Local source/tests/build: SOURCE_VERIFIED as listed. Retained diagnostic
PostgreSQL/Redis/SMTP measurements: executed, with specific browser failures.
Complete repaired browser matrix: INTEGRATION_PENDING at this snapshot.
Hosted deployment/capacity: NOT_RUN, owned by R28/R37. No sandbox payment,
production funding, new account grant or deployment acceptance is implied.

---

## Historical records retained for audit

> **Current G1 continuation:** R27 resumed from frozen source
> `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0` after verified owner merge of #171.
> See `ALLOWLIST.md` and `G1_HANDOFF.json`. The earlier report below is historical
> pre-G1 evidence. Current implementation/integration is IN_PROGRESS and is
> not accepted. Fresh baseline CI and required browser evidence are pending.

# R27 — Acceptance matrix

Status words: `SOURCE_VERIFIED`, `INTEGRATION_PENDING`, `HOSTED_PENDING`,
`NOT_RUN`, `BLOCKED_HOST`. No row is `RELEASE_ACCEPTED`. Only the coordinator
accepts the wave, and only the owner approves merge or deploy.

| #   | Requirement (sprint brief)                                                                                                       | Evidence                                                                                                                                                                                                | State                                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | Reproducible cold/warm baselines with hardware, dataset, load and cache declared; install excluded; build time not a page metric | `api-boot-baseline.json` (6 runs: 1 first-boot, 5 warm OS cache); `bundle-*.json` (build time labelled as such); provenance in every report                                                             | `SOURCE_VERIFIED` locally; host-dependent timing           |
| 1a  | API start-to-ready, first response                                                                                               | median ready 4,128 ms, first catalogue read 25 ms (contended host)                                                                                                                                      | measured, `HOSTED_PENDING` for a trustworthy figure        |
| 1b  | First useful UI, route transitions                                                                                               | existing hosted workflow `startup-performance.yml` (PR #154 harness); R27 adds no app change, so its PR run is the baseline for 059c018                                                                 | `HOSTED_PENDING` (PR CI)                                   |
| 1c  | Bundle transfer and parse cost                                                                                                   | bytes: shell 178.1 KiB br, per-journey table in FINDINGS §1; parse time from hosted runs only                                                                                                           | bytes `SOURCE_VERIFIED`; parse time `HOSTED_PENDING`       |
| 1d  | Hot database queries                                                                                                             | `query-profile-baseline.json`                                                                                                                                                                           | `SOURCE_VERIFIED` (counts and plans)                       |
| 2   | Eager imports and large bundles (admin/pdf/maps/role screens); exact-file patch before editing                                   | recharts in all admin routes, leaflet in seeker home; pdfjs already lazy; MUI unused; motion and socket.io in shell. CR-R27-01/02 with exact patches, measured via overlay                              | `INTEGRATION_PENDING`                                      |
| 2a  | No blind chunk splitting, no warning-limit change, no artificial delay                                                           | none made; Vite's >500 kB warning is pre-existing and left visible                                                                                                                                      | met                                                        |
| 3   | List profiling: query count, pagination, eager loading, plans, missing indexes                                                   | 17 reads at 144 → 43,344 bids; N+1 (admin users, CR-08); whole-table bid count (CR-05); missing index (CR-06); cursor walks with no duplicates                                                          | `SOURCE_VERIFIED`; fixes `INTEGRATION_PENDING`             |
| 3a  | No ledger or amount rewrite; indexes via the migration lane                                                                      | CR-06 is an index request only; no money table cloned or touched                                                                                                                                        | met                                                        |
| 4   | Cache keys, invalidation, stale role, public vs private, no cross-user leak                                                      | 13/13 negatives pass (cross-user, cross-role, ETag replay, post-logout); query keys role-namespaced; session-end purge and cross-tab boundary located; 16/17 private reads lack `Cache-Control` → CR-04 | negatives `SOURCE_VERIFIED`; CR-04 `INTEGRATION_PENDING`   |
| 5   | R37 workload profiles; proposed budgets with owner approval; p50/p95/p99, errors, CPU/memory, dataset provenance                 | `WORKLOAD_PROFILES.md` (N, B, R, U, F); `budgets.proposed.json` (`PROPOSED_AWAITING_OWNER_APPROVAL`); percentiles reported only where the sample allows (median-only at n=6)                            | design done; budgets **awaiting owner**                    |
| 6   | Only measured high-value repairs, through delegated paths                                                                        | 8 CRs, none applied on the branch                                                                                                                                                                       | `INTEGRATION_PENDING`                                      |
| 7   | Clean-build regression evidence: no stale Vite config, TS output, Prisma client or duplicate API                                 | fresh worktree and frozen install; Prisma generated in-lane; bundle built to a new temp dir per run; API port probe refuses a second process; lane DB recreated by script                               | met for this lane                                          |
| T1  | Repeated cold/warm runs; baseline vs after comparison                                                                            | boot ×6; bundle baseline vs overlay                                                                                                                                                                     | partial: time comparisons for the CRs are `HOSTED_PENDING` |
| T2  | First-load and authenticated route smoke, AR/EN, mobile/desktop                                                                  | not run by R27 (no app change on this branch); required on the integrated candidate with CR-01/02                                                                                                       | `NOT_RUN`                                                  |
| T3  | Query plans with realistic fixtures; bounded-query-count assertions                                                              | plans at 10k/43k/5k rows; statement count bounded across 300× growth for 17/17; page-size probe implemented, local run blocked                                                                          | partial, `BLOCKED_HOST` for the probe                      |
| T4  | Cache authorization negatives                                                                                                    | 13/13 pass                                                                                                                                                                                              | `SOURCE_VERIFIED`                                          |
| T5  | Graceful overload                                                                                                                | production throttle returned 429 (not 5xx) once the boot probe exceeded 100 req/min; API kept serving after the Redis reset. Not a designed overload test; profile B is designed for R37                | observed only                                              |
| T6  | Artifact provenance and confidence limits                                                                                        | every report: commit, tree, dirty paths, lockfile sha256, host, toolchain; API artifact sha256                                                                                                          | met                                                        |
| CI  | Final-PR CI, CodeQL, secret scan                                                                                                 | PR Draft                                                                                                                                                                                                | `HOSTED_PENDING`                                           |

## Exit criteria

| Criterion                                                                        | State                                                                                                                                  |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| "Measured regressions repaired with approved budgets and reproducible harnesses" | **Not met by this lane alone.** Harnesses are reproducible, but repairs are CRs awaiting integration and budgets await owner approval. |
| "No unsupported performance percentage or universal latency promise"             | Met. Only byte reductions are stated as percentages.                                                                                   |
| "Hosted capacity is closed by R37"                                               | Unchanged.                                                                                                                             |
