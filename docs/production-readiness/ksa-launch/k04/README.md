# K04 — Customer request, bid, booking, communication and review lifecycle

Status: **PARTIALLY DELIVERED — Draft.** The audit request-edit race is fixed
and pinned by barrier-controlled real-PostgreSQL regressions, and it was verified
locally against real services. Acceptance that depends on K01/K02/K03, owner
decisions or hosted staging is **BLOCKED** (see §7). Nothing here is merged,
deployed or accepted.

## 1. Mode, scope and base

| Item                | Value                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delivery mode       | **Mode A** (integration / bug fix). No UI was changed, so no Mode B surface exists.                                                                                                    |
| Branch              | `release/ksa-k04-customer-lifecycle`                                                                                                                                                   |
| Base                | `origin/develop` `92770ea65ee1154f94f4251d5febfa39822f9b9a`, tree `854a9146c05bf21ef62af060358f581ec4c19306` (equals the audit reference; develop had not moved on 2026-11-03)         |
| Source SHA verified | `62f7c24d80794ba943307ac5077b614b975ed423`, tree `5610dcf45ff801a7e97362b3afe45dbfd9c304c8` (this evidence commit only adds this file)                                                 |
| Dependencies        | K01, K02 and K03 are **not merged**. K01 and K02 exist only as uncommitted worktrees, and K03 has two unmerged commits. K04 is built on develop, which does not contain their outputs. |
| Migration head      | `20261024120000_g3_financial_integration` (74 applied). K04 adds **no** migration.                                                                                                     |
| Flags               | None introduced. The real-API browser runs used the CI build flags `VITE_PROVIDER_ONBOARDING_V2=true` and `VITE_API_URL=http://127.0.0.1:4110`.                                        |
| Toolchain           | Node 24.21.0, pnpm 10.32.1, `pnpm install --frozen-lockfile`, Prisma 6.12.0, Playwright 1.62.1                                                                                         |
| Overlap avoided     | K02's worktree modifies `bids.service.ts` and `bookings.service.ts`. K04 does not touch either.                                                                                        |

## 2. Root cause (audit race)

`RequestsService.update` read the request with no lock, checked
`status === OPEN_FOR_BIDS`, and then called `updateOwned`, whose `WHERE` had no
status predicate. `BidsService.accept` locks the request row (`lockForLifecycle`)
and snapshots `scheduledAt` into the booking. Two interleavings therefore let an
edit land after a lifecycle transition:

1. The edit reads the request as OPEN, then the acceptance or cancellation runs
   to commit (the edit holds no lock), and then the edit writes.
2. The acceptance or cancellation holds the row, and the edit's `UPDATE` waits.
   When the rival commits, PostgreSQL re-evaluates the `WHERE` (id, owner,
   not deleted), the row still matches, and the edit writes anyway.

The result was a `BID_ACCEPTED` request whose schedule and description no
longer matched its booking, and a cancelled request rewritten after the seeker
was shown it.

**Reachability.** No web UI calls `PATCH /v1/me/requests/:id`
(`useUpdateServiceRequest` has no consumers). The defect is reachable by any
authenticated seeker through the API. The fix therefore belongs to the backend,
and no frontend change was made.

## 3. Fix

- `ServiceRequestRepository.lockOwnedForLifecycle(requestId, seekerUserId, tx)`
  takes `SELECT … FOR UPDATE` on the same row as `lockForLifecycle`, scoped to the
  owner. A foreign or unknown id locks nothing and returns false.
- `update`, `cancel` and `reopen` take that lock **before** reading the request
  (`lockAndReadOwned`). The lock order matches bid submission, acceptance and the
  outbox audience handler: the request row first. `resolveAddress` and
  `resolveCategory` take no locks.
- `updateOwned` now requires `expectedStatus` and writes only
  `WHERE status = OPEN_FOR_BIDS`. A write with count 0 returns **409 CONFLICT**
  and creates no `REQUEST_UPDATED` event. It previously returned 404.
- Cross-user behaviour is unchanged: a foreign request id returns 404, the same
  response as a missing one.

There is no schema, migration, contract, DTO or response-shape change. The only
observable API difference is that the losing side of the race now receives a 409
instead of a silent success.

## 4. Issue-to-test matrix

| Issue / requirement                                                                                                                                                                                                            | Test                                                                                                          | Real services                                 | Result on develop `92770ea6`                                           | Result on `62f7c24d` |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------- | -------------------- |
| Edit reads OPEN, the acceptance commits, then the edit writes                                                                                                                                                                  | `r07-marketplace-races` › K04 › _an edit that read the open request cannot write after an acceptance commits_ | PostgreSQL 16                                 | **FAIL** (booking `scheduledAt` 11‑05 ≠ request 11‑07)                 | PASS                 |
| Edit arrives while an acceptance is in flight                                                                                                                                                                                  | › _…refused once it commits_ (accept)                                                                         | PostgreSQL                                    | **FAIL** (edit fulfilled)                                              | PASS                 |
| Edit reads OPEN, the cancellation commits, then the edit writes                                                                                                                                                                | › _…after a cancellation commits_                                                                             | PostgreSQL                                    | **FAIL** (cancelled record rewritten)                                  | PASS                 |
| Edit arrives while a cancellation is in flight                                                                                                                                                                                 | › _…refused once it commits_ (cancel)                                                                         | PostgreSQL                                    | **FAIL** (edit fulfilled)                                              | PASS                 |
| Unsynchronised edit vs. accept, 8 rounds                                                                                                                                                                                       | › _unsynchronised edits racing an acceptance…_                                                                | PostgreSQL                                    | **FAIL**                                                               | PASS                 |
| Failed acceptance transaction rolls back, and the request stays editable and acceptable                                                                                                                                        | › _an acceptance that fails after the flips rolls back…_                                                      | PostgreSQL                                    | PASS                                                                   | PASS                 |
| Foreign actor edit, cancel or reopen; unknown id                                                                                                                                                                               | › _another seeker cannot edit, cancel or reopen…_                                                             | PostgreSQL                                    | PASS                                                                   | PASS                 |
| Lock taken before read; conditional write; count 0 → 409 with no event; foreign id never reads                                                                                                                                 | `requests.service.spec.ts` (+6 cases)                                                                         | unit                                          | n/a                                                                    | PASS                 |
| Two simultaneous acceptances; bid vs. accept; cancel vs. accept; bid vs. cancel; reopen vs. bid; repeated or concurrent idempotency key                                                                                        | existing `r07-marketplace-races` cases                                                                        | PostgreSQL + outbox worker                    | PASS                                                                   | PASS                 |
| Old bid acceptance re-checks provider capability (`PROVIDER_UNAVAILABLE`)                                                                                                                                                      | existing `r17-provider-surfaces`                                                                              | PostgreSQL                                    | PASS                                                                   | PASS                 |
| One customer and two providers: compare, edit while open, accept, second accept → 409, post-booking edit → 409 without internals, stranger and rival → 404, seeker, provider and DB agree on status, amount, currency and time | `r07-request-provider-lifecycle.real-api.spec.ts` › _K04: two providers bid…_                                 | real API build + PostgreSQL + Redis + Mailpit | not a regression proof (a sequential post-accept edit was already 409) | PASS ×2              |

Barrier protocol: one transaction stops at a hooked repository call and reports
`pg_backend_pid()`. The rival runs until it has settled or appears in
`pg_blocking_pids` of that pid, and only then is the barrier released. The test
decides the order, the protocol is identical before and after the fix, and it is
condition-based rather than based on sleeps. Parallelism is unchanged: Jest uses
default workers, and Prisma uses its default pool.

## 5. Commands and counts (local, 2026-11-03)

Environment: throwaway containers on non-default ports.
`postgres:16-alpine@sha256:20edbde7749f822887a1a022ad526fde0a47d6b2be9a8364433605cf65099416`
(16.13) on :5442; `redis:7-alpine@sha256:8b81dd37ff027bec4e516d41acfbe9fe2460070dc6d4a4570a2ac5b9d59df065`
on :6389; `axllent/mailpit@sha256:757f22b56c1da03570afdb3d259effe5091018008a81bbedc8158cee7e16fdbc`
on :21025/:28025. The API `apps/api/dist/main.js` ran on :4110 (the process owning
the port was confirmed), and `vite preview` served the SPA on :4273. The
environment mirrors the CI browser job (`ci.yml`), with the ports changed.

| #   | Command (from `apps/api` unless noted)                                                                        | Exit  | Result                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm install --frozen-lockfile` (root)                                                                       | 0     | —                                                                                                                                                                                |
| 2   | `database generate`; `prisma migrate deploy`; `database build`; `contracts build`                             | 0     | 74 migrations applied                                                                                                                                                            |
| 3   | **Red run:** fix stashed, `RUN_DB_INTEGRATION=1 jest r07-marketplace-races -t K04`                            | 1     | **5 failed, 2 passed** (23 filtered out by `-t`)                                                                                                                                 |
| 4   | `jest src/modules/requests src/modules/bids src/modules/provider/bids`                                        | 0     | 5 suites, 128 passed                                                                                                                                                             |
| 5   | `tsc --noEmit -p tsconfig.json`                                                                               | 0     | —                                                                                                                                                                                |
| 6   | `RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1 jest r07-marketplace-races`                                     | 0     | 30 passed                                                                                                                                                                        |
| 7   | the same, `-t K04`, repeated 5×                                                                               | 0     | 7 passed ×5                                                                                                                                                                      |
| 8   | 6 named suites (r05, r06, r07 ×2, r11, r12) together                                                          | 1 → 0 | First run: R11 62 failed with _"admin role lacks reviews:read … Run the seed"_ (DB not seeded). After `node packages/database/dist/seed.js`, R11 passed 62/62. Total 166 passed. |
| 9   | 14 further request-touching integration and e2e specs together                                                | 1     | 554 passed, 14 failed, 2 skipped. **G2** (2) and **R17‑E** (12) failed only under concurrency (see §8).                                                                          |
| 10  | `jest r17-e-closure` alone; `jest g2-query-projections` alone                                                 | 0     | 12 passed + 1 pre-existing gated skip; 37 passed                                                                                                                                 |
| 11  | full hermetic API jest (`RUN_DB_INTEGRATION` unset)                                                           | 1 → 0 | 307 suites passed, 101 DB-gated suites skipped. 3 suites crashed on missing `DATABASE_URL`/`JWT_ACCESS_SECRET` in my shell; rerun with the CI env: 6 suites, 92 passed.          |
| 12  | `eslint` + `prettier --check` on the changed files (includes `test/`)                                         | 0     | —                                                                                                                                                                                |
| 13  | `api build`; `web build` (V2 on, API :4110)                                                                   | 0     | Pre-existing Vite chunk-size warning                                                                                                                                             |
| 14  | (`apps/web`) Playwright `--project=chromium-desktop --workers=1`: r05, r06, r07, r11, r12 `.real-api.spec.ts` | 0     | 2 / 2 / 1 / 5 / 5 passed                                                                                                                                                         |
| 15  | (`apps/web`) r07 real-API with the K04 journey, 2 runs                                                        | 1 → 0 | The first run failed on a harness timezone parse (node-pg, +03:00). After comparing in SQL: 2 passed, 2 passed.                                                                  |
| 16  | (`apps/web`) `eslint`, `prettier --check`, `tsc -p tsconfig.e2e.json` on the spec                             | 0     | —                                                                                                                                                                                |

Not run locally: the full gated API suite across all 411 suites (see the memory
note on host exhaustion with parallel lanes); hosted CI; mobile-browser,
200%-zoom and RTL/LTR visual matrices (no UI changed, see §6).

## 6. UI, visual and accessibility

No customer or provider UI was changed, and no screenshot baseline was touched.
The prompt's visual matrix (six widths, AR/EN, keyboard, 200% zoom, conflict and
recovery states) was **not run**, because there is no changed surface to accept.
The customer has **no edit UI at all**, so there is no conflict state to render.
Whether the customer should be able to edit a request is a product decision
(§7) and has not been made.

## 7. Blocked or external inputs

| Input                                                                           | Owner         | Blocks                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K02 amount and currency contract, merged                                        | K02           | "Consume K02's authoritative amount/currency contract everywhere", fixed and hourly labels, decimal SAR. K04 asserts only that seeker, provider and DB values are **equal**. It does not assert the unit or the formatting.                                                                     |
| K02 cancellation, reposting and rebooking policy                                | K02 / owner   | The "approved rebooking flow". The existing cancel and reopen paths are untouched.                                                                                                                                                                                                              |
| **D‑13 uncategorised requests** (`r18/OWNER_DECISIONS.md`: _pending owner_)     | owner via K02 | "Never report an ordinary successful marketplace request with no provider audience". Today `categoryId = null` is created, enqueued, and announced to nobody. Not changed, because the decision is pending.                                                                                     |
| K03 staging target, synthetic identities, real object storage, scanner and mail | K03           | The definition of done "on the exact candidate build" in staging, and real-mobile-browser evidence.                                                                                                                                                                                             |
| K01 CI baseline, merged                                                         | K01           | Hosted CI on this branch runs on develop's current workflow.                                                                                                                                                                                                                                    |
| Policy: edits after bids exist                                                  | owner         | An open request can still be edited (time, address, description) while PENDING bids made on the old terms exist, and one of those bids can then be accepted. This is not a race, so K04 does not change it. It needs a rule, for example rejecting edits once bids exist or marking bids stale. |

## 8. Pre-existing findings (not introduced by K04; not fixed here)

- **G2 bounded projections × R17‑E closure isolation.** `g2-query-projections`
  reads a table-wide admin page (`take: 100`), and `r17-e-closure` C01 inserts
  105 bookings. Run concurrently, G2 cannot find its own row. In the same run,
  R17‑E timed out after 120 s waiting on the exclusive `seed` advisory lock. Both
  pass alone. Workers were **not** reduced to hide this. It needs a scoped
  advisory lock or a fixture-scoped query in G2.
- `r11-reviews-reputation` requires the baseline seed (CI seeds it; a fresh
  local DB does not).

## 9. Rollout and rollback

- **Rollout:** a normal deploy of the API. There is no migration and no flag. The
  behaviour change is confined to `PATCH`, `POST cancel` and `POST reopen` on
  `/v1/me/requests/:id`. They briefly wait on a concurrent acceptance or bid of
  the same request (one row lock, held only for the duration of that
  transaction), and the loser of a race receives 409.
- **Rollback:** revert `520e7893` (the code) and optionally `62f7c24d`
  (the e2e test). No data repair is needed, because K04 writes no new data.
  Requests corrupted _before_ the fix (edited after booking) cannot be told apart
  in data. To find candidates, look for a `REQUEST_UPDATED` event with
  `metadata.changed` whose `createdAt` falls after the request's acceptance
  event. That timestamp is the transaction start, so it is a heuristic, not proof.
- **Forward repair:** none required.

## 10. Remaining limits

- The race fix is proven at the service and database layer with real PostgreSQL.
  The HTTP test proves routing, the 409 mapping and cross-role agreement, but not
  the race itself.
- Messages, notifications, review moderation and support or dispute handoffs
  were exercised only through the existing r11, r12 and r17 suites, which pass.
  K04 found no defect there, but did not audit them beyond those suites.
- Refresh, deep-link, session-renewal and socket-reconnect recovery were not
  re-verified beyond the existing r05, r12 and r25 coverage. r25 was not run.
