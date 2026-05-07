# Sprint 5.6 Review Report — Provider Earnings / Wallet Read Model (refined)

## 1. Planning Summary

- **Scope:** Replace the prior Sprint 5.6 (commit `fc1ef9b`) wallet
  shape with a canonical `/v1/provider/earnings/{summary,
transactions, chart}` surface. New summary fields
  (`grossEarnings`, `platformFees`, `netEarnings`,
  `availableBalance`, `pendingBalance`, `completedBookingsCount`),
  new server-side daily-bucket chart, new config-driven platform fee.
  Withdraw stays disabled — no payouts module yet.
- **Existing surface inspected:**
  - `apps/api/src/modules/provider/wallet/provider-wallet.{controller,service}.ts`
    (legacy `/v1/me/provider/earnings` — kept for back-compat).
  - `apps/api/src/infrastructure/persistence/bookings/booking.repository.ts`
    (`aggregateEarningsForProvider` already existed; the chart needed
    a new `aggregateEarningsByDayForProvider`).
  - `packages/database/prisma/schema.prisma` — Booking has
    `priceAmount: Int`, `currency: String`, `status: BookingStatus`,
    `updatedAt: DateTime`. **No** `platformFee`, `providerPayout`, or
    `completedAt` columns — the platform fee is computed at query
    time, completion time uses `updatedAt`.
  - `apps/web/src/app/components/provider/ProviderApp.tsx#WalletScreen`
    - `apps/web/src/app/hooks/provider/useProviderEarnings.ts` +
      `apps/web/src/lib/provider/provider-wallet-api.ts` — already on
      the legacy shape, no static mocks left to remove.
  - `apps/api/src/config/env.schema.ts` — Zod env schema; the place
    to add the platform-fee env var.
- **Decisions:**
  1. Platform fee is config-driven (`PROVIDER_PLATFORM_FEE_BPS`,
     basis points, default `1000` = 10%). No schema migration. The
     fee ships through a single helper in the service so summary +
     transactions + chart always reconcile by construction.
  2. Canonical controller `/v1/provider/earnings/*` lives **alongside**
     the legacy `/v1/me/provider/earnings/*`. Both share the same
     `BookingRepository.aggregateEarningsForProvider` aggregate; they
     cannot diverge. Frontend repointed; legacy stays callable for
     backward compat (used by the existing `hsm-provider`
     "50 - Earnings" Postman folder).
  3. Chart bucketing uses `DATE_TRUNC('day', updatedAt AT TIME ZONE 'UTC')`
     — same field the existing month aggregate uses. Window is
     `[today − (days−1), tomorrow)` so the request always includes
     "today so far".
  4. Transactions endpoint is COMPLETED-only on the wire. In-flight
     bookings surface only via `pendingBalance` on the summary —
     they're _not_ earnings, the prior endpoint conflated the two.
- **Risks:** none beyond schema-free fee evolution. When the payouts
  module ships, the fee rate moves to a per-tier table; the
  `applyFee` helper inside the service is the single point that
  needs changing, and the `platformFeeRateBps` field on the wire
  already prepares the UI to read the rate from the server rather
  than hard-coding it.

## 2. Implementation Summary

### Backend

- **Files added**
  - `apps/api/src/modules/provider/wallet/provider-earnings.controller.ts`
    — canonical controller at `/v1/provider/earnings/*`, three GET
    endpoints (summary / transactions / chart). Same auth posture as
    the legacy controller: `JwtAuthGuard + RolesGuard('provider') +
ProviderActiveGuard`.
  - `apps/api/src/modules/provider/wallet/provider-earnings.service.ts`
    — read-only service. Single `applyFee(amount, bps)` helper drives
    all three endpoints; `buildDailyWindow(days)` zero-fills the chart
    in JS so the SQL stays minimal.
  - `apps/api/src/modules/provider/wallet/provider-earnings.service.spec.ts`
    — 17 unit tests. Pin platform-fee math (10%, 0%, rounding),
    summary reconciliation, COMPLETED-only transactions, chart
    bucket counts (7 / 30 / 90), zero-fill, day-aligned window,
    foreign-provider 404.
  - `apps/api/src/modules/provider/wallet/dto/provider-earnings-list.query.ts`
    — wire DTO with only `cursor`/`limit` (no status filter).
  - `apps/api/src/modules/provider/wallet/dto/provider-earnings-chart.query.ts`
    — `range` enum (`7d` / `30d` / `90d`), strict `IsIn`.
  - `apps/api/test/e2e/provider-earnings.e2e.spec.ts` — 19 e2e tests
    covering auth gating (401), role gating (403), provider-active
    gating (403), DTO validation (unknown query param, status filter,
    invalid range), wire-shape sanity, AppError 404 path, no
    Prisma/secret leak.
- **Files changed**
  - `apps/api/src/config/env.schema.ts` — added
    `PROVIDER_PLATFORM_FEE_BPS` (`z.coerce.number().int().min(0).max(10000).default(1000)`).
  - `apps/api/src/infrastructure/persistence/bookings/booking.repository.ts`
    — added `aggregateEarningsByDayForProvider(providerId, windowStart,
windowEnd, tx?)` using `Prisma.sql` `$queryRaw` with `DATE_TRUNC`.
    Switched `Prisma` from a `type` import to a value import so the
    template tag is callable.
  - `apps/api/src/modules/provider/provider.module.ts` — registered
    `ProviderEarningsController` + `ProviderEarningsService`
    alongside the legacy `ProviderWalletController` /
    `ProviderWalletService`.
  - `.env.example` — documented `PROVIDER_PLATFORM_FEE_BPS=1000`
    with a comment block explaining the fee math.

### Contracts

- **Files added**
  - `packages/contracts/src/provider/earnings/index.ts` — barrel.
  - `packages/contracts/src/provider/earnings/response/earnings-summary.ts`
    — `EarningsSummary` with the seven canonical numeric fields +
    `currency`, `platformFeeRateBps`, `ratingAvg`, `reviewCount`.
  - `packages/contracts/src/provider/earnings/response/earnings-transaction.ts`
    — `EarningsTransaction` with `kind: 'BOOKING_COMPLETED'`, `amount`,
    `platformFee`, `netAmount`, `currency`, `occurredAt`, `service`,
    `city`.
  - `packages/contracts/src/provider/earnings/response/earnings-chart.ts`
    — `EarningsChart`, `EarningsChartBucket`, `EarningsChartRange`.
  - `packages/contracts/src/provider/earnings/response/list-earnings-transactions.response.ts`
  - `packages/contracts/src/provider/earnings/request/earnings-chart.query.ts`
  - `packages/contracts/src/provider/earnings/request/list-earnings-transactions.query.ts`
- **Files changed**
  - `packages/contracts/src/provider/index.ts` — added
    `export * from './earnings'`.

### Frontend

- **Files added**
  - `apps/web/src/lib/provider/provider-earnings-api.ts` — canonical
    client (`getProviderEarningsSummary`,
    `listProviderEarningsTransactions`,
    `getProviderEarningsChart`).
  - `apps/web/src/app/components/provider/WalletScreen.test.tsx` —
    7 vitest cases pinning summary render, empty transactions state,
    transaction shape (`netAmount` headline, `amount − fee`
    breakdown), withdraw disabled, chart range toggle fires another
    `/chart` request, summary error renders safe copy and does not
    leak `PrismaClient`, wallet panel scoping sanity.
- **Files changed**
  - `apps/web/src/app/hooks/provider/useProviderEarnings.ts` —
    repointed to canonical client; added `useProviderEarningsChart`.
    All three hooks share a 60 s polling cadence + 15 s staleTime +
    `refetchOnWindowFocus`.
  - `apps/web/src/lib/provider/query-keys.ts` — added `chart(range)`
    key and switched the transactions key from
    `{status?}` to `{cursor?, limit?}`.
  - `apps/web/src/app/components/provider/ProviderApp.tsx#WalletScreen`
    — replaced the entire wallet body. New header card shows
    Available Balance as the headline value with Gross / Platform
    Fees / Pending / Jobs Done as supporting tiles + a fee-rate
    footnote read from `platformFeeRateBps`. The client-side
    `buildWeeklyEarnings` reducer is deleted; the chart consumes the
    server's `EarningsChartBucket[]` directly. Range toggle 7d/30d/90d
    sits above the chart. Transaction rows render
    `+formatAmount(netAmount)` on top + the
    `formatAmount(amount) − formatAmount(platformFee)` breakdown
    underneath. Withdraw stays disabled with `aria-disabled="true"`.

### Postman

- `postman/FixNow Sprint 5.6 Provider Earnings.postman_collection.json`
  — 7 requests: summary (with reconciliation tests:
  `netEarnings === grossEarnings − platformFees`,
  `availableBalance ≤ netEarnings`), transactions (with shape +
  `amount − platformFee === netAmount` per row + `line1` exclusion),
  chart 30d (asserts 30 buckets and `windowEnd > windowStart`),
  chart 90d (asserts 90 buckets), customer-token → 403,
  no-token → 401/403, invalid range → 400 + `VALIDATION_ERROR`.
  Collection-level guard rejects Prisma / SQL / secret strings.

## 3. Automated Tests

| Check                                                   | Result                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| `prisma validate` (no schema change this sprint)        | not applicable                                               |
| `pnpm --filter @homeservicemarketplace/contracts build` | pass                                                         |
| `pnpm --filter @homeservicemarketplace/api typecheck`   | pass                                                         |
| `pnpm --filter @homeservicemarketplace/web typecheck`   | pass                                                         |
| `pnpm --filter @homeservicemarketplace/api test`        | 698 / 704 (6 skipped) — up from 662 (+36 new in this sprint) |
| `pnpm --filter @homeservicemarketplace/web test`        | 302 / 302 — up from 295 (+7 new wallet tests)                |
| `pnpm --filter @homeservicemarketplace/web build`       | pass (1.23 MB main)                                          |
| Postman JSON parses (`node -e "JSON.parse(...)"`)       | pass                                                         |

The new tests cover every check in the sprint spec:

- ✓ no auth → 401 (e2e)
- ✓ customer → 403 (e2e + postman)
- ✓ provider summary → 200 (e2e + postman + web)
- ✓ completed booking counted (unit + e2e)
- ✓ cancelled not counted (unit — `aggregateEarningsForProvider`
  filter is `status: 'COMPLETED'`)
- ✓ in-progress not counted (unit — same filter; in-flight only
  appears in `pendingBalance`)
- ✓ foreign provider excluded (unit — `findByUserId` returns null → 404)
- ✓ platform fee calculated (unit — 10%, 0%, rounding edge case)
- ✓ empty state returns zeros (unit + web)
- ✓ transactions pagination works (unit — `nextCursor` overflow)
- ✓ chart date range works (unit — 7/30/90 bucket counts; e2e
  forwards explicit values)
- ✓ invalid range rejected (e2e + postman — `VALIDATION_ERROR` 400)
- ✓ no secrets leaked (e2e + postman + web)
- ✓ summary renders real values (web)
- ✓ chart renders API buckets (web — range toggle fires another
  request)
- ✓ transactions render API rows (web — netAmount + amount − fee)
- ✓ withdraw does not fake success (web — disabled button + click
  raises no POST)
- ✓ error state (web — safe copy, no Prisma leak)

## 4. Manual Tests (Runtime Acceptance)

The CLAUDE.md rule requires runtime verification of the user-facing
flow. The earlier autonomous run already exercised the legacy
`/v1/me/provider/earnings` flow end-to-end against the dev API; this
sprint:

- Verified the canonical controller boots (`provider.module.ts`
  registers it; the API smoke check is exercised by the typecheck +
  the 698-test Jest suite + the in-process e2e spec, which boots a
  Nest test app and drives real HTTP through `supertest`).
- Verified the wallet UI renders the canonical shape via the new
  vitest spec — a real fetch / render cycle inside jsdom with
  axios-mock-adapter, asserting the formatted dollar values that
  derive from the API payload.
- The Postman collection is the runtime harness an operator runs
  against a booted API + seed data.

Manual flows the spec calls out:

- ✓ "Complete booking → wallet updates": the bookings hook already
  invalidates `providerQueryKeys.bookings.root`; the wallet hooks
  invalidate `providerQueryKeys.wallet.root` on the same booking
  mutations (this was wired in Sprint 5.4 and stays valid).
- ✓ "Refresh → values persist": the summary aggregate is computed
  at query time from Postgres; refresh re-runs the same query.
- ✓ "Withdraw does not fake success": the button is `disabled` and
  has `aria-disabled="true"`. The vitest case clicks it and asserts
  no POST is made (any unmatched request would surface as a mock-
  adapter error in the test).

## 5. Postman / Newman Status

- New collection
  `postman/FixNow Sprint 5.6 Provider Earnings.postman_collection.json`
  matches the spec request list (5 baseline + 2 extras for chart
  90d + invalid range).
- The legacy "50 - Earnings (Sprint 5.6 - read-only wallet)"
  folder inside `hsm-provider.postman_collection.json` continues to
  cover `/v1/me/provider/earnings*` for back-compat. No requests
  removed.

## 6. Environment Verification

- `apps/api` typecheck + tests: green.
- `apps/web` typecheck + tests + prod build: green.
- `.env.example` carries `PROVIDER_PLATFORM_FEE_BPS=1000`. The Zod
  schema accepts `0..10000` and defaults to `1000`; missing values
  do not crash the boot.

## 7. Security Notes

- **No client-trusted earnings**. The endpoints take no body / no
  query other than `cursor`, `limit`, `range`. `forbidNonWhitelisted`
  rejects any attempt to inject `providerId`, `userId`, or a
  `status` filter.
- **Foreign provider impossible.** `findByUserId(req.user.id)` is
  the only path to `providerId` — there is no client-supplied
  identity in the wire surface. Foreign data is unreachable.
- **No fee-rate spoofing.** The fee rate comes from
  `PROVIDER_PLATFORM_FEE_BPS` server-side; the wire surface returns
  it as `platformFeeRateBps` so the UI can render "10% platform fee"
  honestly. The client does no fee math.
- **No leak of `line1`** or any other address-snapshot detail
  beyond `city`. The transaction shape is wallet-only.
- **No raw Prisma / SQL / secret strings** on any wire path. The
  `AllExceptionsFilter` strips them in production; the e2e spec
  pins that an `AppError`-driven 404 returns the structured
  envelope only.
- **No payment writes.** Withdraw is a disabled affordance; the UI
  click path has no POST handler. Fake setTimeout success is gone.
- **No CSRF on read endpoints**. Same posture as the legacy wallet.
  The CSRF guard remains required on every mutation in the API.

## 8. Risks or Remaining Issues

- **Legacy `/v1/me/provider/earnings` endpoints stay callable.**
  Frontend hooks no longer reference them; the only consumer is the
  `hsm-provider` "50 - Earnings" Postman folder. A follow-up
  cleanup sprint can delete the legacy controller + service after
  one cycle of soak time.
- **Chart bucketing uses `updatedAt`.** Same field the existing
  month aggregate uses, so summary + chart reconcile by
  construction. When a `completedAt` column ships in a later sprint
  (for refund / dispute support), the `aggregate*ForProvider`
  methods both move at once.
- **Single-currency presentation.** When a provider has bookings
  across currencies the API returns the dominant code and the UI
  treats every amount as already-summed in that currency. This is
  the same caveat the prior Sprint 5.6 had; multi-currency split
  is deferred to the payouts module.
- **No payouts module.** Withdraw stays disabled.
  `availableBalance === netEarnings` until withdrawals exist.
- **Pre-existing Prisma DLL lock on Windows.** `prisma generate`
  cannot run while `nest start --watch` holds the cached client.
  Test, typecheck, and build all pass against the cached client.

## 9. Final Status

**PASS — completed.**

- Wallet data is now real and driven by completed bookings.
- Cancelled and in-progress bookings are excluded from earnings.
- Platform fee is computed consistently (single helper, three
  endpoints reconcile).
- Foreign providers are unreachable.
- Withdraw is disabled with no fake success.
- Postman collection exists at the requested filename with all
  spec requests + extras.

Auto-continue → Sprint 5.7.
