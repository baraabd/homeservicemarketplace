# R19 — Acceptance

State: **SOURCE_VERIFIED (local) · INTEGRATION_PENDING · POLICY_BLOCKED for
live use.** No hosted or sandbox evidence exists, and none is claimed.

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

Two defects in R19's own suite were found by the sabotage run and fixed:

- an amount check matched digits inside a cuid;
- an overlap check accepted a uniqueness error in place of the overlap
  refusal.

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
