# R24 — Acceptance and evidence

**Source state:** IMPLEMENTED / SOURCE_VERIFIED.  
**Integration state:** EXTERNAL_INTEGRATION_PENDING; no sandbox, hosted or release acceptance.  
**Publication:** Draft required. The containing commit/tree, PR URL and actual final-head CI/CodeQL run IDs are maintained in the PR body after publication. No future CI result is claimed here.  
**Canonical coordination:** `READY_TO_START`, execution `IN_PROGRESS`, acceptance `NOT_ASSERTED`.

R24's application boundary, contracts, migration, recovery paths and focused real-service tests are implemented and locally verified. The complete enabled API run finished with one obsolete seed-grant assertion failure; that test was corrected under a recorded lease and passed its focused rerun. The initial full run is retained as FAILED, and no zero-failure whole-suite rerun is implied. Combined-wave acceptance remains the coordinator's decision; merge, deployment, live money and account grants require separate owner authorization.

## Source identity and ownership

| Identity                                              | Full value                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Branch                                                | `feat/r24-money-api-integration`                                                        |
| Frozen G1 runtime / tree                              | `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0` / `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b` |
| Execution start                                       | `07c8e584c684111bfc80995c7efb0144cfb6161b`                                              |
| Ownership checkpoint                                  | `60df8018ea9c76b1cda1c322fb279c7b9d7fde93`                                              |
| Owner-merged develop integrated                       | `21089a5065169b78bea5e711a4839e1a467531dc`                                              |
| Normal merge / integration tree                       | `65b2a0e59604931a4b8b87acb971c71afaaf9a74` / `bf13f28e3c7c21aa6b9f5d418ad2e0ea92a0fb09` |
| Actual R24 source bytes and local artifact digests    | [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json)                                            |
| Final containing commit/tree and final-head CI/CodeQL | PR body after publication, following the repository PR template                         |

The normal merge preserves owner-merged R26/R27 work, imports no unmerged R25 and does not refreeze G1. The change has **39 exact paths: 22 lane files, 15 shared paths under three leases, and two central coordination records**. [OWNERSHIP.md](OWNERSHIP.md), [CR-001](shared-change-requests/CR-001-integration.md) and [IMPLEMENTATION.md](IMPLEMENTATION.md) list the exact scope. The PermissionsGuard/spec extension was recorded at `2026-10-17T16:36:36Z`; the seed-unit extension at `2026-10-17T16:48:10Z`, both before their edits.

## Executed local validation

These are distinct executions. Counts from the focused suites, full run and corrective rerun overlap and must not be summed. Exact commands follow; retained artifact names and SHA-256s are in SOURCE_MANIFEST.json.

| Check                                                                        | Actual outcome                                                                                                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen install                                                               | PASS; no dependency or lockfile changes                                                                                                                                   |
| Prisma validation and guarded generation                                     | PASS on pinned Prisma 6.12.0                                                                                                                                              |
| Fresh migration replay and drift                                             | PASS; 71 migrations applied; empty schema drift with exit-code enforcement                                                                                                |
| Constraint migration verifier                                                | PASS in A/B/C/D: empty database, upgrade/remediation, collision refusal, duplicate-active-bid refusal                                                                     |
| Seed twice on fresh disposable database                                      | PASS; exact six money definitions, zero automatic RolePermission grants, no rows backfilled into the five new tables or intents/confirmations/refunds/ledger transactions |
| Database/contracts/API typechecks                                            | PASS, including full API `tsc --noEmit --incremental false` verification                                                                                                  |
| Database/contracts/API production builds and API lint                        | PASS; API dependency build compiles database/contracts first; dedicated test-file lint/format also passed                                                                 |
| Governance tests and validators                                              | PASS; 161/161, zero failures/skips; consistency does not confer sprint acceptance or branch protection                                                                    |
| Combined focused money/controller/query/module/guard/audit/composition units | PASS; 223/223, seven suites, zero failures/skips, 2.165 seconds                                                                                                           |
| Dedicated real R24 HTTP/PostgreSQL/Redis integration                         | PASS; 56/56, one suite, zero failures/skips, exit 0, 8.211 seconds                                                                                                        |
| Full enabled API run                                                         | **FAILED overall**; 340 suites passed, one failed, 13 existing gated; 6,394 tests passed, one failed, 81 existing pending/gated, 6,476 total; 277.04 seconds              |
| Focused seed unit after the recorded assertion correction                    | PASS; 10/10, zero skips, 1.703 seconds; runtime source unchanged by this correction                                                                                       |
| Full and production dependency audits                                        | PASS; zero informational, low, moderate, high and critical findings in both                                                                                               |
| Dedicated R22 process test                                                   | PASS; one suite, 3/3, zero failures/skips, 6.149 seconds; compiled API built first                                                                                        |
| Final published-head CI and CodeQL                                           | PENDING publication/results; missing, queued, cancelled or failed is not PASS                                                                                             |

### Selected real-service suites within the full run

These are a subset of the full enabled run, not additional totals. Each listed suite passed with zero skips.

| Existing integration suite                | Passed |
| ----------------------------------------- | -----: |
| R19 subscription money                    |     19 |
| R15 ledger                                |     37 |
| R22 outbox reliability                    |     21 |
| R22 outbox replay                         |      8 |
| R21 durable mail through separate Mailpit |     13 |
| R24 money API                             |     56 |

The full run's 81 pending/gated cases belong to 13 existing suites requiring dedicated S3, retention, browser or process environments. R24 introduced no skip. A subsequent dedicated local R22 process run passed its three cases; the historical full-run gate count is unchanged. The dedicated jobs still require actual final-head evidence. The focused R24 suites have zero skips; that claim must not be applied to the whole suite.

## Exact executed commands

Working directory for the coordinator/test-writer commands was `/workspace/scratch/3c602a5e36ee/homeservicemarketplace-r24`. The repository pins were Node 24.21.0 and pnpm 10.32.1. Commands below are recorded independently, not presented as one aggregate execution. `<private>` denotes `/tmp/hsm-r24-o1eb57hk/private`, and `<repo>` denotes the working directory; these are path abbreviations, not omitted credential values.

The disposable runtime environment enabled `RUN_DB_INTEGRATION=1` and `RUN_REDIS_INTEGRATION=1` for applicable runs. Its raw contents, DSNs with passwords and generated secrets are excluded.

### Install, database and production build

```bash
pnpm install --frozen-lockfile --store-dir /tmp/hsm-r26-store
pnpm --filter @homeservicemarketplace/database prisma:validate
pnpm --filter @homeservicemarketplace/database generate
pnpm --filter @homeservicemarketplace/database migrate:deploy
pnpm --filter @homeservicemarketplace/database exec prisma migrate diff --from-migrations <repo>/packages/database/prisma/migrations --to-schema-datamodel <repo>/packages/database/prisma/schema.prisma --shadow-database-url "$R24_SHADOW_DATABASE_URL" --script --exit-code
pnpm --filter @homeservicemarketplace/database verify:migrations
pnpm --filter @homeservicemarketplace/database seed
pnpm --filter @homeservicemarketplace/database seed
pnpm --filter @homeservicemarketplace/database typecheck
pnpm --filter @homeservicemarketplace/contracts typecheck
pnpm --filter @homeservicemarketplace/api lint
pnpm --filter @homeservicemarketplace/api typecheck
pnpm --filter @homeservicemarketplace/api build
```

The two seed invocations are intentional repeated-seed evidence. A fresh final database was created after refining the draft migration; the earlier disposable database was preserved, with no migration-history repair or reset. API typecheck/build use the declared database/contracts dependency builds. Explicit ESLint and Prettier checks covered the dedicated fixture/spec because ordinary API lint covers `src/`, not `test/`.

### Focused units and full enabled API

```bash
pnpm --filter @homeservicemarketplace/api test --runInBand --runTestsByPath src/modules/money/api/money.controller.spec.ts src/modules/money/application/money-command.service.spec.ts src/modules/money/application/money-query.service.spec.ts src/modules/money/money.module.spec.ts src/modules/iam/authorization/guards/permissions.guard.spec.ts src/modules/iam/audit/audit.service.spec.ts src/app.module.spec.ts --json --outputFile=<private>/r24-unit-final.json
pnpm --filter @homeservicemarketplace/api test --maxWorkers=2 --json --outputFile=<private>/full-api-final.json
```

The first command passed 223 focused tests. The second is the 277.04-second **failed** full run described above. Local worker concurrency was bounded while explicit concurrent-command cases remained enabled. The seed-only correction and dedicated R22 process check then ran separately:

```bash
pnpm --filter @homeservicemarketplace/api exec jest --runInBand --runTestsByPath test/unit/seed-with-tx.spec.ts --json --outputFile=<private>/seed-unit-final.json
RUN_R22_WORKER_PROCESS=1 pnpm --filter @homeservicemarketplace/api exec jest --runInBand --runTestsByPath test/integration/r22-outbox-process.integration.spec.ts --json --outputFile=<private>/r22-process-final.json
```

The seed run passed one suite, 10/10 with zero skips in 1.703 seconds. The R22 process run sourced the private final runtime environment and used the already-built API; it passed one suite, 3/3 with zero failures/skips in 6.149 seconds. These results do not rewrite the initial full-run totals.

### Focused real HTTP/PostgreSQL/Redis

The test writer supplied this exact execution block:

```bash
set -a
source /tmp/hsm-r24-o1eb57hk/private/runtime.env
set +a
export PATH="/tmp/hsm-r26-toolchain/node_modules/node/bin:/tmp/hsm-r26-toolchain/node_modules/.bin:$PATH"
umask 077
pnpm --filter @homeservicemarketplace/api test --runTestsByPath test/integration/r24-money-api.integration.spec.ts > /tmp/hsm-r24-o1eb57hk/private/r24-integration-seventh.log 2>&1
r24_test_exit=$?
printf 'R24 focused integration exit code: %s\n' "$r24_test_exit"
exit "$r24_test_exit"
```

It returned exit 0 with 56 passed tests, zero failures/skips, zero snapshots and 8.211 seconds. The API test script's dependency build runs before Jest. This does not turn a contract component into a real payment provider.

### Governance and dependency security

```bash
node --test --test-reporter=tap .github/scripts/*.test.mjs
node .github/scripts/sprint-registry.mjs
node .github/scripts/release-baseline.mjs
node .github/scripts/production-governance.mjs
node scripts/security/dependency-audit.cjs --output <private>/dependency-audit-all.json
node scripts/security/dependency-audit.cjs --prod --output <private>/dependency-audit-production.json
```

The four evidence documents also passed a scoped `pnpm exec prettier --check` using their exact paths. Formatting and governance success do not establish runtime acceptance. A pre-existing ts-jest `isolatedModules` deprecation warning remains; no dependency update, suppression, skipped assertion, raised timeout or security-budget relaxation was used to remove it.

## Failures, fixes and rerun limits

1. Initial disposable PostgreSQL setup inherited a `+03` timezone, and synthetic fixture email case did not match the authentication normalization. The final service runs in UTC and the fixture stores lowercase emails. No user data or shared service was reset.
2. Class transformation retained an absent optional coupon as `undefined`, which canonical JSON rejected. Purchase normalization now explicitly projects the required selectors and a present coupon; the component and HTTP reruns exercise the corrected request.
3. A real-service run passed 51/55 and failed four authorization cases. Current capability checks were insufficient when a stale JWT retained a removed base role; ordinary cached PermissionsGuard results could also deny a restored money permission. After the two-file lease, the existing guard resolves `money:` grants freshly and the owned command/query services require current provider/admin membership, including manual-event and financial-read paths. The expanded run passed 56/56; the earlier run remains historical FAILED evidence.
4. The full enabled API run's sole failure was `seedWithTx` expecting 24 automatic admin grants instead of the correct 18 ordinary grants after registering six deliberately ungranted money definitions. Before editing, the third lease authorized only its unit spec. The strengthened assertion requires all six definitions with zero role grants, preserves `outbox:replay` exclusion, ordinary admin grants and exactly two self grants for each end-user role. The focused correction passed 10/10. Runtime source and seed behavior did not change. The full failed run is not relabeled PASS; final published-head CI must verify the corrected whole suite.

The earlier independent review's economic-event dedupe, durable refund-evidence recovery, method/source authority and validation-bound corrections are documented in IMPLEMENTATION.md and covered by the passing focused runs. No claim of zero defects or acceptance under every possible concurrent schedule is made.

## Behavioral proof and real-service boundary

The 56-case R24 suite uses the real AppModule, URI-versioned HTTP, normal cookie/password/OTP authentication, CSRF and role/permission guards, PostgreSQL, Redis and restricted local storage. Assertions cover ownership/IDOR, revoked/regranted permissions and removed provider/reviewer roles, tampered amount/actor/account inputs, disallowed plans, canonical idempotency and concurrent keys, unknown dispatch recovery, mode/account/amount/currency/operation matching, manual-method webhook rejection, distinct-delivery economic dedupe, unavailable/throwing activation and late transaction rollback, receipt authority, competing refund reservations, durable compensation recovery, financial reads, pagination, and unchanged booking/wallet HTTP 200 responses.

State assertions inspect actual persisted command/event/period/ledger/audit/outbox effects. The six permitted money overrides are configuration, collection, receipt acceptance, activation participant, refund policy and refund adapter. They are explicitly contract components. The money catalog, ledger and financial reads use their real accepted implementations. Default production participants remain unavailable, and live mode remains denied.

Each fixture creates and migrates a new `hsm_it_r24_money_<random>` database through the accepted helper. It does not populate R19's global-history database. The genuine PrismaService startup/ping/teardown hooks and Redis round trips remain active. Local Redis is a separately launched instance; fixture database 12 is reserved within disposable CI Redis. Independent cookie jars and unique mode-0700 public/restricted/staging storage avoid session and media overlap. Cleanup closes its own app and removes only its own generated database/storage, with no global seed/reset, Redis flush, shared-volume deletion or unrelated process termination.

R24's test mail and scanner establish no real vendor delivery or malware acceptance; the separate R21 Mailpit suite proves its own transport behavior. Disabled background workers mean an outbox assertion proves committed notification intent, not downstream delivery. R29/R30 real rails, R31 full activation/entitlement policy and R32 approved refund consequences still require integrated-wave evidence. No hosted or production execution is claimed.

## Non-secret runtime and artifact identity

| Property                | Executed local value                                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain               | Node 24.21.0; pnpm 10.32.1; Prisma 6.12.0                                                                                                 |
| PostgreSQL              | 16.15, UTC, loopback port 54324                                                                                                           |
| Migration/seed database | `hsm_r24_o1eb57hk_final_31a393a9`                                                                                                         |
| Shadow database         | `hsm_r24_o1eb57hk_shadow_31a393a9`                                                                                                        |
| HTTP fixture database   | Separate generated `hsm_it_r24_money_<random>` database                                                                                   |
| Redis                   | 7.0.15, separate loopback port 56324, fixture database 12                                                                                 |
| Separate Mailpit        | 1.31.6; SMTP 51124, HTTP 58124                                                                                                            |
| Fixture modes           | Test environment, dynamic loopback HTTP port, local isolated storage, background workers disabled, six explicit money contract components |

SOURCE_MANIFEST.json records this runtime object, exact source-byte hashes and local artifact SHA-256s. Its runtime-object fingerprint (sorted JSON keys, compact separators, UTF-8, SHA-256) is `607dc551e0ab95a7f1a7e2c9d03a8a386ff431759b79d62e203c28d1066985fb`. Credential values, DSNs with passwords, cookies, OTPs, encryption/JWT secrets, receipt bodies and raw environment files are excluded.

| Key retained artifact/source        | SHA-256                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `r24-unit-final.json`               | `6a3bc7bb79b48cefacc293b3ea67bff0a752e7bbdee6518ed97c1f49aa6eebed` |
| `r24-integration-seventh.log`       | `eebd3083ef654fb04e696d8007f8130c5b4e2b7bae6c1747dea5da95a6f49b9e` |
| `r24-money-http.fixture.ts`         | `692800c39741791f62ed5259310fbec3bd2383c93373bc20810a411c84e8db2d` |
| `r24-money-api.integration.spec.ts` | `e6a6843ae19043ae06f0935470ad12c6abf82b923da433f780bc9ec879ac1d34` |

Local logs remain under `/tmp/hsm-r24-o1eb57hk/private/`; the manifest carries the broader artifact inventory. Published-head CI artifact/run references belong in the PR body. No self-referential containing commit SHA is inserted into evidence files.

## Remaining acceptance and handoff

Required final-head CI and CodeQL, including the full corrected API suite and dedicated gated jobs, remain unclaimed until their actual conclusions are published. No R24 UI was changed; browser screenshots and AR/EN/RTL/mobile/keyboard evidence are not asserted by backend HTTP tests. Repository-wide browser/compose checks still require their own CI results.

R29/R30 consume the frozen binding/event/collection/refund/receipt ports, R31 consumes the existing R19 period through the caller transaction, and R32 supplies the named refund policy. The coordinator accepts the combined source only after the required integrated journey. Keep the PR Draft while required evidence is missing; no merge/deployment, live rails, production grant, verification or payout authority follows from these local checks. See [RISKS.md](RISKS.md) and [ROLLBACK.md](ROLLBACK.md).
