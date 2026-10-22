# R30 — prerequisite acceptance evidence

**R30 runtime: NOT_IMPLEMENTED / G2_BLOCKED.** This PR prepares conditional R30
registration and an explicitly leased G2 query-performance prerequisite repair.
It does not claim receipt, review, payment, activation, refund, hosted or live
acceptance. Required checks still running or not yet run are identified below.

## Source and scope

- Fresh branch base: `96e92825f9b65cf124317f43b55ce42fc97f5b49`.
- Base tree: `68f4e926eabeb37bb70382c62b75272cf67bd02c`.
- Branch: `feat/r30-manual-payment-review`; one English Draft PR.
- Approved G2 execution base/tree: absent; no frozen source was fabricated.
- Final source commit/tree and remote run/artifact IDs: to be recorded in the
  published PR body after normal hooks and actual checks, avoiding a self-hash.
- Exact write leases: `OWNERSHIP.md` and the G2 coordinator's ownership record.

The first October 22 source checkpoint below became published commit
`1a319133d387dd6747bfd412503f4458573cf10e`, tree
`af041d3817c8ae0aaeab2b6b8833380b44540cb3`. Its results are retained history
for the measured follow-up. Successor source requires its own checks and
artifacts; neither October 18 results nor this first head prove a later head.

## First-candidate preparation checks

| Command/evidence                                                              | Actual result                                                       | Scope                                                                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                                              | PASS, exit 0                                                        | Exact Node 24.21.0 / pnpm 10.32.1; normal prepare hooks/contracts build; lockfile unchanged.                       |
| `pnpm --filter @homeservicemarketplace/database generate`                     | PASS, exit 0                                                        | Guarded Prisma 6.12.0 client generation; not database/application proof.                                           |
| `pnpm security:audit`                                                         | PASS, exit 0; zero vulnerabilities in every severity                | Complete dependency graph at the pinned lockfile.                                                                  |
| `pnpm security:audit:prod`                                                    | PASS, exit 0; zero vulnerabilities in every severity                | Production dependency graph at the pinned lockfile.                                                                |
| `node --test .github/scripts/*.test.mjs`                                      | PASS, exit 0; 340 passed, 0 failed, 0 skipped                       | Includes the supplied R30 package and its held/inconsistent-base cases.                                            |
| Registry, G2 consistency, repository governance and release-baseline commands | PASS, all exit 0                                                    | Exact future ownership and existing blocked-gate rules.                                                            |
| `node .github/scripts/g2-record.mjs --ready R30`                              | Expected refusal, exit 1                                            | R30 remains unauthorized to start while G2 is blocked.                                                             |
| `node scripts/production/platform/validate-plan.cjs --check`                  | PASS, exit 0                                                        | Existing checked R28 plan; hosted blockers remain.                                                                 |
| Isolated PostgreSQL migrations and test seed                                  | PASS, both exit 0                                                   | Existing repository schema only; task-owned native PostgreSQL, no R30 migration.                                   |
| `pnpm --filter @homeservicemarketplace/api lint`                              | PASS, exit 0                                                        | Complete API source lint; changed integration test also passed scoped ESLint.                                      |
| `pnpm --filter @homeservicemarketplace/api typecheck`                         | PASS, exit 0                                                        | Complete API TypeScript check with existing dependency builds.                                                     |
| Full default API suite with existing CI placeholder environment               | PASS, exit 0; 4,873 passed / 0 failed / 1,750 service-gated skipped | 265 passing suites / 92 skipped. Skipped real-service cases are not claimed as passes.                             |
| `pnpm --filter @homeservicemarketplace/api build`                             | PASS, exit 0                                                        | Database/contracts dependency builds and Nest production build.                                                    |
| Real PostgreSQL equivalence                                                   | PASS, exit 0; 34 passed, 0 failed, 0 skipped                        | Actual SELECT counts, prior Prisma cursor/DTO parity, nullable relations and configured schema; native G2 fixture. |
| Unchanged R27 reports and budget evaluator                                    | FAIL, exit 1; 50 passed / 2 failed                                  | Counts 5/10/7/3 pass; two large ServiceRequest scans require the follow-up below.                                  |
| Precommit changed-file Gitleaks snapshot                                      | PASS, exit 0; no leaks in the initial 32-file snapshot              | Preliminary only; the final committed tree is scanned separately after normal hooks.                               |
| Tracked-source Gitleaks                                                       | PASS, exit 0; zero findings                                         | Exact first-candidate tree: 2,640 files, 23,079,110 scanned bytes.                                                 |
| First PR CI and official CodeQL                                               | PASS; 11 workflows / 37 checks                                      | Exact first head; official result app 57789, zero annotations, PR182 association.                                  |

Toolchain archives were checksum verified. Node archive SHA-256:
`fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6`.
pnpm tarball SHA-512 matches the exact `packageManager` pin. Existing ignored
build warnings for `@parcel/watcher` and `unrs-resolver` were preserved; no
dependency approval, version switch or hook bypass was used to hide them.

The targeted API command covers the four changed adjacent specifications:

```bash
pnpm --filter @homeservicemarketplace/api exec jest --runInBand --runTestsByPath src/infrastructure/persistence/requests/service-request.repository.spec.ts src/modules/provider/available-requests/available-requests.service.spec.ts src/modules/provider/bookings/provider-bookings.service.spec.ts src/modules/admin/financials/admin-financials.service.spec.ts --json --outputFile=/tmp/hsm-r30-validation/g2-query-projections-unit.json
```

Result: **74 passed / 0 failed / 0 skipped**, exit 0. After sourcing only the
private G2 fixture environment, the real database command is:

```bash
pnpm --filter @homeservicemarketplace/api exec jest --runInBand --runTestsByPath test/integration/g2-query-projections.integration.spec.ts --json --outputFile=/tmp/hsm-r30-validation/g2-query-projections.json
```

Result: **34 passed / 0 failed / 0 skipped**, exit 0. Assertions preserve the
prior Prisma outputs and capture actual repository SELECT counts. A separate
connection configured with `schema=pg_temp` proves the new reads honor the
selected namespace and leave public fixtures unchanged. This is repository
correctness evidence, not the guarded HTTP counts, normalized plan capture or
real browser evidence supplied by the R27 workflow.

The full default suite used the existing `DATABASE_URL` and
`JWT_ACCESS_SECRET` test placeholders from `reusable-verify.yml`, without
enabling real-service gates:

```bash
pnpm --filter @homeservicemarketplace/api test --runInBand --json --outputFile=/tmp/hsm-r30-validation/api-unit-full.json
```

Its first invocation without those required placeholders stopped at the existing
configuration validator. The corrected environment produced the passing result
above; no validator or test assertion changed. The 34 database cases were run
separately against the explicitly identified real PostgreSQL fixture.

## Reproduced failures and isolated database

The first current-record test run after registering R30 reproduced 63 passing
tests and one failure: `R30: inconsistent Wave 3 bases` in the synthetic
accepted-wave fixture. The separately leased fixture correction freezes every
provided package in that in-memory example, keeps R30 held and retains all
existing assertions. The full governance rerun above passes all 340 tests.
Ordinary sandbox execution initially denied required subprocess/socket access;
authorized isolated checks used escalated execution without weakening tests.

The first real PostgreSQL projection run passed 28 cases and failed three
provider cursor equivalence cases. Deleted or status-excluded anchors in the
nullable schedule ordering expose Prisma behavior that a plain inclusive SQL
keyset plus offset does not reproduce. The implementation is corrected against
the unchanged reference assertions; final results appear in the table above.
An earlier unit run also exposed an over-specified nullable city-key test double;
its original default and assertions were restored before the 74/74 targeted
unit rerun. No production filter, budget or assertion was relaxed.

Native PostgreSQL 16.15 was provisioned only for G2 equivalence testing at
`127.0.0.1:54330`, database `hsm_r30_g2_test`, login `hsm_r30_g2_runner`
(non-superuser), OS user `nobody`. SCRAM authentication, data checksums and UTC
were verified; task-owned data/socket/logs are under `/tmp/hsm-r30-postgres`.
The connection comes from a private temporary environment file; no application
`.env` was copied or created. After verifying the exact destination, root ran:

```bash
pnpm --filter @homeservicemarketplace/database exec prisma migrate deploy
pnpm --filter @homeservicemarketplace/database seed
```

No shared database or Redis reset was used. Extracted Ubuntu server/client/libpq
and LLVM packages were verified against signed metadata. A preliminary
metadata-only apt invocation was interrupted after a temporary-config setup
failure; it left partial shared index cache, with no package install or system
configuration change. Later downloads/extraction used only temporary paths.
The cache was intentionally not deleted. This native database is not a claimed
Docker service or a substitute for the existing remote R27 harness.
After the first validation, root verified the process executable, data path and
port, stopped only this task-owned server, and confirmed the PID file was absent
and port 54330 was closed. Temporary data and logs were retained. For the measured
follow-up, root verified the same data identity and unused port before restarting
that server; its scoped tests and final shutdown are recorded separately.

## Measured follow-up

The first published candidate passed functional CI, but the unchanged R27
artifact evaluator exposed two large `ServiceRequest` scans, each estimated at
10,836 rows. `G2_REVIEW.md` records the exact first run, artifacts and digests.
The corrective two-file lease adds a bounded correlated primary-key hydration
lookup and two actual generic-plan regressions. Before changing the production
query, both added tests failed on the prior joins with a 10,217-row request
scan. That isolated red-proof command selected the two new cases; the 34
existing cases were not selected, and none of their assertions was removed.
The analyzed session-local fixture contains 10,217 requests, 6,416 bookings and
42,021 bids, plus small category/profile/user tables. Temporary tables and the
generic-EXPLAIN helper disappear when their single connection closes.

The regression captures the full emitted repository SQL and compares bound
plans with explicit test-side normalized generic plans at page limits 5, 20
and 100. It verifies request access and scans of all large fixture relations.
No planner settings or production schema are changed. This normalization is
labelled as a local test approximation; final R27 native `pg_stat_statements`
plans remain required evidence.

First-head real-service CI passed 6,542 API cases with 81 explicitly gated in
that main command; those gates executed in their dedicated retention, storage,
worker and dispute lanes. Default API CI passed 4,873 with 1,750 service-gated
skips. Web units passed 2,525; general browser coverage passed 836 with 349
declared skips. These counts are evidence of the first source only. Source
artifact, real R25 replica and official CodeQL provenance were independently
verified, but must be recollected for the successor.

The strengthened corrective run passed **36 PostgreSQL cases, zero failures
and zero skips**. All 12 full plans use `ServiceRequest_pkey` with an actual
`id = requestId` equality and estimated rows 1; no large-fixture sequential
scan remains. Small category/user/provider scans are retained and disclosed.
The four affected unit suites passed **74/74**, with no failures or skips.
Scoped ESLint, Prettier, complete API typecheck and production build passed.
The governance rerun passed **340/340**, with no failures or skips; G2 record
consistency passed and `--ready R30` still correctly refused runtime start.

The final database command included
`G2_QUERY_PLAN_REPORT=/tmp/hsm-r30-validation/g2-generic-plans-final.json`
and wrote the Jest report to
`/tmp/hsm-r30-validation/g2-query-projections-final.json`. The latter's SHA-256
is `fd3464828c88ee81b0172a12e4939fe5dcd293b36e262d4d0fc50dba2eed84bd`;
the full 12-plan report is
`1ebdde063d340a05582a045dc45ec447662cadddb9209bc5a42196024b4fb916`.
The existing ts-jest isolatedModules deprecation warning remains; it is not
reported as a warning-free run. After checks, root verified and stopped only
the restarted task-owned server, confirming process/PID-file absence and the
closed port. No test or server process from the source writer remains.

Final-head remote evidence remains pending publication. The PR body records
the actual immutable source/tree, normal-hook and committed-tree secret scan,
actual R27 evaluator/comparator outcome, complete latest workflow/check
inventory and separately identified skips. No first-head green result is
transferred to the successor.

## Comparable R27 evidence

The original G1/candidate measurements remain intact. Their newer PR181 pair
cannot be compared by the unchanged comparator because the owner's security
upgrades changed dependency bytes. A separately leased third `repair-baseline`
job measures the immutable PR base with the final candidate harness and equal
lockfile bytes. `G2_REVIEW.md` records the concrete rationale and guards.
Final evidence must include actual artifacts, evaluator results and comparator
`OBSERVED_COMPLETE_MATRIX` with zero missing groups. A successful workflow or
comparator exit code alone is insufficient. Those final-head observations are
recorded in the PR body after publication, rather than self-identifying here.

Local workflow verification passed all 14 temporary Git-fixture cases using
the workflow's actual inline guards, YAML parsing and a semantic comparison
of the original jobs. The unchanged harness command
`node --test scripts/perf/post-r18/lib/*.test.mjs` passed 106 tests, with no
failures or skips. Scoped Prettier and `git diff --check` also passed.
`actionlint` was unavailable and is not claimed as executed. The only changed
R27 orchestration path is the separately leased workflow; all 30 inventoried
harness, browser and dedicated-test files retain their base bytes.

## Unexecuted R30 product evidence

The 70-path conditional reservation is a future implementation list. No R30
runtime file, schema migration, shared money port, receipt storage permission,
account grant, route, browser fixture or live rail is created by registration.
CR-002 through CR-005 remain unapplied. `VERIFICATION_PLAN.md` records the
required negative, concurrency, rollback, real storage/ClamAV and route checks.
Those tests are **NOT_RUN**, not skipped passes or sandbox acceptance.

R27 original limits are still `PROPOSED_AWAITING_OWNER_APPROVAL`. Passing their
technical evaluator, if demonstrated, does not approve policy or publish G2.
The coordinator/owner must review the concrete exact-source evidence, approve
the relevant budgets and verify accepted publication before the Wave 3 runtime
barrier can be released. Merchant setup, review/retention policy and real
settlement remain separate owner/external requirements.
