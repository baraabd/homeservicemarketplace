# R27 acceptance evidence — 2026-10-17

**IMPLEMENTED / SOURCE_VERIFIED. The disposable real-service and browser
measurements below passed. R27 remains INTEGRATION_PENDING and Draft because
budget approval and coordinator/security/database integration are outstanding.**
G1 is accepted and READY_TO_START. This lane does not accept G2 or a release.

This document is an immutable measurement snapshot for the source identified
below. The final publication SHA/tree and subsequent exact-head checks are in
[PR #173](https://github.com/baraabd/homeservicemarketplace/pull/173); a source
document cannot contain its own future Git commit SHA. Later runs retain their
own source/harness identities and must not be relabeled as this run.

## Source identity and retained artifacts

| Identity                              | Value                                      |
| ------------------------------------- | ------------------------------------------ |
| Assigned branch                       | `feat/r27-performance-capacity`            |
| G1 frozen source                      | `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0` |
| G1 frozen tree                        | `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b` |
| Measured candidate and harness        | `afec37ae717fbdca91a8e23dd5fc76a1cbd2a703` |
| Measured candidate tree               | `be63469144228f3a450ba04c453ecd5b99c2b1ba` |
| Locally tested equivalent tree commit | `b58fd57f02e363be5da49b196e7797c0577fccd0` |
| Integration/publication ancestor      | `0568739096ceeaf0cfc79034626886e258fe4328` |
| Merged G1 coordinator #172            | `07c8e584c684111bfc80995c7efb0144cfb6161b` |

[R27 run 39032727959](https://github.com/baraabd/homeservicemarketplace/actions/runs/39032727959)
completed successfully. Both downloaded ZIPs match their GitHub SHA-256 digests.
Retention is 14 days; expiry is 2026-10-31. Summary findings are preserved in Git;
raw screenshots/reports must be downloaded before expiry or reproduced.

| Artifact  |          ID |   Bytes | ZIP SHA-256                                                        |
| --------- | ----------: | ------: | ------------------------------------------------------------------ |
| Baseline  | 12100808613 | 2740381 | `32a0694c909fb6758402d51acfd7166ec444fa8b43cb8dfd8e70723859503b4b` |
| Candidate | 12100659350 | 3941886 | `eeed7e50d0cbc0badaeba6647af31959170288ce2c3bdded7215b5b24f21bd04` |

Each source has bundle, boot, boot-profile and query JSON plus eight browser
JSON files. There are 16 baseline and 24 candidate PNGs (the latter includes
eight production fault-state captures): 64 retained files overall. All eight
core and sixteen browser JSON identities were checked. Both sides use harness
afec37ae and the same lock/schema/configuration fingerprints in IMPLEMENTATION.

**Hardware caveat:** baseline Intel Xeon Platinum 8573C versus candidate AMD
EPYC 7763; both 4 logical CPUs and 15.6 GiB RAM. Time deltas are hardware-confounded.
Byte reductions, query shapes and the passing behavior matrix remain measured;
this is not a controlled causal latency or production-capacity comparison.

## Exact verification and coverage

| Check                                    | Result and scope                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Local governance tests                   | 160 passed, 0 failed, 0 skipped                                                                                                             |
| Current local performance harness tests  | 37 passed, 0 failed, 0 skipped; one CPU advisory regression added after afec                                                                |
| Local focused API tests                  | 62 passed across five files, 0 failed/skipped                                                                                               |
| Local focused web tests                  | 18 passed across three files, 0 failed/skipped                                                                                              |
| Local build checks                       | Frozen install, Prisma generation, API typecheck/build, web typecheck/build, browser-harness typecheck, lint/format and normal hooks passed |
| Local staged secrets                     | Nonempty 58455-byte scan, no leaks                                                                                                          |
| Local tracked-tree secrets               | 2518 files / 21220825 bytes at b58fd57, no leaks; tree equals afec37ae                                                                      |
| Local R27 committed history              | Three commits / 302849 bytes, no leaks                                                                                                      |
| R27 baseline job 117396308464            | 36/36 harness, 8/8 production browser, 8/8 development browser; no failures/skips                                                           |
| R27 candidate job 117396308375           | 36/36 harness, 16/16 production browser, 8/8 development browser; no failures/skips                                                         |
| Fresh report comparator                  | OBSERVED_COMPLETE_MATRIX, 0 missing groups; source/configuration compatibility passed; CPU limitation retained                              |
| Unchanged proposed budgets               | 47 passed, 4 failed, exit 1; no threshold edits                                                                                             |
| CodeQL at afec37ae                       | [Workflow 39032727973](https://github.com/baraabd/homeservicemarketplace/actions/runs/39032727973) and official result passed               |
| Real PostgreSQL/Redis API CI at afec37ae | Job 117397603820: 333 passed suites / 13 skipped; 6093 passed tests / 81 skipped; boot E2E 3/3 and runtime 8/8 passed                       |
| API unit-profile CI at afec37ae          | 4541 passed / 1633 skipped; this is a different profile, not an additional disjoint total                                                   |
| Web verify CI at afec37ae                | 205 files / 2478 tests passed                                                                                                               |
| Final publication gate                   | Review all latest checks on the exact final PR head; the earlier measurements and local subset do not replace this gate                     |

Current local tests total 277. The CI skip counts are reported explicitly; this continuation introduced no
test skip or assertion reduction. Local and CI suites overlap and are not
summed into one inflated test count.

### Browser scope and screenshots inspected

The 40 browser tests cover 16 timing tests, 16 same-context account-switch tests
and eight candidate production fault tests. Timing is for **seeker and admin**,
not an R27 provider timing claim. Two modes, four language/viewport projects,
two roles and three cache/transition groups produce 48 paired groups with n=3
per side. There are 192 useful-UI observations and 96 keyboard transitions;
browser p95/p99 are not reportable by pooling unlike groups. Chromium is
151.0.7922.34. AR/EN direction, real API responses, keyboard navigation,
post-logout access rejection and saved coordinates are asserted.

The existing separate [Seeker/Provider/Admin startup run 39032728018](https://github.com/baraabd/homeservicemarketplace/actions/runs/39032728018)
also passed on afec37ae, including provider startup; it is separate evidence.

Eighteen screenshots were visually inspected directly, using paths relative
to the corresponding extracted artifact:

- Candidate production: `desktop-en-admin.png`, `desktop-ar-admin.png`,
  `mobile-ar-seeker.png`, `mobile-en-seeker.png` under `browser/production/`.
- Candidate development: `desktop-en-seeker.png`, `desktop-ar-seeker.png`,
  `mobile-ar-admin.png`, `mobile-en-admin.png` under `browser/development/`.
- Candidate production: all four `*-chart-fallback.png` and all four
  `*-map-fallback.png` captures.
- Baseline development: `mobile-ar-admin.png` and `mobile-en-admin.png`.

The captures show localized navigation/content, retained approval controls and
address fields during optional-chunk failure. The same horizontal mobile admin
table presentation exists in baseline and candidate. Screenshots support the
executed behavioral assertions; they are not exhaustive pixel or accessibility
certification. Keyboard/focus, real save/readback and recovery-control presence
come from the passing assertions, including portions outside one capture.

## Requirement-to-evidence matrix

| Requirement                       | Evidence                                                                                                                        | Remaining scope                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Cold/warm boot and first response | Five production-policy boot runs, first catalogue response, readiness/RSS                                                       | OS caches not purged; CPU mismatch; no boot tail or universal latency claim                                                          |
| Bundle transfer/compile costs     | Reproducible 15.74% seeker / 24.70% admin initial gzip reduction; browser transfer and raw compile events retained              | Complete chart journey slightly larger; compile categories overlap; no parse-time sum                                                |
| Real list plans and bounds        | 17 scenarios in two phases, seven page-size probes, full nonempty cursor walks                                                  | Only 15 users/12 provider profiles; financial completed results remain empty                                                         |
| Cache authority                   | Ten asserted negatives pass; three informational conditional-response observations recorded; same-context browser switch passes | 15/17 sampled private reads lack explicit cache directive; cross-tab and active-session role/grant changes need security integration |
| Normal, burst, recovery           | Three n=200 warm closed-loop profiles per source, empirical p50/p95/p99, CPU/RSS/errors                                         | Hardware-confounded; realtime/upload/hosted load belongs to R37                                                                      |
| Default-policy overload           | 100 HTTP 200 / 50 HTTP 429; natural ~60.3-second recovery on both sources                                                       | Admission-control contract, not saturation capacity                                                                                  |
| AR/EN/RTL/mobile/desktop/keyboard | Complete seeker/admin production and development matrix; eight candidate fault cases                                            | Broader integrated route/security acceptance remains coordinator-owned                                                               |
| Clean build/source provenance     | Separate clean checkouts, pinned toolchain, generated Prisma/API/web artifacts and matching source identities                   | Entry main.js digest is not a digest of every compiled API module                                                                    |
| CI/CodeQL/security                | Local applicable checks, completed afec R27/CodeQL and CI jobs above                                                            | Final successor head's complete checks must be recorded in the PR                                                                    |

## Four proposed-budget findings and integration owners

| Proposed check                        | Actual             | Existing proposal        | Owner/action                                                     |
| ------------------------------------- | ------------------ | ------------------------ | ---------------------------------------------------------------- |
| Seeker request statements             | 6                  | 5                        | Owner review of the page-bounded extra aggregation               |
| Provider available-request statements | 13                 | 10                       | Populated-page calibration; frozen/candidate source unchanged    |
| Provider booking statements           | 12                 | 7                        | Populated-page calibration and optional unused-projection review |
| Admin financial bookings large scan   | Booking, 5418 rows | No large sequential scan | Migration owner plus representative completed-booking fixtures   |

No proposed limit, global timeout, guard or existing assertion was relaxed.
The exact 5→6 / 10→13 / 7→12 configuration proposal is reviewable in
[CR-001-integration](shared-change-requests/CR-001-integration.md), but is not
applied or approved. It also specifies the financial index/fixture, cache
policy, empty financial query-ceiling caveat and serialized combined-source
checks. Optional projection directions do not promise an unmeasured result.

## Failed attempts, historical evidence and final states

The earlier [run 38982468755](https://github.com/baraabd/homeservicemarketplace/actions/runs/38982468755)
on 5fe27fd had incomplete production/browser evidence. Its Arabic label and
fixture throttle failures are fixed and the new full matrix passes. The old
artifact IDs were **12081239887 / 12081407762** and expire 2026-10-30.

The first afec governance run 39032728002 started before the PR's Final SHA
field was updated and failed that metadata comparison. Replacement run
39032784285 passed after the field matched. This superseded failure is retained,
not presented as a runtime failure or silently erased.

Main-CI admin review evidence job 117397603878 on afec37ae recorded 14 passed
and one failed test: protected media correction timed out while retrieving a
fixture OTP after POST /auth/login had returned 200 and the OTP form was visible.
The helper exhausted its existing 75 × 400 ms Mailpit poll budget. The cause is
unproven; R27's independent browser matrix passed. This existing shared test,
its timeout and assertions were not changed. The final successor's normal CI
must establish its status; a source-diff observation alone cannot dismiss it.
The completed afec snapshot has 31 successful and three failed latest named
checks: the admin evidence job plus the R18 acceptance and CI gates that
propagate its failure. All other latest workflows, R27 and both CodeQL results
passed. Those historical gate results are not transferred to the successor.

Local failed attempts
and the checksum-label secret-scan false positive are explained in IMPLEMENTATION.

SOURCE_VERIFIED applies to the named source/build/tests. Disposable PostgreSQL,
Redis, SMTP and browser execution passed for the scope above. INTEGRATION_PENDING
covers remaining shared work and combined-wave acceptance; performance budget
approval remains POLICY_BLOCKED. HOSTED_ACCEPTED and RELEASE_ACCEPTED are not
claimed. Existing R16/R18 live-money, payout and verification holds are unchanged.
No merge, deployment or production database operation occurred.

---

## Historical records retained for audit

> **Historical continuation note:** R27 resumed from frozen source
> `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0` after verified owner merge of #171.
> See `ALLOWLIST.md` and `G1_HANDOFF.json`. The earlier report below is historical
> pre-G1 evidence. Its pending statements describe the earlier snapshot;
> the current measurement and acceptance state are recorded above.

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
