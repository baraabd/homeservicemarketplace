# R27 continuation — 2026-10-17

The owner requested execution of the R27 prompt. This task continues existing
PR #173 from `5fe27fdbfc63437d7315d2b3820c4345e6aed27f` in a new isolated
checkout on the assigned branch. Merged coordinator PR #172 at
`07c8e584c684111bfc80995c7efb0144cfb6161b` records G1 as READY_TO_START.
The frozen runtime base remains `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.

Before implementation, every repair/evidence path was checked against the
existing exact-file authority and recorded in `G1_HANDOFF.json.continuation`.
The browser subagent writes `apps/web/r27-tests/performance.real-api.spec.ts`
and, under the recorded later delegation, `scripts/perf/post-r18/compare-reports.mjs`
and `scripts/perf/post-r18/lib/lib.test.mjs`. Root writes the remaining listed
files. The final evidence update adds only the already-owned CR-001 integration
request, shared-request index and CR04 README to the continuation list before
editing them; the comparison CPU advisory uses the existing two-file delegation. No new shared runtime or CI lease
is required for this repair. The earlier ownership record below is historical
where it refers to the previous session/worktree or pending publication.

The reproduced failures were in the measurement harness: an incorrect Arabic
accessible-name assertion, shared fixture login-throttle counters, and
unobserved response promises. Fixture isolation changes happen before setup
and outside page timing; real default-policy overload/recovery stays intact.
The repaired afec37ae run passes the full matrix. The final comparison/evidence
update changes no application runtime, route, shared workflow, schema or policy.

---

> **Single-writer reconciliation:** After the initial empty open-PR inventory,
> coordinator PR #172 appeared at 2026-10-16T23:18:01Z, owning the G1 metadata.
> R27 withdraws its eight metadata diffs completely; those exact files remain
> at the merged integration base in this branch. The earlier publication lease
> below is RELEASED, not concurrent. `G1_HANDOFF.json.ownership` is the current
> exact R27 extension and runtime/measurement leases under the prior delegated
> authority. Central transcription is an explicit coordinator integration task.
> No unmerged peer source is consumed and no other lane is started by this PR.

# R27 — current exact ownership and handoff

Coordinator-recorded **before implementation** on 2026-10-16 after owner
resume instruction and the delegated G1 closeout authority. Mode A; one writer:
this R27 session, branch `feat/r27-performance-capacity`, fresh worktree
`/workspace/scratch/6f91e439cab8/hsm-r27-work`. No other session worktree changed.

- Frozen runtime source: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`; complete tree
  `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
- PR #171 was owner-merged at 2026-10-16T23:01:54Z as
  `0568739096ceeaf0cfc79034626886e258fe4328`, tree
  `ceaa111acd43e07a89e49728996933b9204bd73d`. Its final head
  `578ae9359fb93a46e478b1db0ca043a0c73aca51` has 29 latest successful
  checks (30 records include one superseded governance failure).
- Frozen source is an ancestor of merged publication on `develop`. Runtime
  diff for `apps packages scripts infra .github/workflows` is empty.
- Previous R27 head `2e8d1dba35f2a36a73d47100d8495f5379bc028c` is an
  ancestor of the frozen source. New assigned worktree started at frozen source
  and fast-forwarded only merged metadata to `0568739096ceeaf0cfc79034626886e258fe4328`.
  No history reset/rebase/force-push or unmerged peer import.
- Existing pre-G1 results remain historical; rerun current baselines.
- Current remote open PR inventory is empty. Other four lanes stay held for
  their own assignment/handoff; their files/leases are not changed.

The current R27 exact extension is in `G1_HANDOFF.json.ownership`. Its
central transcription was withdrawn to preserve the active coordinator writer.
All additions below were checked against other four lane allowlists/leases.
Lease expiry: R27 PR merge/closure, G2 decision or earlier revocation.

## Exact coordinator leases

### SERIALIZED_G1_PUBLICATION

Verify already-merged PR #171; publish its immutable identity; release only this assigned R27 handoff. No peer runtime writes or gate-validator relaxation.

- `docs/production-readiness/post-r18/gates/g1/SOURCE_MANIFEST.json`
- `docs/production-readiness/post-r18/gates/g1/DECISION.md`
- `docs/production-readiness/post-r18/gates/g1/BLOCKERS.md`
- `docs/production-readiness/post-r18/gates/g1/ACCEPTANCE_PUBLICATION.md`
- `docs/production-readiness/post-r18/waves/wave-02.plan.json`
- `docs/production-readiness/post-r18/waves/WAVE_02.md`
- `docs/production-readiness/post-r18/SPRINT_REGISTRY.json`
- `docs/production-readiness/post-r18/ACTIVE_STATUS.md`

### MEASURED_UI_REPAIRS

CR-R27-01/02 lazy chart/map boundaries and existing behavior tests only, after current-source baseline. No route table, Root, Vite config, auth or visual redesign.

- `apps/web/src/app/components/admin/AdminRouteContent.tsx`
- `apps/web/src/app/components/admin/AdminRouteContent.test.tsx`
- `apps/web/src/app/components/admin/DashboardOverview.test.tsx`
- `apps/web/src/app/components/profile/SavedAddressesPage.tsx`
- `apps/web/src/app/components/profile/SavedAddressesPage.test.tsx`

### ISOLATED_MEASUREMENT_CI

Dedicated disposable R27 measurement/browser job. Preserve existing CI, thresholds and assertions. No hosted deployment or external paid resources.

- `.github/workflows/r27-performance.yml`
- `apps/web/playwright.r27.config.ts`

## Added lane-owned exact files

- `docs/production-readiness/r27/G1_HANDOFF.json`
- `docs/production-readiness/r27/shared-change-requests/CR-R27-09-harness-isolation/README.md`
- `docs/performance/post-r18/g1-bundle-baseline.json`
- `docs/performance/post-r18/g1-bundle-after.json`
- `scripts/perf/post-r18/lib/runtime.test.mjs`
- `scripts/perf/post-r18/compare-reports.mjs`
- `scripts/perf/post-r18/profile-workloads.mjs`

No API runtime/schema lease is granted by this handoff. Further measured repairs
need an explicit serialized extension before any write.

## Historical pre-G1 record (superseded ownership, retained evidence)

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

## API repair lease extension (before runtime writes)

CR-R27-03/05/08 only. Current G1 baseline job 117241110118 reproduced 52 SQL statements for 15 admin users (22 for 5), whole-Bid scan with 43344 rows and 37.85 ms request-list p50, and 136 ms sampled mongoose/mongodb self time while disabled. Batch page reads and defer disabled optional Mongo imports. No auth, grants, money, schema, main/AppModule/config or peer edits.

- `apps/api/src/infrastructure/persistence/requests/service-request.repository.ts`
- `apps/api/src/infrastructure/persistence/requests/service-request.repository.spec.ts`
- `apps/api/src/infrastructure/persistence/iam/user.repository.ts`
- `apps/api/src/infrastructure/persistence/iam/user.repository.spec.ts`
- `apps/api/src/infrastructure/persistence/iam/admin-access-request.repository.ts`
- `apps/api/src/modules/admin/users/admin-users.service.ts`
- `apps/api/src/modules/admin/users/admin-users.service.spec.ts`
- `apps/api/src/infrastructure/mongo/mongo.service.ts`
- `apps/api/src/infrastructure/mongo/mongo.providers.ts`
- `apps/api/src/infrastructure/mongo/mongo.disabled-load.spec.ts`

## Browser harness exact extension (before writes)

Dedicated R27 tests avoid changing the shared Playwright configuration or
accidentally running real-service tests in the mocked browser suite.

- `scripts/perf/post-r18/browser-servers.mjs`
- `apps/web/r27-tests/performance.real-api.spec.ts`
- `apps/web/r27-tests/tsconfig.json`

The leased `apps/web/playwright.r27.config.ts` selects only this test directory.
API 4327, web 5327, alternate 5427; R28 port 5328 is not used.
