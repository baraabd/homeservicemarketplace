# R17-E — Provider surface authority

Branch `feat/r17-e-provider-surface-authority`. Base
`develop@2710d259f5d798a4d7c47eed656743362f6975c6` (R17-D merged). Policy
sources: `R17_E_PROVIDER_POLICY.md`. Per-route and per-mutation matrix:
`R17_E_AUTHORITY_MATRIX.md`.

Delivery mode: Integration and Bug-Fix (server authority, contracts, tests),
with local Product Feature work on the provider bookings surfaces (a list and
a detail route that did not exist). No unrelated screen was redesigned.

## Baseline gate: R17-D post-merge acceptance

PR #146 (head `9126a32`) merged as `2710d25`. Push runs on `2710d25`,
verified before any R17-E code was written:

| Workflow                            | Run id      | Result              |
| ----------------------------------- | ----------- | ------------------- |
| CI                                  | 37717935824 | success, 17/17 jobs |
| CodeQL                              | 37717935459 | success             |
| Production governance               | 37717935503 | success             |
| Web development startup             | 37717935521 | success             |
| Authentication lifecycle acceptance | 37717935461 | success             |
| Staging release boundary            | 37717935502 | success             |

PRs #141–#146 are all merged (`3af9807`, `e1f7f51`, `7642513`, `a8dc1a2`,
`aaf30aa`, `2710d25`). `EXECUTION_PLAN.md` and `ACCEPTANCE.md` still said
`R17_D_IN_REVIEW`; both now record `R17_D_POSTMERGE_ACCEPTED`.

Duplicate-work check: one local R17-E branch existed (unpushed, worktree
`../HSM-r17-e`) from an earlier session, holding the failing-before spec
`aa11d12` and uncommitted E-1/E-2 work. It was reviewed and continued; no
second branch was created.

### R17-D carry-over (still reproduces; not changed by R17-E)

| Observation (PR #146 review)                                                                                                                                                    | State on `2710d25`                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Analytics range predicates compare `timestamp without time zone` columns with timestamptz parameters (`admin-analytics.queries.ts:75`, `:107`); a non-UTC session shifts days   | reproduces by source; latent while every session is UTC (the throwaway and CI databases report `UTC`) |
| `FixNow Sprint 6.4 Admin Analytics Financials` Newman collection asserts numeric `platformFeesWithinRange`, `netProviderEarningsWithinRange`, `platformFeeRateBps` (now `null`) | reproduces by source; the collection is not run by any workflow                                       |
| `FixNow Admin Runtime` collection PATCHes the inert `feature_show_hourly_rate` and expects 200                                                                                  | reproduces by source (`assertWritable` answers 400); `pnpm postman:admin-runtime` is manual           |

None is required for R17-E acceptance, so none is mixed into this unit.

## Results

| ID   | Baseline finding                                                                                                   | Reproduction                                                                                                                              | Root cause                                                                                                                        | Fix                                                                                                                                                                                               | Status                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| E-1  | Legacy feed: a zero-category provider received every open request; `categoryId` replaced the provider's categories | real HTTP on the baseline: P01 and P04 fail                                                                                               | `categoryIds ?? own` and a repository that read an empty set as "no filter"                                                       | `feedCategoryScope` (own ∩ requested) on legacy feed, canonical feed, detail and bid; the repository returns nothing for an empty set                                                             | **FIXED**                                                                       |
| E-2  | Canonical feed: `category` replaced the provider's categories                                                      | P02 and P05 fail on the baseline                                                                                                          | same expression in `available-requests.service.ts`                                                                                | same function; agreement per request and provider shape proven by P25                                                                                                                             | **FIXED**                                                                       |
| E-3  | A seeker could accept a pending bid from a provider who had since lost new-work authority                          | P13 on the baseline: restricted bidder, accept 200, booking created                                                                       | accept authorised only the seeker                                                                                                 | accept re-decides the bidder's `SUBMIT_BID` in its transaction (`canInTransaction`, account and profile rows `FOR SHARE`); 409 `PROVIDER_UNAVAILABLE`; bid stays PENDING                          | **FIXED** (fail closed); bid disposition **POLICY_BLOCKED**                     |
| E-4  | Start/Complete/Cancel failures were silent; Cancel had no confirmation                                             | `r17e-baseline-regression.test.tsx` fails against the `2710d25` My Bids screen (2/2)                                                      | `mutate()` without handlers; the cancel button posted on click                                                                    | shared `BookingActions`: pending, success only after the server, six failure kinds, `ProviderConfirmDialog`, refetch on settle, no retries                                                        | **FIXED**                                                                       |
| E-5  | Capability loss mid-session was not reflected; a RESTRICTED provider could not reach their bookings                | the same regression fails against the `2710d25` realtime bridge; source: `/provider/bids` (VIEW_MARKETPLACE) was the only booking surface | capabilities read once per mount; `provider.status_changed` invalidated profile and `auth/me` only; no MANAGE_BOOKINGS-only route | refresh every 30 s, on focus, on any provider 403 and on realtime status/notification events; `/provider/bookings[/:id]`; restricted providers land there; withdrawn reads dropped from the cache | **FIXED**                                                                       |
| E-6  | CodeQL #4 `js/user-controlled-bypass` at `provider.service.ts:227`                                                 | not reproducible: the only category write is driven by the authorised plan; omission changes nothing                                      | the scanner sees a body-controlled `if` around an `authorize…` call                                                               | `planCategoryRemovals` runs on every PATCH (omission planned as the current set); behaviour-identical; unit cases for omission and prototype-like ids                                             | **NOT_REPRODUCED_WITH_EVIDENCE**, refactored; CodeQL state on the PR head below |
| E-7  | No booking detail or timeline UI; withdraw/start/complete/cancel lacked browser coverage                           | source; the BOOKING_CREATED deep link `/provider/bookings/:id` fell through to the catch-all                                              | the API existed (list, detail, timeline, transitions) but no screen used detail or timeline                                       | list and detail screens on the existing endpoints; 14-step real-browser journey                                                                                                                   | **FIXED**, **EVIDENCE_ADDED**                                                   |
| E-8  | "$/hr" labels and seeker `badge`/`topPro` without a writer                                                         | source: only the seed writes `badge` and `topPro`; My Bids printed `$…/hr` for FIXED bids too                                             | projections forwarded seed-only columns; a hard-coded label ignored `pricingType`                                                 | seeker projections carry `badge: null`, `topPro: false`; provider surfaces print the stored amount, currency code and pricing type                                                                | projection **FIXED**; money unit/currency **POLICY_BLOCKED**                    |
| E-9  | New-request fan-out announced uncategorised requests to every area provider                                        | P27; source                                                                                                                               | the fan-out treated `categoryId: null` as "any provider"                                                                          | skip uncategorised requests; match on the live category                                                                                                                                           | **FIXED**; who serves them **POLICY_BLOCKED**                                   |
| E-10 | Bid submit/withdraw refreshed only the legacy feed cache                                                           | source                                                                                                                                    | invalidation used `jobs.root`; the screen reads `availableRequests`                                                               | settle-time invalidation of both                                                                                                                                                                  | **FIXED**                                                                       |
| E-11 | My Bids showed a failed load as "No bids submitted yet" and hid withdrawn bids                                     | source                                                                                                                                    | no error branch; a client-side filter                                                                                             | error with retry; withdrawn bids shown                                                                                                                                                            | **FIXED**                                                                       |
| E-12 | Provider unread badge failed contrast on every workspace screen                                                    | browser axe (first run)                                                                                                                   | white 8 px text on `red-500` (3.8:1)                                                                                              | `red-600` (4.8:1)                                                                                                                                                                                 | **FIXED**                                                                       |
| E-13 | Fan-out audience uses legacy `status = ACTIVE`, not the capability decision                                        | source                                                                                                                                    | `listEligibleRecipientsPage`                                                                                                      | none (engineering follow-up; discloses category label and city only)                                                                                                                              | **OPEN**                                                                        |

## Design

- **One visibility rule.** `feedCategoryScope` is the category half of the
  provider visibility predicate; `serviceAreaWhere` is the geographic half.
  Both feeds, request detail and bid submission call both; the bid path runs
  them on the request row it has locked.
- **Acceptance re-decides authority.** A booking is a new obligation, so the
  question is `SUBMIT_BID`, asked of the one capability service. Every writer
  of standing, legacy status and verification updates the account or profile
  row, so a `FOR SHARE` lock on both orders the accept against them. A
  grant-only close is read at statement time, which orders the accept first.
  Lock order is request → account → profile; no writer takes them the other
  way round.
- **No new authority on the client.** The web workspace renders the
  capability endpoint's answer and asks again more often. Routes hide what the
  server refuses; they grant nothing.
- **Provider booking surfaces** are the existing endpoints. The detail screen
  shows the provider projection: service, customer first name and city, offer,
  schedule, address line and city, request text, bid note, and the persisted
  timeline. It does not show coordinates, contact details, ETA or live location.

No schema change, no migration, no contract change, no new permission, no
feature flag.

## Query plans (representative volume)

50 000 synthetic requests (20 categories, 50 cities, 20 % cancelled) and
5 000 accounts on PostgreSQL 16, removed afterwards.

| Query                                                | Plan                                                                                                                | Time    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------- |
| Feed page (two categories, one city, 21 rows)        | bitmap AND of `ServiceRequest_status_deletedAt_locationCityKey_idx` and `ServiceRequest_categoryId_idx`, top-N sort | 2.1 ms  |
| Accept: account lock (`User` by id `FOR SHARE`)      | `LockRows` over an index scan on `User_pkey`                                                                        | 0.08 ms |
| Accept: profile lock (`ProviderProfile` by `userId`) | `LockRows`; `userId` is uniquely indexed (seq scan only on the 7-row local table)                                   | 0.04 ms |

The feed's shape is unchanged for providers with categories; it no longer
runs without a category clause. Pagination stays bounded (≤100), and the
bid-count lookup is still one grouped query per page.

## Evidence

Levels: U unit, H real HTTP through the real AppModule with real PostgreSQL
and Redis, B real browser on real Vite against the same.

| Spec                                                                         | Level | Cases            | Baseline                             | After                                 |
| ---------------------------------------------------------------------------- | ----- | ---------------- | ------------------------------------ | ------------------------------------- |
| `r17-provider-surfaces.integration.spec.ts`                                  | H     | 30               | 4 failed / 19 passed of the first 23 | 30/30                                 |
| `r17-provider-surfaces-browser.integration.spec.ts`                          | B     | 1 (14 steps)     | —                                    | 1/1, 14/14 steps                      |
| `r17e-baseline-regression.test.tsx`                                          | U     | 3                | 3 failed against `2710d25` sources   | 3/3                                   |
| R17-E web unit (5 new files; additions to ProviderApp and BidsScreen suites) | U     | 44 new (35 + 9)  | —                                    | pass                                  |
| R17-E API unit (2 new files; additions to bids, provider, feed suites)       | U     | 27 new (16 + 11) | —                                    | pass; 283/283 in the 9 touched suites |

P30 is a mutation-checked concurrency proof: a real transaction holds the
suspension UPDATE open, the accept is observed blocked on it through
`pg_blocking_pids`, and it refuses once the suspension commits. With the two
`FOR SHARE` locks removed, P30 fails ("accept never waited").

### Browser journey (real password/OTP, no interception)

1. Provider session.
2. Feed, detail and bid agree: the matching request is listed; the foreign
   category is absent, `?category=<foreign>` is empty, detail 404, bid 404.
3. Bid through the form; after a reload it is Pending, priced as stored.
4. Withdraw: Enter opens the dialog with the safe choice focused, Escape keeps
   the bid and returns focus, confirming withdraws it; the database agrees.
5. Relogin: the bid is still Withdrawn.
6. A second bid; the seeker accepts; the booking appears; another provider
   gets 404 on withdraw, read and start.
7. Start, reload (In progress), Complete, reload (Completed); three persisted
   events.
8. Cancel: Keep sends nothing; confirming cancels once.
9. Cancelled on another device first: 409, "changed in the meantime", and the
   screen shows Cancelled.
10. Restricted mid-session: within the refresh interval the workspace moves to
    Bookings with a notice; the feed answers 403; the completed booking is
    still listed; an existing booking can still be started.
11. Grant revoked mid-session: Start answers 403, the workspace closes to the
    status page, the booking stays SCHEDULED, nothing claims success.
12. Wallet withdrawal disabled; no write request.
13. Arabic RTL at 320, 390, 768 and 1440 px on Bookings, a booking, My Bids,
    and the open cancel dialog at 320 px: 0 px overflow, 0 axe violations
    (WCAG 2A/2AA/2.1AA/2.2AA tags).
14. Session revoked elsewhere: Start answers 401, nothing claimed, booking
    unchanged.

Screenshots inspected: `bookings-ar-320`, `bids-ar-320`,
`booking-detail-ar-768`, `cancel-dialog-ar-320`,
`booking-detail-completed-en-1440`. Inspection found what no assertion did:
a Latin address in the Arabic page lost its house number to the end (bidi),
the pricing basis split mid-phrase at 320 px, an empty Time box, and an empty
Actions block on a finished booking. All four were fixed and re-verified.

## Local preflight

Windows 11, Node 24.21.0, pnpm 10.32.1, throwaway PostgreSQL 16 and Redis 7
containers on free ports (never the developer's stack).

| Check                                                                                                              | Result                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma generate, migrate deploy on a fresh database (67 migrations), migrate status, validate, `verify:migrations` | pass; no schema or contract change                                                                                                                                                                                                                                                                                                                                                                |
| API `tsc --noEmit` (src + test), eslint on changed files, `nest build`                                             | pass                                                                                                                                                                                                                                                                                                                                                                                              |
| API hermetic unit suite                                                                                            | 4096 passed, 1489 skipped (DB-gated), **1 failed**: `restricted-erasure.spec.ts` ENOTDIR, the known Windows-only baseline failure (green on Ubuntu CI)                                                                                                                                                                                                                                            |
| R17-E real-HTTP spec                                                                                               | 30/30 (repeated after each change; last run after the cleanup fix)                                                                                                                                                                                                                                                                                                                                |
| R17-E real-browser spec                                                                                            | 1/1, 14/14 steps                                                                                                                                                                                                                                                                                                                                                                                  |
| Full DB/Redis-gated API suite                                                                                      | **not completed locally**: stopped by the host's memory-pressure guard part-way. Before it stopped: `restricted-erasure` (above), `outbox` (claimed another suite's leftover `notification.created` row) and `r17-notifications` B-1 (the recorded Docker clock-skew flake). The R17-E specs were found to leave such rows too and now remove them. The full suite is evidenced by hosted CI only |
| Web `tsc -b`, `typecheck:e2e`, production build (`VITE_API_URL` set)                                               | pass                                                                                                                                                                                                                                                                                                                                                                                              |
| Web eslint                                                                                                         | 0 errors, 34 warnings (develop also has 34)                                                                                                                                                                                                                                                                                                                                                       |
| Web vitest                                                                                                         | 195 files, 2435 passed                                                                                                                                                                                                                                                                                                                                                                            |
| Governance (`.github/scripts/*.test.mjs`, production-governance, release-baseline)                                 | 120 passed; pass; pass                                                                                                                                                                                                                                                                                                                                                                            |
| `security:audit` / `security:audit:prod`                                                                           | **develop fails** the full-tree audit (handlebars ≤4.7.9 via ts-jest: 2 critical, 1 moderate, published after R17-D). With the separate override commit: 0 / 0 at every severity                                                                                                                                                                                                                  |
| Tracked-tree secret scan (gitleaks 8.24.3, checksum-verified)                                                      | 2156 files, no leaks; branch history 9 commits, no leaks                                                                                                                                                                                                                                                                                                                                          |

Not run locally: Docker cold build, compose smoke, CodeQL; hosted CI.

## CI wiring

One step and one upload in the existing _Dispute journey_ job, after R17-D's,
behind `RUN_PROVIDER_BROWSER`:

- seed (idempotent), browser spec first, then the real-HTTP spec;
- fails closed unless exactly 31 cases pass with 0 failed, pending or todo;
- artifact `r17e-provider-real-evidence` (`if-no-files-found: error`): jest
  JSON, screenshots and the overflow/axe JSON; no cookies, tokens or personal
  data (fixtures are synthetic).

The real-HTTP spec also runs in _Integration & E2E_. No existing step, gate or
timeout changed.

## Rollback

Revert the R17-E commits. There is no migration and no data rewrite.

- Requests, bids, bookings, events, reviews, messages, evidence and ledger
  rows written while R17-E was live are valid under the old code.
- Bids refused at accept stayed PENDING, so after a rollback they are
  acceptable exactly as before.
- Rollback reopens E-1/E-2 (category widening), E-3 (stale acceptance) and the
  silent booking actions.

## Known limitations

- **Owner decisions** (`R17_E_PROVIDER_POLICY.md`): custom-text requests,
  pending bids after a capability loss, booking obligations after lapsed
  access or suspension, recognition, money unit, deactivated categories.
- **Money.** The money unit and currency stay `POLICY_BLOCKED` (R16 P8, R17-D
  decision 5). Payouts and wallet withdrawal stay R16-blocked; nothing here
  touches them.
- **Provider-initiated writes** check capability in the guard and state in the
  transaction. A suspension committing between the two orders after the write;
  only acceptance needed the stronger lock (see the matrix).
- **Fan-out audience** (E-13) and the provider bell button's 36 px target are
  recorded, not changed.
- **Realtime production cutover, calling and live GPS** are not part of R17-E.
- **Mechanical formatting.** The pre-commit hook reflowed two untouched
  provider-ui files (`forms.tsx`, `choice-contrast.test.tsx`; whitespace only).
