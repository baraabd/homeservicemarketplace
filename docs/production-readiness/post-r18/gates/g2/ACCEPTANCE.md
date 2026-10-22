# G2 — Acceptance evidence

## Current scope

This successor is implemented on the owner-merged base `96e92825f9b65cf124317f43b55ce42fc97f5b49` (tree `68f4e926eabeb37bb70382c62b75272cf67bd02c`). New-source integrated acceptance remains pending until the published candidate's required workflows and artifacts are independently verified. The active machine manifest is authoritative; historical PASS labels cannot release a wave.

## Executed local checks

All package commands use task-local Node **24.21.0**, pnpm **10.32.1** and Prisma **6.12.0**.

| Command / scope                                                                                                                                                                                                                                 | Observed result                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile --store-dir /tmp/hsm-g2-pnpm-store --reporter=append-only`                                                                                                                                                      | Exit 0; 1,166 packages, six workspaces; normal hooks/lifecycle; lockfile unchanged.                                                                                                                                                                      |
| `pnpm --filter @homeservicemarketplace/database generate`                                                                                                                                                                                       | Exit 0 on scoped network retry; native engine verified by the repository guard. Initial restricted attempt exited 1 and did not write a completion record.                                                                                               |
| `pnpm --filter @homeservicemarketplace/database migrate:deploy` with private task database environment                                                                                                                                          | Exit 0; all 72 existing migrations applied to the new empty database. No reset/seed.                                                                                                                                                                     |
| Focused API repository/service tests                                                                                                                                                                                                            | 9 suites, 122 tests passed, zero failed; this earlier focused run preceded the final cursor/schema correction. The final full API and PostgreSQL results below cover the corrected source.                                                               |
| `node --test --test-isolation=none .github/scripts/r27-acceptance.test.mjs scripts/perf/post-r18/lib/*.test.mjs`                                                                                                                                | Exit 0; 118 tests passed, zero failed/skipped/todo. Scoped local socket permission was needed for the existing listener test.                                                                                                                            |
| `pnpm --filter @homeservicemarketplace/api build`                                                                                                                                                                                               | Exit 0.                                                                                                                                                                                                                                                  |
| `pnpm --filter @homeservicemarketplace/api lint`                                                                                                                                                                                                | Exit 0.                                                                                                                                                                                                                                                  |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                                                                                                                                                                           | Exit 0.                                                                                                                                                                                                                                                  |
| `pnpm --filter @homeservicemarketplace/api test --maxWorkers=2 --json --outputFile=/tmp/hsm-g2-verification/api-unit-final.json`                                                                                                                | Exit 0; 267 suites and 4,885 tests passed, zero failures. 92 existing service-gated suites / 1,743 cases remain pending in this unit invocation; these are not counted as passing. Validation-only environment matches the repository unit-job contract. |
| `pnpm --filter @homeservicemarketplace/api exec jest --runTestsByPath test/integration/r27-read-projections.integration.spec.ts --json --outputFile=/tmp/hsm-g2-r27-read-projections-results.json` with the private task PostgreSQL environment | Exit 0; 27 tests passed, zero failed/skipped. Covers limits 5/20/100, original Prisma equivalence, nulls/ties/deletions/foreign or stale cursors, transaction visibility/rollback, configured-schema isolation and bounded query counts.                 |
| `pnpm security:audit`                                                                                                                                                                                                                           | Exit 0; full dependency tree reports zero info/low/moderate/high/critical findings. This is not the repository-wide CodeQL alert inventory.                                                                                                              |

## Final local record and ownership validation

All 63 changed files are named in the recorded exact leases. Scoped Prettier,
coordinator/performance-script ESLint and `git diff --check` exited 0. The full API
lint result is listed above. The following existing validators each exited 0:

- `node .github/scripts/production-governance.mjs`
- `node .github/scripts/release-baseline.mjs`
- `node .github/scripts/sprint-registry.mjs`
- `node .github/scripts/g2-record.mjs --check`
- `node .github/scripts/g3-record.mjs --check`

The explicit negative checks `g2-record.mjs --ready R29` and
`g3-record.mjs --ready R34` each exited **1**, as required by the current holds.
Original budgets, comparator, budget evaluator, dependency lockfile and retained
R32 prompt were byte-compared against the execution base and remain unchanged.

## Meaningful failures retained

- The initial R27 harness run under the restricted sandbox failed the local listener and subprocess fixtures. Running the unchanged suite with scoped approved execution resolved those environmental failures. No assertions were removed.
- The first API typecheck found two mapper consumers of the narrowed list projection. A recorded two-file annotation-only lease corrected their types; subsequent scoped typecheck and lint passed.
- The first real PostgreSQL equivalence run executed 26 cases: 23 passed, three failed. Two failures identified original provider-cursor eligibility semantics that must be preserved; the third was a synthetic fixture violating the existing active-bid uniqueness constraint. Corrections retain both the cursor contract and database constraint. The final unchanged-constraint rerun passed all 27 cases with zero failures/skips; the extra schema-isolation case also passed.
- The first full unit invocation exited 1: 4,873 assertions passed, but three suites could not initialize without the existing environment validator's `DATABASE_URL` and `JWT_ACCESS_SECRET`. The rerun supplied validation-only values following `.github/workflows/reusable-verify.yml`; all 267 enabled suites and 4,885 tests passed. No assertion, service guard or timeout changed.
- Independent review found missing pnpm-cache opt-out in the new Node-only acceptance job and missing session-assignment enforcement in Wave 3 readiness. Both are corrected before publication. A temporary active-index status mismatch is corrected without changing the historical G1 start contract.
- Historical R27 PR #181 artifacts retain four failed statement ceilings and an `incomparable lockfileSha256` comparison. They remain historical and are not substituted for this successor's measurements.

## Required new-source evidence

The final review requires complete exact-head CI and the independent GitHub Advanced Security result; independently reconstructed source artifact tree; R25 real two-replica/Redis/browser recovery; R26 boundary evidence; R28 Linux/Windows configuration controls; and comparable R27 artifacts with all original candidate budgets and the complete browser matrix. Screenshots must be inspected before they are called visually verified.

Source verification, local component correctness, integrated sandbox acceptance, hosted acceptance and release approval are separate states. R28 can satisfy its G2 **configuration-only** option while the explicit hosted blocker remains. Production/live-money/merge/deployment authorizations remain absent.

## CI discovery qualification

The existing `ci.yml` integration job sets `RUN_DB_INTEGRATION=1`, provisions PostgreSQL 16 and Redis, and runs the complete API suite without a path filter. The new projection integration file matches the existing Jest roots/regex and is included in its retained `g1-api-report.json`. The reusable static/unit job intentionally does not set that flag. This source inspection establishes discoverability; the candidate run must still execute successfully.

## Source-artifact correction verification

The two wrong-source/tree negative tests failed before the validator repair, reproducing the missing binding. After correction, 14 focused cases and all 464 governance cases passed with zero failures/skips. `sourceArtifact.sourceSha` and `.treeSha` must match the candidate; positive artifact/run identifiers and both archive digests are required. This remains a consistency guard; independent download/hash/tree verification is still required.

## Superseded first publication

PR #183 first published `6c7aac2ea68ee4943d60b0db3be33012d572ac8d`. Independent review found a missing candidate source/tree comparison in the canonical archive-proof check. Corrective source and negative tests stay on this PR. Completed first-head results are not promoted to the corrective head; final acceptance requires fresh exact-head evidence. The configured PostgreSQL fixture has been stopped successfully after its local tests.
