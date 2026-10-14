# R27 — exact write allowlist

- **Lane:** Wave 2, lane 4, branch `feat/r27-performance-capacity`, worktree `../HSM-r27`.
- **Base:** `059c018576a75837d4dfb262ee49168d9217d881`. This is the G0 base,
  used for a **provisional pre-G1 start** that the owner approved in-session
  on 2026-10-14. G1 had not happened, and R20 and R23 were unmerged.
- **Approval:** the owner approved the proposed prefixes in the same
  decision. The coordinator registry (PR #157) still lists R27 as
  `RESERVED_PENDING_PACKAGE`, so registering the lane, branch and allowlist
  there is coordinator work.

| Path (prefix)                      | Exists at base? | Written by R27                                                                                     |
| ---------------------------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| `scripts/perf/post-r18/**`         | no (created)    | harness, libraries, tests, compose, budgets                                                        |
| `docs/performance/post-r18/**`     | no (created)    | reports (JSON) and README, FINDINGS, WORKLOAD_PROFILES                                             |
| `docs/production-readiness/r27/**` | no (created)    | evidence documents and shared change requests                                                      |
| `apps/web/src/app/performance/**`  | no              | **nothing**. No runtime module was justified without editing routes, which belong to other owners. |

## Reads and transient applications outside the allowlist

- **Read only:** the existing `scripts/perf/geo-query-plan.mjs` and all application source.
- **CR-R27-01/02:** `git apply` was used transiently to typecheck and unit-test
  `apps/web/src/app/components/admin/AdminRouteContent.tsx` and
  `apps/web/src/app/components/profile/SavedAddressesPage.tsx`. The test
  preload trial also touched `DashboardOverview.test.tsx`. Each was
  reverted (`git apply -R` / `git checkout --`), and `git status` was
  checked clean before every commit. No commit contains them.
- **`.env` at the worktree root:** written with the lane-only
  `DATABASE_URL`. It is gitignored and never committed.

## Shared and global paths

None were edited. Every runtime, route, schema, CI or global configuration
change is a change request under `shared-change-requests/`.
