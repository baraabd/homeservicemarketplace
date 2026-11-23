# K05 — Provider lifecycle and geographic discovery: implementation record

Status: **PARTIAL.** The geographic-pagination defect is fixed and verified
locally against real Postgres/Redis. The rest of K05 is blocked on inputs
listed below. **Not accepted, not merged, not deployed.**

This record keeps four statuses separate: implemented, tested (with what),
accepted (by whom), and merged/deployed.

## Baseline

| Item             | Value                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base             | `origin/develop` `92770ea65ee1154f94f4251d5febfa39822f9b9a`, tree `854a9146c05bf21ef62af060358f581ec4c19306` (same as the 2026-11-03 audit reference)                                                      |
| Branch           | `release/ksa-k05-provider-lifecycle`; worktree `../HSM-k05`                                                                                                                                                |
| Toolchain        | Node 24.21.0, pnpm 10.32.1; `pnpm install --frozen-lockfile` exit 0                                                                                                                                        |
| Migration head   | `20261024120000_g3_financial_integration` (no migration added by K05)                                                                                                                                      |
| Local services   | `postgres:16-alpine` (`k05-pg`, :5452) and `redis:7-alpine` (`k05-redis`, :6399), both throwaway; DB seeded with the development seed                                                                      |
| K01/K02/K03 base | **Not accepted.** K01 and K02 are uncommitted worktrees on `92770ea6`; K03 is 2 commits ahead and unpushed (`e4458df3`). K05 therefore starts from develop, and only work independent of K02/K03 was done. |
| Delivery mode    | Mode A (backend correctness). No UI changed.                                                                                                                                                               |

## Defect fixed: radius feed hid eligible requests behind box corners

**Root cause (two layers).**

1. `ServiceRequestRepository.listAvailableForProvider` selected a bounding box
   and fetched a fixed `ceil(take × 4/π) + 1` rows. It then removed the corners
   with the exact Haversine. 4/π is the average over-selection for uniformly
   spread rows, not a per-page bound: when the newest box rows were corners,
   the page came back short or empty.
2. `AvailableRequestsService.list` and the legacy `ProviderJobsService.listAvailable`
   set `nextCursor = null` for any short page. The requests behind the
   corners became unreachable. The web Live Jobs hook (`useAvailableRequests`)
   reads only the first page, so the provider saw **no jobs**.

**Fix.** The repository now owns the continuation (`AvailableRequestsPage`):

- City matching stays one exact query with a look-ahead row.
- Radius matching scans keyset batches over `(createdAt desc, id desc)` and
  applies the exact Haversine to each batch. It stops when `take + 1` rows
  match, when a short batch proves exhaustion (`nextCursor = null`, the only
  way to report an end), or after `SCAN_MAX_ROUNDS = 8` queries. In the last
  case the cursor is the last row **scanned**: a short page that truthfully
  says "more may exist".
- Batch size is `scanBatchSize(take) = clamp((take + 1) × 2, 50, 250)`.
- Category, status, soft-delete, own-request, already-bid and service-area
  constraints are unchanged: the same single Prisma `where` is used. The
  geographic authorization is **not** widened. Detail and bid authorization
  (`findAvailableForProvider`) and fan-out (`matchServiceArea`) are
  unchanged and are now proven row-by-row compatible with the feed.
- The decision and the rejected alternative (raw-SQL exact predicate) are
  recorded in ADR 0003, addendum K05.

**Wire contract.** Unchanged in shape: `{ items, nextCursor: string | null }`.
Behaviour change: a page may now be short with a non-null `nextCursor`, but
only once the 8-query budget is spent. Clients must page until
`nextCursor` is null, as the contract already said.

## Issue-to-test matrix

| Issue                                                                                         | Test (real Postgres unless noted)                                                                                | Result before fix | After |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------- | ----- |
| 30 newest corner rows hide 10+ valid nearby rows on page 1                                    | `r09-geo-pagination` › first default page holds every eligible request                                           | FAIL (`[]`)       | PASS  |
| Paging omits rows / ends early (limits 1, 2, 3, 7, 15, 16, 17)                                | `r09-geo-pagination` › limit N pages through every eligible request exactly once                                 | FAIL (7/7)        | PASS  |
| Equal timestamps duplicate or skip at page boundaries                                         | same suite: 4 valid + 4 corner rows share one `createdAt`; order and uniqueness asserted                         | FAIL              | PASS  |
| City fallback (ungeocoded same-city visible, other-city not)                                  | same suite fixture + order assertion                                                                             | FAIL              | PASS  |
| Excluded kinds stay excluded (soft-deleted, other category, already bid, closed, own request) | same suite fixture                                                                                               | n/a               | PASS  |
| Budget exhausted: short page must not claim the end                                           | `r09-geo-pagination` › scan budget smaller than the run of corners (forced 5×2)                                  | FAIL              | PASS  |
| Query budget per page                                                                         | `r09-geo-pagination` › default page stays inside its query budget                                                | FAIL              | PASS  |
| Request created mid-walk                                                                      | `r09-geo-pagination` › created mid-walk neither duplicates nor hides                                             | FAIL              | PASS  |
| Feed vs detail/bid authorization vs fan-out agree                                             | `r09-geo-pagination` › feed, detail … and fan-out matching agree row by row                                      | PASS              | PASS  |
| Legacy feed applies the same geography                                                        | `r09-geo-pagination` › the legacy jobs feed                                                                      | PASS              | PASS  |
| Service cursor pass-through, `take` clamp                                                     | `available-requests.service.spec.ts`, `provider-jobs.service.spec.ts` (unit, mocks updated to the page contract) | —                 | PASS  |

All fixture coordinates and users are synthetic. The suite uses its own
centre and city key: an earlier version shared geo-fanout's Aleppo centre and
showed up as +1 in geo-fanout's table-wide recipient count when the two ran in
parallel workers.

## Commands and results (local, this lane)

| #   | Command (from `apps/api` unless noted)                                                                                                                                                                                              | Exit | Result                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `pnpm install --frozen-lockfile` (repo root)                                                                                                                                                                                        | 0    | —                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | `pnpm --filter @homeservicemarketplace/database generate` / `migrate:deploy` / `build` / `seed`; `contracts build`                                                                                                                  | 0    | migrations applied to head                                                                                                                                                                                                                                                                                                                                                                       |
| 3   | `RUN_DB_INTEGRATION=1 npx jest test/integration/r09-geo-pagination…` **on unfixed source**                                                                                                                                          | 1    | 14 tests: **11 failed, 3 passed** (red, for the reported defect)                                                                                                                                                                                                                                                                                                                                 |
| 4   | `npx jest r09-geo-pagination geo-fanout` after the fix (parallel workers)                                                                                                                                                           | 0    | 28 passed, 0 failed, 0 skipped                                                                                                                                                                                                                                                                                                                                                                   |
| 5   | `RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1 npx jest r09-geo-pagination r09-geo-matching r09-geo-authority geo-fanout src/modules/provider/available-requests src/modules/provider/feed src/modules/provider/bids src/shared/geo` | 0    | **9 suites, 200 passed, 0 failed, 0 skipped**                                                                                                                                                                                                                                                                                                                                                    |
| 6   | `pnpm --filter @homeservicemarketplace/api typecheck` (repo root)                                                                                                                                                                   | 0    | —                                                                                                                                                                                                                                                                                                                                                                                                |
| 7   | `npx eslint <changed api .ts files>`; `npx prettier --check <changed files>`                                                                                                                                                        | 0    | clean (after `prettier --write` on 2 files)                                                                                                                                                                                                                                                                                                                                                      |
| 8   | `pnpm --filter @homeservicemarketplace/api test` with all gates on (the CI command)                                                                                                                                                 | —    | **NOT COMPLETED.** Claude Code killed the run because the host was critically low on memory, with several K lanes installing and testing in parallel. Its partial log shows lock-wait timeouts and `prisma migrate deploy` subprocess failures in unrelated money/outbox suites, consistent with host starvation. **It is not evidence for or against this change.** Must be rerun on hosted CI. |

Not run: web lint/typecheck/test/build (no web file changed); real-API
Playwright journeys (onboarding, activation-session, geo-authority,
admin-review-workflow); hosted CI on the pushed SHA.

## Blocked inputs (concrete handoff)

| K05 requirement                                                                                                                                | Blocker                                                                                                            | Owner / input needed                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Production identity-verification method, case → request-for-changes → correction → resubmission on that method; "no ID copies unless approved" | K02 has published no approved minimal identity method. Lawful basis, fields, access and retention are not decided. | K02 owner/accountable owner: approved method (external provider reference or minimal alternative), plus a retention policy if copies are ever approved |
| Intended production `WORK_ACCESS_ENFORCED` / `VERIFICATION_ENFORCED` configuration                                                             | `r18/OWNER_DECISIONS.md` D-19 is **pending owner**                                                                 | Owner decision D-19; then backfill readiness per its runbook                                                                                           |
| Saudi market registry, SAR decimal rendering, separated currency totals                                                                        | K02 contracts are uncommitted (`HSM-k02`)                                                                          | K02 accepted SHA                                                                                                                                       |
| Real staging storage, malware scanner, workers, synthetic accounts                                                                             | K03 is unpushed and unaccepted                                                                                     | K03 accepted staging + credentials (never in repo)                                                                                                     |
| Registration → first completed booking on the approved method and intended flags                                                               | Depends on all of the above                                                                                        | —                                                                                                                                                      |
| Visual matrix (320–1440, AR/EN, keyboard, 200 % zoom) for onboarding/correction/activation                                                     | No UI changed in this increment; the flows depend on the blocked method above                                      | Run once the method is approved                                                                                                                        |

## Residual risks

- **Live Jobs reads only page 1** (`useAvailableRequests`, default 20). The
  fix guarantees page 1 holds 20 rows whenever at least 20 eligible rows exist
  within the scan budget, but
  older eligible jobs beyond 20 are still not reachable in the web UI. That
  is a separate pre-existing defect: it needs a load-more control (Mode A/C
  UI change with the visual matrix). Recommended as a K05 follow-up.
- The budget can bind only after 8 consecutive batches of non-matching box
  rows, which takes an adversarial or highly clustered distribution. When it
  binds, the page is short but truthful.
- A spent-budget `nextCursor` is the id of a request inside the box but
  outside the circle. It discloses no location and opens nothing: detail and
  bid authorization answer 404.
- Hard-deleting the cursor row ends that walk early (pre-existing Prisma
  cursor behaviour; requests are soft-deleted).
- **geo-fanout's load cases count ACTIVE providers table-wide** near their
  centre. Any concurrently running suite that creates an ACTIVE provider
  there can make them flaky (pre-existing; this suite now avoids it).

## Rollback / forward repair

Code-only change: no migration, no flag, no data change. Rollback is a revert
of the K05 commit. The previous behaviour (short or empty pages reported as the
end) returns, with no persisted state to repair.
