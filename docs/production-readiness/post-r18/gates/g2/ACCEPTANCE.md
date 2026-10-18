# G2 — Acceptance evidence

**Current gate: BLOCKED; review preparation in progress.** Source identity and mandatory evidence states are controlled by `SOURCE_MANIFEST.json`; executed checks and their provenance are in `ACCEPTANCE_EVIDENCE.json`. No R32 implementation, hosted acceptance or release acceptance is claimed.

## Baseline that required repair

Combined develop `4e87bf03663fb3c72ffee983fdb70c2863e1ce8a` / tree `eaca9cdeab15e719570f7997c4fc3bbeb64e562e` failed R25 browser acceptance and R18/CI aggregates in run 39062646647. Artifact 12111448781 has SHA256 `1ce6534f4377fad0e3c6a8177b05ff09389a30693bc402be634b1843f84798a6`; its 13 API cases passed, but the browser command exited 1. No unexposed remote diagnostic is inferred.

A clean isolated local checkout at that exact source also passed all 29 harness cases and 13 real API cases, then failed the browser's initial fixture at seeker OTP verification (HTTP 400 instead of 200). Its attempt is `20261017202439731-066c4539`. This is retained as a failed local reproduction; it is not final candidate acceptance or proof that the remote failure has the same cause.

## Initial scoped source checks

Before assembling a committed G2 candidate, the four governance files passed 218 cases; R28 plus unchanged staging/runtime controls passed 186 cases (91 new R28, 95 existing); MoneyModule passed nine cases and the actual API TypeScript/port consumer checks passed. The provisional R28 validator was subsequently strengthened to101 tests, then superseded wholesale by the owner's independently published #179 delivery. These were explicitly uncommitted source checks. They must not be relabeled as checks of the initial develop SHA or the future final PR head.

The frozen install used Node 24.21.0 and pnpm 10.32.1, including original preinstall and prepare hooks. Initial incomplete runtime extraction, read-only Prisma cache and sandbox EPERM child-process failures are environmental attempts, not passing results. They were resolved through the approved bounded execution context; no hook, assertion, timeout or dependency pin was weakened. Chrome/Headless/FFmpeg use the exact Playwright versions; a failed CDN HTML response was rejected and the same Chrome release was obtained from Google's official distribution.

## Required final evidence

Run the original applicable repository formatting/lint/type/unit/build scripts, database migration validation/drift, money contract and real-service tests, original R25 full harness, complete candidate/baseline R27 workflow, current R26/security coverage, all required PR CI/CodeQL and source-provenance artifacts. Use latest attempt/head identities, retain failures/skips and distinguish component tests from real rails. Public records contain no secrets, OTPs, private media, raw environment or raw session traces.

The selected R28 checker proves only CONFIGURATION_ONLY and reports authorizationVerified:false and deploymentStarted:false even for complete synthetic declarations. The earlier e91c delivery passed455/455 tests (342 R28,95 staging/runtime,18 storage) with exact peer blobs. Its descendant60b64cd adds a descriptor-reader security correction and two regressions; the new exact source is selected, and its executed results are recorded separately below and in acceptance evidence. The unselected template retains9 blocker groups and6 hosted-check descriptions; --require-target correctly exits2. Hosted resource approval, real TLS/network/database grants, delivery/storage/scanning and backup/restore evidence are outside that PASS scope and remain held.

## Owner review boundary

R27 budgets remain the committed proposals until an explicit evidence-backed decision. The review package must state measured counts, plans, datasets, page sizes and timing confidence, along with any current mutable-cursor limitation. A gate must remain blocked if the required performance decision or combined candidate evidence is missing. Only the verified owner-approved publication releases the planned R32 lane.

## Supported full local API and dependency verification

The complete supported API run passed6,506 tests with zero failures across343 passing suites on a dedicated PostgreSQL16 UTC cluster, authenticated Redis and Mailpit. All72 migrations and the seed passed. An actual Prisma-created child database also used UTC. The81 explicit skips cover40 MinIO/S3,29 external retention,6 independent-worker and6 browser cases; their separate required workflows remain outstanding. Earlier non-UTC diagnostics are retained, and hosted app/worker/pool UTC sessions remain a verification prerequisite. Full and production dependency audits both reported zero findings at every severity. These are local assembled-source results, not replacement final-head CI acceptance.

## Selected R28 correction verification

Exact peer60b64cd source passed457/457 tests:344 R28,95 existing staging/runtime and18 existing storage, with zero failures or skips. Both CJS syntax checks, strict ESLint and Prettier on all12 peer paths passed. Default --check exited0; --require-target correctly exited2. All12 peer Git blobs were unchanged before and after these checks. The unchanged plan fingerprint remains configuration evidence only; official final-head CodeQL must evaluate the actual corrected reader bytes.

## Initial published-source verification and required successor

PR #180 initially published source `736208b70c211c5c1fe931f0a2f0f37c4d55d529`, tree `8e781fed05ab93da39b5c4e3e286a67550d2d7d6`. The original R25 harness passed both locally and in official CI:13 real API tests and1 complete browser scenario, zero failures/skips/flakes, with the original assertions and timing limits. Local source stayed clean throughout. The official summary is artifact12115223637 in run39071261819. Source-provenance artifact12115450794 independently matches the Git head, tree, tracked-file manifest and complete archive.

Official R04 passed21 PostgreSQL cases and7 real browser/SMTP phases; R26 passed9 database/authorization cases,30 adversarial CSP cases and2 actual browser cases without skips or flakes. These source-qualified results remain isolated CI evidence.

The same source exposed one Windows-only fixture failure in the R28 controls (438/439) and three synthetic idempotency-identifier scanner findings. The portable fixture correction retains real descriptor identity, zero reads and exact closure; the earlier reader still fails its strengthened assertion. The corrected fixture and existing staging/runtime/storage controls pass all 457 local cases without skips. The unchanged runtime reader and eleven other R28 files remain the exact selected peer blobs.

The three scanner findings completed individual classification under the existing historical-fingerprint policy. The source now generates those compile-time idempotency inputs with `randomUUID()` while retaining all seven negative transaction controls. Exactly three commit/path/rule/line fingerprints are added, preserving all 23 prior entries. Pinned Gitleaks 8.24.3 reproduces all three original findings, then reports zero findings on the same published history range with the reviewed entries and on a complete private corrected snapshot. Generated generic-key and GitHub-PAT canaries outside the repository remain blocking. The review is delegated coordinator review, not independent human security approval; its bounded provenance and incomplete all-ref search are documented. The final assembled commit and its remote checks must be scanned separately.

Official CodeQL analysis passed, and the independent GitHub Advanced Security check (app 57789, check 117509813623) reports success with zero annotations. Its verified SARIF artifact contains zero results, successful execution and no warning/error diagnostics. Linux staging controls pass 439 cases and the packaged image boundary passes; the Windows fixture failure correctly leaves that initial aggregate red. The complete initial CI has 16 successful jobs and three failed jobs: the security scan and its R18/CI aggregates. Both corrective slices require a fresh published successor; earlier green checks are not transferred to it.

## Initial guarded R27 measurement and owner proposal

Run 39071261866 passes both real Docker-verified baseline and candidate jobs. Source, tree, shared harness, lockfile and populated dataset are verified for both artifacts. All 64 browser cases and both sets of 106 helpers pass without reported failures or skips. The comparator has 48 complete paired groups; all 24 candidate authority reports match the source and their expected outcomes. The populated financial walk returns 1,626 distinct completed bookings over 82 pages with exact ordered database truth, monetary and ledger preservation, and a restored fixture. PostgreSQL selects the candidate's exact valid/ready/live index in its default generic and bound plans.

The unchanged budget evaluation still fails four candidate statement ceilings. `DECISION.md` contains the concrete 6/13/12/9 proposal, query accounting, unmeasured parameter variants, bundle tradeoffs, mutable-cursor limitations and hardware/sample qualifications. Measurements alone do not record owner acceptance. Final-source evidence and owner review remain required for G2.
