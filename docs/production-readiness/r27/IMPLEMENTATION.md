> **Current G1 continuation:** R27 resumed from frozen source
> `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0` after verified owner merge of #171.
> See `ALLOWLIST.md` and `G1_HANDOFF.json`. The earlier report below is historical
> pre-G1 evidence. Current implementation/integration is IN_PROGRESS and is
> not accepted. Fresh baseline CI and required browser evidence are pending.

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
