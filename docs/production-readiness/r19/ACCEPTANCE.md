# R19 — Acceptance

State: **SOURCE_VERIFIED (local) · INTEGRATION_PENDING · POLICY_BLOCKED for
live use.** No hosted or sandbox evidence exists, and none is claimed.

## CR-004 corrective verification (2026-10-15)

The owner approved the eight-file continuation and corrective R19 PR after
PR #159 had merged. The correction is now applied to the existing source;
the tests below use the normal API Jest runner and published workspace
contracts, not the earlier isolated candidate mapping.

Source identity: original wave base
`059c018576a75837d4dfb262ee49168d9217d881`; corrective parent and branch-start
merge base `fcdf1deb1a34044b9253ebac8e0e308a69e7a667`; parent tree
`809ffede1b03d3e53241aea2e3a6d01134c6fde0`. Final corrective SHA/tree and CI
run/artifact IDs are recorded in the corrective PR, avoiding a self-referential
commit. Inspected develop was `af662586a640e41d8438d0cb2dd69e8cbb0e172a`.

Environment fingerprint (no secrets): Linux x64, Node 24.21.0, pnpm 10.32.1,
Prisma 6.12.0; independent clone/node_modules/generated output. Node release
SHA-256 and repository-pinned pnpm SHA-512 were verified before use. Tools are
task-local; no machine-wide version changed. No user `.env`, payment credential
or working database was copied/used. No local Docker/PostgreSQL/psql/Redis
infrastructure is available. No database reset, migration or network payment
was performed.

Commands run from the repository root, each with its exit status checked:

| Command                                                                                                                                                                                                       | Executed result                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `node scripts/runtime/toolchain.cjs`                                                                                                                                                                          | PASS, exit 0                                                                           |
| `pnpm install --frozen-lockfile`                                                                                                                                                                              | PASS, exit 0; lockfile unchanged; hooks enabled                                        |
| `pnpm --filter @homeservicemarketplace/api test --runInBand src/modules/money test/unit/r19-money-wire.spec.ts test/unit/r19-money-contract-fixtures.spec.ts test/unit/r19-canonical-json-regression.spec.ts` | PASS, 8 suites / 96 tests, 0 failed, 0 skipped                                         |
| `pnpm --filter @homeservicemarketplace/api exec jest test/unit/r19-canonical-json-regression.spec.ts --runInBand`                                                                                             | PASS after the sparse-fixture lint correction: 1 suite / 15 tests, 0 failed, 0 skipped |
| `pnpm exec eslint packages/contracts/src/money/wire.ts apps/api/test/unit/r19-canonical-json-regression.spec.ts`                                                                                              | PASS, exit 0                                                                           |
| `pnpm --filter @homeservicemarketplace/api lint`                                                                                                                                                              | PASS, exit 0                                                                           |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                                                                                                                                         | PASS, exit 0; database/contracts builds included                                       |
| `pnpm --filter @homeservicemarketplace/api build`                                                                                                                                                             | PASS, exit 0; database/contracts and Nest builds included                              |

The 15 regressions cover reserved bigint tags, sparse/nested/extended arrays,
symbol/hidden properties, getters without side effects, precision/key ordering,
valid confirmation byte compatibility and repeated non-cyclic references.
Existing tests were preserved. No timeouts, worker limits for real-service
concurrency suites, assertions, security budgets or skips were changed.

Initial local ESLint reported `no-sparse-arrays` for the deliberately sparse
test literal. The fixture now constructs the same gap with `new Array` and
`Object.assign`; the rule remains enabled and all 15 regressions pass.
Retained existing warnings: pnpm's configured ignored build scripts for
`@parcel/watcher`/`unrs-resolver`, and ts-jest's deprecated isolatedModules option.

**Remote evidence gate:** CI/CodeQL/security and real R15/R19 PostgreSQL tests
must be checked on the final corrective head after push. Prior green checks
below do not validate new code. The PR stays Draft while required evidence or
G1 integration closure is missing. No local real-DB/Redis, browser, migration
rehearsal, sandbox or hosted run is claimed. No UI changed.

## Prior-head CI independently verified on 2026-10-15

This supersedes the historical "CI on the PR head not yet verified" note for
the original PR #159 only. These runs were read, not rerun during verification.

- R19 head `fcdf1deb1a34044b9253ebac8e0e308a69e7a667`: 31 successful check
  records / 29 distinct named checks (repeated governance runs), including
  CodeQL and dependency/secret/container scans.
- [Real-service job 115567909627](https://github.com/baraabd/homeservicemarketplace/actions/runs/38475791098/job/115567909627):
  301 suites passed / 9 skipped; 5,646 tests passed / 38 skipped. The log includes
  R15 ledger, R19 subscription-money, wire and fixture suites as PASS.
- Merged develop `af662586a640e41d8438d0cb2dd69e8cbb0e172a`: 28/28 successful
  checks. [Real-service job 115806369405](https://github.com/baraabd/homeservicemarketplace/actions/runs/38549121757/job/115806369405):
  323 suites passed / 13 skipped; 5,983 tests passed / 88 skipped.

Those test totals describe the full API integration jobs, not R19 alone.
The actual original R19-head Git tree is
`809ffede1b03d3e53241aea2e3a6d01134c6fde0`; a historical PR-body tree value
was stale. CR-003 is APPLIED in the coordinator registry. G1 remains pending.

## Historical implementation-session evidence

## Local environment (2026-10-14)

Windows 11 and Node 24.21.0; pnpm 10.32.1 from the frozen base.

- The lane's own disposable containers: `hsm-r19-pg` (PostgreSQL 16-alpine,
  `127.0.0.1:55110`) and `hsm-r19-redis` (`127.0.0.1:55111`).
- Databases: `r19` (migrated and seeded, then upgraded), `r19_empty` (empty
  then migrated), `r19_shadow`, `r19_sabotage`, `r19_cr001`.
- No `.env` was copied, and no shared or user database was used.

## Commands and results

| #   | Command (from `apps/api` unless noted)                                                                                                        | Result                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | Baseline before editing: `npx jest src/modules/money test/integration/r15-ledger.integration.spec.ts --runInBand` (`RUN_DB_INTEGRATION=1`)    | 6 suites, 95 tests passed                                                                                                     |
| 2   | `packages/database`: `npx prisma validate`, then `prisma migrate diff --from-migrations … --to-schema-datamodel …` after adding the migration | valid; empty migration (no drift)                                                                                             |
| 3   | `packages/database`: `npx prisma migrate deploy` on an empty database and on an upgraded seeded one                                           | both applied                                                                                                                  |
| 4   | `packages/database`: `pnpm verify:migrations` (`ADMIN_DATABASE_URL` on the lane's server)                                                     | ALL CHECKS PASSED (106 s)                                                                                                     |
| 5   | `npx tsc --noEmit -p tsconfig.json` (covers `src/` and `test/`)                                                                               | exit 0                                                                                                                        |
| 6   | `npx jest test/unit/r19-money-wire.spec.ts test/unit/r19-money-contract-fixtures.spec.ts`                                                     | 23 passed                                                                                                                     |
| 7   | `npx jest test/integration/r19-subscription-money.integration.spec.ts --runInBand` (real PostgreSQL), two consecutive runs                    | 18 passed, then 18 passed                                                                                                     |
| 8   | Sabotage: the same suite on `r19_sabotage`, with `MoneyRefund_guard` and `SubscriptionPeriod_insert_guard` dropped                            | 3 failed (the refund-cap, partial-compensation and overlap cases), 15 passed; exactly the cases that depend on those triggers |
| 9   | `npx jest test/integration/r15-ledger.integration.spec.ts --runInBand` on the database shared with R19 rows, after CR-001                     | 37 passed                                                                                                                     |
| 10  | R15 no-backfill case on `r19_cr001` with one non-fixture ledger account inserted                                                              | failed as intended (found 1 foreign account)                                                                                  |
| 11  | Compile-time contract binding: one key removed from a fixture key set                                                                         | `tsc` exit 2 on that file (restored afterwards)                                                                               |

| 12 | CI on `f3a7c6b`: integration job (outbox consumer suite claimed R19's pending activation events) and security job (gitleaks: one synthetic fixture idempotency key) failed | fixed: R19 takes the `outbox` advisory lock (shared) and removes its own events; fixture keys changed and one reviewed fingerprint added (`docs/security/gitleaks-historical-baseline.md` §9) |
| 13 | `npx jest test/integration/outbox.integration.spec.ts test/integration/r19-subscription-money.integration.spec.ts test/integration/r15-ledger.integration.spec.ts --maxWorkers=3`, two runs | 76 passed, then 76 passed (parallel, one shared database) |
| 14 | local gitleaks 8.24.3: PR history range with the new entry; the current R19 tree; a fresh-repository canary | exit 0; no leaks; canary detected (exit 2) |

Two defects in R19's own suite were found by the sabotage run and fixed:

- an amount check matched digits inside a cuid;
- an overlap check accepted a uniqueness error in place of the overlap
  refusal.

Two more were found by CI and by the parallel run, and fixed: R19 left pending
outbox events for the queue-consumer suite to claim, and asserted zero ledger
grants while R15's fixture role legitimately holds them during its run.

## Required behaviors and where each is proven

| Requirement                                                                     | Test                                                                        |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| R15 hermetic and real-PostgreSQL suites unchanged and passing                   | commands 1 and 9 (the only change is CR-001)                                |
| Precision, overflow and invalid currency                                        | `r19-money-wire.spec.ts`                                                    |
| Duplicate and altered-payload idempotency                                       | R19 suite: "replay … altered payload"                                       |
| Concurrent confirmation and period uniqueness                                   | R19 suite: 5 identical and 5 distinct concurrent confirmations              |
| Constraint violations through direct SQL                                        | R19 suite: three raw-SQL cases plus refund-transition SQL                   |
| Fault injection before audit or outbox commit                                   | R19 suite: outbox and audit failures roll back everything; a retry succeeds |
| Full reversal versus partial compensation                                       | R19 suite: partial compensation case                                        |
| Migration from empty and upgraded databases; expand-only                        | commands 3 and 4; R19 suite: "expand-only"                                  |
| No permission granted by the new models; no booking revenue posted; no backfill | R19 suite: "introducing the models …"                                       |
| Producer and consumer fixtures without provider credentials                     | `r19-money-contract-fixtures.spec.ts`                                       |

## Not yet verified

- CI on the PR head: the integration job runs the R19 and R15 suites
  together; the Verify jobs run typecheck and lint. Required before any
  acceptance claim.
- Wave 1 gate (G1): integration with lanes R20–R23, which are not defined.
- Hosted or sandbox execution: none (no rail, no target).
