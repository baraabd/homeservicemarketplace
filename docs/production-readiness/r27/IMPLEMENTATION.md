# R27 continuation implementation — 2026-10-17

Mode A, integration and bug fix. Continue the existing performance sprint and
PR #173 on `feat/r27-performance-capacity`. The source repairs already present
in this branch are retained: deferred chart/map imports, optional Mongo driver
loading, page-bounded bid counts and batched admin-user enrichment. This
continuation repairs their measurement harness and reconciles real evidence.

## Verified source and ownership

- Frozen runtime base: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`;
  tree `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
- Existing R27 source: `5fe27fdbfc63437d7315d2b3820c4345e6aed27f`;
  tree `9c1663bc42de4d5387091df7bedaeff307748e84`.
- Integration ancestor: `0568739096ceeaf0cfc79034626886e258fe4328`.
- Merged coordinator #172: `07c8e584c684111bfc80995c7efb0144cfb6161b`,
  tree `2a7146657a0c89874329768c7e3141fbe07dd0c7`; its Wave 2 manifest
  is READY_TO_START. Its ten changed files are coordinator records only.
- Both the frozen source and the integration base are ancestors of this lane.
  No rebase, merge, history rewrite or peer import occurred.
- `G1_HANDOFF.json.continuation` records the exact repair paths and delegated
  single writers before changes. All are within existing R27 authority.
  No new application, route, CI, schema or migration edit is required.
- The immutable final commit/tree are recorded in the PR metadata after
  publication and in each retained final-head artifact; this document does
  not attempt to contain its own future commit hash.

## Reproduced failure and repairs

Diagnostic workflow [38982468755](https://github.com/baraabd/homeservicemarketplace/actions/runs/38982468755)
passed source/build/real-service measurements but failed the production browser
matrix. Its development browser step consequently did not run.

1. The Arabic profile button is `ملفي` in the existing translation. The test
   incorrectly requested `حسابي`. The exact accessible-name assertion now
   matches the application; focus, Enter and destination assertions remain.
2. Redis counters persisted across browser projects, all using one loopback
   IP. `/auth/login` retains its real 10/minute decorator. Before each serial
   project's setup, the harness now verifies the disposable GitHub-hosted
   runner and full R27 Redis container identity, scans only
   `rl:throttler:default:*`, validates every hashed key, and deletes those
   counters in bounded batches. It retains session, registration and other
   cache keys. This never runs during timings, account-switch negatives,
   or the separate production-policy overload/recovery experiment.
3. Four response/action pairs now use immediately observed `Promise.all`
   handlers. An early login/navigation/save failure cannot orphan the response
   promise when the browser context closes. HTTP status assertions remain.
4. Git provenance now parses NUL-delimited porcelain without trimming the
   leading status columns. Both rename paths and unusual filenames survive.
5. `compare-reports.mjs` compares retained artifacts after validating coherent
   source/tree/harness/lock identities and comparable dataset/configuration.
   It reports incomplete browser matrices and omits unsupported tail estimates.
   The historical truncated first dirty path is retained and flagged.
6. The complete repaired run exposed a real host difference: Intel baseline
   versus AMD candidate. The comparator now checks CPU declarations in core
   and browser reports and emits a separate comparability warning. Source
   validity is preserved; time deltas are explicitly hardware-confounded.
   Even matching CPU models do not remove shared-VM/time confounding.

## Local verification in the isolated checkout

All successful commands use task-local Node 24.21.0 and pnpm 10.32.1, matching
repository pins. No global runtime or package manager was changed.

- `node scripts/runtime/toolchain.cjs`: PASS.
- `pnpm install --frozen-lockfile --reporter=append-only`: PASS, normal
  preinstall/prepare/Husky hooks; lockfile unchanged.
- `pnpm --filter @homeservicemarketplace/database generate`: PASS, guarded
  Prisma 6.12.0 generation and isolated native-engine load verification.
- `pnpm --filter @homeservicemarketplace/api typecheck`: PASS.
- `pnpm --filter @homeservicemarketplace/api build`: PASS.
- `VITE_API_URL=http://127.0.0.1:4327 pnpm --filter @homeservicemarketplace/web build`:
  PASS, including TypeScript; 3,431 transformed modules. Build duration is not
  used as page-load evidence.
- `pnpm --filter @homeservicemarketplace/web exec tsc -p r27-tests/tsconfig.json --noEmit`:
  PASS.
- `node --test .github/scripts/*.test.mjs`: 160 passed, 0 failed, 0 skipped.
- `node --test scripts/perf/post-r18/lib/*.test.mjs`: 37 passed, 0 failed,
  0 skipped. Includes 14 added controls: six guarded Redis-reset contracts,
  two provenance cases, five initial comparison cases and one CPU-comparability
  regression. Docker/Redis doubles in
  unit tests are explicitly distinguished from required real CI execution.
- Focused API Jest invocation: 62 passed in five files, 0 failed/skipped:
  `mongo.disabled-load.spec.ts`, `mongo.service.spec.ts`,
  `service-request.repository.spec.ts`, `user.repository.spec.ts`,
  `admin-users.service.spec.ts`; `--runInBand --runTestsByPath`.
- Focused web Vitest invocation: 18 passed, 0 failed/skipped:
  `AdminRouteContent.test.tsx`, `DashboardOverview.test.tsx`,
  `SavedAddressesPage.test.tsx`.
- Scoped ESLint, Prettier and `git diff --check`: PASS before publication.
- Real retained-report comparison: PASS. The old diagnostic artifacts remain
  `PENDING_INCOMPLETE_MATRIX`; repaired run 39032727959 is
  `OBSERVED_COMPLETE_MATRIX` with zero missing groups and an explicit CPU warning.
- Proposed budget evaluation: **47 passed, 4 failed**, exit 1; see ACCEPTANCE.
  Limits and security assertions were not raised or suppressed.

Current local tests total **277** across the four distinct listed suites.
Normal pre-commit hooks passed on the initial repair commit. A nonempty staged
Gitleaks scan read 58455 bytes; the exact afec-equivalent tracked-tree scan
read 2518 files / 21220825 bytes, and branch history read three commits /
302849 bytes, all without leaks. These scans identify that measured source;
subsequent publication has its own staged scan, normal hooks and exact-head CI.
The CPU advisory changes report interpretation only; no API/web runtime changed
after the recorded builds. Final publication results are recorded in PR #173.

## Complete repaired-source execution

[R27 run 39032727959](https://github.com/baraabd/homeservicemarketplace/actions/runs/39032727959)
measured source/harness `afec37ae717fbdca91a8e23dd5fc76a1cbd2a703`, tree
`be63469144228f3a450ba04c453ecd5b99c2b1ba`. This equals the locally tested
b58fd57 tree. Both baseline and candidate executed the same harness over their
immutable runtime sources; the baseline overlay touches only declared harness
and browser-test paths. The candidate reports a clean tree.

Both real-service jobs passed: baseline 36 harness + 8 production + 8 development
browser tests, candidate 36 harness + 16 production + 8 development browser
tests. The later CPU-advisory regression brings the local harness to 37; it
is not retroactively counted in the earlier 36-test CI run. Forty browser
cases passed without failures/skips. Source/configuration validation covers
all 24 JSON reports, 48 paired n=3 groups and 40 retained screenshots. Eighteen
screenshots were directly inspected; exact paths are in ACCEPTANCE.

The new measurements reproduce initial gzip reductions and bounded query
changes, while recording mixed timings/RSS and the baseline/candidate CPU
mismatch. The unchanged proposed checker remains 47 PASS / 4 FAIL. There are
ten asserted API cache/authority negatives plus three informational same-user
conditional observations, not thirteen independent negative tests. Fifteen
of seventeen private sampled reads omit Cache-Control. Same-context browser
account switching passed; cross-tab and live role/grant revocation are still
security integration work.

CodeQL run 39032727973 passed. On this same source, main CI's real API job passed
6093 tests with 81 skipped, its unit profile passed 4541 with 1633 skipped,
and web verify passed 2478 tests. These profiles overlap. One separate admin
review evidence case failed retrieving its fixture OTP after a successful
login response; that failure and the final successor check are documented in
ACCEPTANCE. It is not assumed to be a product regression or dismissed as a flake.

CR-001-integration records exact budget edits for owner review, provider
projection candidates, completed-booking fixtures/index decision and private
HTTP cache acceptance. CR04 and the shared request index now distinguish current
implemented repairs from historical proposals. No proposed threshold or shared
runtime/schema/HTTP policy was changed in this evidence update.

## Configuration and build provenance

The local build targets only the R27 loopback URL and opens no application
server. No root `.env`, user database, Docker volume or live credential was
reused. Real browser tests require their existing disposable GitHub runner.

- Lockfile SHA-256: `724b826ea09da6e070f4721a30f5dd9145a333606fac124e0249b5ef7fe18222`.
- Prisma schema SHA-256: `3391c6bd897e812b1c520f51569931756a39cb4bc54312b15fdc629c262ce8a4`.
- Local compiled main.js SHA-256: `395f3bd924c5dd6aab0016bdd2c3bb7efdb1a0371d5ef588550b3a4e64a36460`.
- Measured bundle safe buildFlags fingerprint (both sources):
  `adfd35798eef30025f055d37dcb43f7a58571f50b9d81eefb8d63730465e77c7`.
- Measured boot safe environment fingerprint (both sources):
  `4f7635fe6e636ea20a9158e1baaea574c1c5b7865596ea920e98d62bbc41b248`.
- Measured query safe environment fingerprint (both sources):
  `4983f9290f754766907bee8d5c1d8a50ef5f027c8d0d06f93465254ed011aa59`.

Fingerprints use canonical sorted JSON of the already sanitized report fields,
not raw environment variables. The compiled main.js checksum identifies only
the API entry file, which is identical in both builds; it is not a checksum of
all separately compiled modules. Clean builds plus source trees establish the
complete source provenance. Schema, migration, contract and feature flags
are unchanged; the accepted `hsm.money.v1` boundary remains as frozen.

## Failed attempts and warnings

The initial sandboxed Prisma generator and Node test child processes failed
before useful client/per-test output. The same scripts passed in the
approved execution context with child-process/loopback support. The first
production web build correctly refused a missing `VITE_API_URL`; specifying
the documented R27 URL resolved it. No guard was bypassed.

The first afec PR governance run raced the Final SHA body update; its replacement
passed. The afec main-CI admin review evidence job had one OTP retrieval timeout
(14 passed / 1 failed) after a 200 login response and visible OTP input. The
underlying cause is unproven; the final successor's normal complete CI remains
required. No timeout was raised, test skipped or shared authentication test edited.

A staged secret scan initially classified the documented compiled-file checksum
as a generic credential. The checksum was verified from the local artifact
and its label clarified; scanner rules and exclusions were unchanged.

Existing ignored dependency build-script notices, the ts-jest isolatedModules
deprecation and the Vite >500 kB chunk warning remain visible. No dependencies,
lockfile, security budgets or global timeout were changed to suppress them.

---

## Historical records retained for audit

> **Historical continuation note:** R27 resumed from frozen source
> `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0` after verified owner merge of #171.
> See `ALLOWLIST.md` and `G1_HANDOFF.json`. The earlier report below is historical
> pre-G1 evidence. Its pending statements describe the earlier snapshot;
> the current measurement and acceptance state are recorded above.

# R27 — Implementation

- **Sprint:** R27, "Measured startup, bundle and database performance" (wave 2, lane 4).
- **Branch:** `feat/r27-performance-capacity`, worktree `../HSM-r27`.
- **Base:** `059c018576a75837d4dfb262ee49168d9217d881` (G0). The start is
  provisional and pre-G1, as the owner approved on 2026-10-14. The hard
  dependencies R20 and R23 were not merged, and nothing from them is used.
- **Source commit:** `19c51d4405c28de1d0bfd03fcb12cc08e599acff` (tree
  `aaac08a2abab70ec52f9a7922a23685955d7e48f`). The evidence commit follows it;
  see the PR for the final SHA.
- **Toolchain:** Node 24.21.0, pnpm 10.32.1, vite 6.4.3, Prisma as pinned,
  Postgres 16 and Redis 7 (alpine) in lane containers.
- **Status:** `IMPLEMENTED` (harness) / `SOURCE_VERIFIED` (unit tests, lint,
  format) / `INTEGRATION_PENDING` (all eight CRs, G1, hosted timing).

## What was built

All of it is under `scripts/perf/post-r18/`.

| File                                                            | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bundle-report.mjs`                                             | Builds the web app with Vite's API and the repository's unchanged `vite.config.ts`, into a temporary directory. Captures the Rollup chunk graph, then reports the shell (entry + `bootstrap.tsx`), the per-journey increment for 8 lazy pages plus 2 nested boundaries, raw/gzip-1/brotli-11 sizes, attribution by owner, and placement of heavy libraries. `--overlay` substitutes a proposed file during that build only, which is how the CRs were measured without editing other owners' files. |
| `api-boot.mjs`                                                  | Spawns `apps/api/dist/main.js` and times spawn → `/health/live` → `/health/ready`, then first and repeated public reads, plus RSS. Has `production` and `fixture` env profiles. Resets only the lane's own Redis between runs, so the production throttle stays unchanged.                                                                                                                                                                                                                          |
| `api-boot-profile.mjs`                                          | One boot under `--cpu-prof`, with a clean exit via IPC (`lib/exit-on-ipc.cjs`, needed on Windows). Self time is charged to the nearest non-internal caller, and the module-loading share is reported.                                                                                                                                                                                                                                                                                               |
| `query-profile.mjs`                                             | Real-API seed, with fixture-only approval and work grant as in R07/R12. For each of 17 reads it records statements per request (`pg_stat_statements`, workers off), latency and headers. It then runs a ×N SQL amplification (`lib/amplify.mjs`) and re-measures, adding a page-size invariance probe, `EXPLAIN (GENERIC_PLAN)` of every captured read, cursor walks, and 13 cache/authorization negatives.                                                                                         |
| `check-budgets.mjs`, `budgets.proposed.json`, `lib/budgets.mjs` | Proposed budgets (owner approval pending) and their evaluator.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `compose.r27.yml`, `lane-db-reset.sh`, `lib/lane-env.mjs`       | Isolated lane stack and its guards. The harness refuses any database other than the lane's.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `lib/lib.test.mjs`                                              | 17 pure unit tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Evidence:

- `docs/performance/post-r18/`: 5 JSON reports, README, FINDINGS and
  WORKLOAD_PROFILES.
- `shared-change-requests/`: CR-R27-01 … CR-R27-08.

## Contracts, schema, flags

- No contract, schema, migration, route, flag or dependency change.
- The lane database got the `pg_stat_statements` extension; it is a lane
  container, not a shared database.
- The proposed CR-R27-06 index belongs to the coordinator's migration lane.

## Exact commands and counts (this session)

| Command                                                                                                           | Result                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                  | exit 0, 10 m 43 s                                                                                                                                                                                                                                                                                                       |
| `pnpm --filter @homeservicemarketplace/database generate`, `migrate:deploy`, `build`, `seed` (lane DB)            | exit 0                                                                                                                                                                                                                                                                                                                  |
| `pnpm --filter @homeservicemarketplace/api build`                                                                 | exit 0, 2 m 21 s                                                                                                                                                                                                                                                                                                        |
| `node --test scripts/perf/post-r18/lib/lib.test.mjs`                                                              | **17 pass, 0 fail, 0 skipped**                                                                                                                                                                                                                                                                                          |
| `npx eslint --no-warn-ignored scripts/perf/post-r18`                                                              | exit 0 (after fixing 1 `no-useless-assignment`)                                                                                                                                                                                                                                                                         |
| `npx prettier --write` on the lane paths; lint-staged at commit                                                   | pass                                                                                                                                                                                                                                                                                                                    |
| `bundle-report.mjs` baseline / overlay CR-01+02                                                                   | exit 0 / exit 0                                                                                                                                                                                                                                                                                                         |
| `check-budgets.mjs --bundle` baseline / after                                                                     | **6 pass, 4 fail** (exit 1) / **10 pass, 0 fail** (exit 0)                                                                                                                                                                                                                                                              |
| `api-boot.mjs --runs 6 --requests 30` (production profile)                                                        | exit 0; 6/6 runs                                                                                                                                                                                                                                                                                                        |
| `api-boot-profile.mjs`                                                                                            | exit 0 on the 3rd attempt. Attempt 1 hung: a non-forced Windows `taskkill` cannot stop a windowless child (fixed with IPC). Attempt 2 attributed 93% to native frames (fixed by caller attribution).                                                                                                                    |
| `query-profile.mjs --copies 300`                                                                                  | exit 0 on run 1 (13/13 negatives pass). The improved run 2 (page-size probe, fresh-provider feed) **did not execute**: the API could not start within 90 s at 0.3–0.5 GB free. It was stopped and its process tree killed.                                                                                              |
| `api-boot.mjs --profile fixture`, 3 attempts                                                                      | **failed** ("not ready within 90000 ms", empty log); host starvation                                                                                                                                                                                                                                                    |
| CR-01/02 transient `git apply` + `tsc -p apps/web/tsconfig.app.json --noEmit`                                     | exit 0                                                                                                                                                                                                                                                                                                                  |
| CR-01/02 transient + `vitest run src/app/components/admin src/app/components/profile/SavedAddressesPage.test.tsx` | patched: 80/81 and 78/81. Unpatched: 80/81. `DashboardOverview.test.tsx` alone, patched: 6/6. Patched with a `beforeAll` preload: 3 failed, then 76 passed / 5 skipped (hook timeout). This is **not a pass**. See CR-01 for the attribution and the proposed static-import adjustment, which was not verified locally. |
| `git apply --check` + EOL-insensitive reproduction of both CR patches                                             | pass                                                                                                                                                                                                                                                                                                                    |

Not run locally, and not claimed:

- full web/API test suites, lint and typecheck of untouched packages;
- Playwright;
- gitleaks (no binary on this host);
- CodeQL;
- hosted startup performance.

These come from the PR's CI.

## Environment fingerprint (no secrets)

- **Host:** Windows 11 (10.0.26300), i5-12450H with 12 logical CPUs, 15.8 GB
  RAM, free memory 0.3–1.3 GB during runs, four other wave lanes active.
- **Lane containers:** `hsm-r27-perf-postgres` (127.0.0.1:54397),
  `hsm-r27-perf-redis` (127.0.0.1:63797), `hsm-r27-perf-mailpit`
  (127.0.0.1:11027/18027). The API ran on 127.0.0.1:4027.
- **Credentials:** a per-run random JWT secret. The DB password is a
  loopback-only throwaway, fixed in `compose.r27.yml`.
- **API child environment:** limited to the keys in `lib/lane-env.mjs`.
- **Build flags:** `VITE_API_URL=http://127.0.0.1:4010`; no other `VITE_*`.
