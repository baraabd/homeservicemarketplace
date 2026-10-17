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
