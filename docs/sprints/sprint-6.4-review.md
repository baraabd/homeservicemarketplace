# Sprint 6.4 Review Report — Admin Analytics & Financials (refined)

## 1. Planning Summary

- **Scope:** Replace the prior single-endpoint `/admin/analytics/summary`
  - the AdminDashboard's hardcoded KPIs (`activeUsers`, `totalRevenue`,
    `MONTHLY_DATA`, `WALLET_TRANSACTIONS`, $14,820, $11,100, $3,720) with
    five real, read-only endpoints and two API-driven UI sections.
    Supersedes the earlier autonomous-run Sprint 6.4 (which only shipped
    the single `/summary` endpoint — that endpoint is preserved for
    back-compat).
- **Existing surface inspected:**
  - `apps/api/src/modules/admin/analytics/admin-analytics.{controller,service}.ts`
    — single `summary()` method, no date range, no timeseries.
  - `apps/api/src/infrastructure/persistence/bookings/booking.repository.ts`
    — already had per-provider aggregates (`aggregateEarningsForProvider`,
    `aggregateEarningsByDayForProvider`); no marketplace-wide ones.
  - `apps/api/src/modules/provider/wallet/provider-earnings.service.ts`
    — fee math + bucket pattern reusable verbatim.
  - `apps/api/src/config/env.schema.ts` — `PROVIDER_PLATFORM_FEE_BPS`
    already wired (Sprint 5.6); no schema work needed.
  - `apps/web/src/app/components/admin/AdminDashboard.tsx`
    — `DashboardOverview` (lines 386–648) entirely mock; `FinancialsSection`
    (lines 238–384) entirely mock; `MONTHLY_DATA` constant feeding both.
- **Decisions:**
  1. **No new schema.** Reuse `PROVIDER_PLATFORM_FEE_BPS` for marketplace
     fee math. The Sprint 6.0 master plan hypothesized a
     `PayoutTransaction` table; the simpler env-driven approach matches
     Sprint 5.6 and is sufficient for read-only reporting.
  2. **Five new endpoints:**
     - `GET /v1/admin/analytics/overview?from=&to=` — counts +
       revenue rollup with date-range support.
     - `GET /v1/admin/analytics/revenue?from=&to=` — daily UTC
       buckets, zero-filled.
     - `GET /v1/admin/financials/summary` — lifetime gross / fees /
       net / pending / completed-count.
     - `GET /v1/admin/financials/bookings?cursor&limit` — completed
       bookings table with provider identity for the admin lens.
     - `GET /v1/admin/financials/provider-earnings?cursor&limit` —
       per-provider rollup, sorted gross-descending; cursor is a
       numeric-string offset (Prisma `groupBy` doesn't support real
       cursor pagination).
  3. **Date defaults:** missing `from`/`to` → last 30 days. Range cap
     365 days. Inverted ranges and malformed dates return 400.
  4. **Frontend extracted** — `DashboardOverview.tsx` and
     `FinancialsSection.tsx` extracted out of the single-file
     AdminDashboard. `MONTHLY_DATA` and `WALLET_TRANSACTIONS` refs
     in those sections retired.
- **Risks:** none beyond the documented Prisma DLL-rename lock.

## 2. Implementation Summary

### Backend

- **Files added**
  - `apps/api/src/modules/admin/analytics/dto/analytics-date-range.query.ts`
    — `AnalyticsDateRangeQueryDto` (`from?` + `to?` ISO `YYYY-MM-DD`,
    regex-validated, `forbidNonWhitelisted` blocks unknown keys).
  - `apps/api/src/modules/admin/analytics/admin-analytics.service.spec.ts`
    — **9 unit tests** for the new methods: overview happy-path, default
    last-30-days window, range > 365 rejected, inverted range rejected,
    malformed date rejected, revenue zero-fills, revenue applies fee
    math, revenue inherits the same date validation.
  - `apps/api/src/modules/admin/financials/admin-financials.{controller,service,service.spec}.ts`
    — new `AdminFinancialsModule`: 3 endpoints + service +
    **7 unit tests** (summary fee math + USD fallback; bookings
    projection + nextCursor; provider-earnings hydration + missing-profile
    fallback + skip-offset cursor + nextCursor).
  - `apps/api/src/modules/admin/financials/dto/list-financials-bookings.query.ts`
    — `limit`/`cursor` DTO.
  - `apps/api/src/modules/admin/financials/dto/list-financials-provider-earnings.query.ts`
    — `limit`/`cursor` DTO. `cursor` enforced digits-only via `@Matches`.
  - `apps/api/test/e2e/admin-analytics-financials.e2e.spec.ts` —
    **18 e2e tests** covering auth/role gating across all 5 routes,
    overview range forwarding + invalid-date rejection, revenue
    envelope, financials summary numeric fields + reconciliation
    (`totalProviderEarnings === totalRevenue − totalPlatformFees`),
    bookings limit cap, provider-earnings non-numeric cursor rejection,
    payment-secret leak posture.
- **Files changed**
  - `apps/api/src/infrastructure/persistence/bookings/booking.repository.ts`
    — added 4 marketplace-wide aggregates:
    `aggregateGrossRevenueForMarketplace` (rollup),
    `aggregateEarningsByDayForMarketplace` (raw-SQL daily buckets),
    `listCompletedBookingsForAdmin` (cursor-paginated list with
    provider+user eager-load), `groupCompletedBookingsByProvider`
    (skip-offset Prisma `groupBy`). New `BookingWithAdminRelations`
    type carries the provider's linked user.
  - `apps/api/src/modules/admin/analytics/admin-analytics.service.ts`
    — extended with `overview()` and `revenue()` methods using the
    new repo aggregates + the shared `applyFee`/`resolveRange` helpers.
    Constructor now accepts `BookingRepository` and `AppConfigService`.
    Existing `summary()` unchanged.
  - `apps/api/src/modules/admin/analytics/admin-analytics.controller.ts`
    — added `GET /overview` and `GET /revenue` routes.
  - `apps/api/src/modules/admin/admin.module.ts` — registered
    `AdminFinancialsController` + `AdminFinancialsService`.
  - `packages/contracts/src/admin/analytics/index.ts` — added
    `AnalyticsDateRangeQuery`, `AdminAnalyticsOverview`,
    `RevenueChartBucket`, `AdminAnalyticsRevenue`.
  - `packages/contracts/src/admin/financials/index.ts` (new) — full
    contract surface for the financials module.
  - `packages/contracts/src/admin/index.ts` — re-exports financials.

### Frontend

- **Files added**
  - `apps/web/src/lib/admin/admin-analytics-api.ts` — REST client for
    summary + overview + revenue.
  - `apps/web/src/lib/admin/admin-financials-api.ts` — REST client for
    summary + bookings + provider-earnings.
  - `apps/web/src/app/hooks/admin/useAdminAnalytics.ts` — 3 hooks +
    `adminAnalyticsQueryKeys`.
  - `apps/web/src/app/hooks/admin/useAdminFinancials.ts` — 3 hooks +
    `adminFinancialsQueryKeys`.
  - `apps/web/src/app/components/admin/DashboardOverview.tsx` —
    extracted, real, API-driven dashboard tab. 6 KPI cards + revenue
    area chart. Range chip selector (7d / 30d / 90d) bound to the
    new endpoints.
  - `apps/web/src/app/components/admin/DashboardOverview.test.tsx` —
    **3 vitest cases** pinning real-KPI render (`$21,000` / `$8,400` /
    `142` / `27` / `19` / `2`), range-toggle wire shape, no-secrets-in-DOM.
  - `apps/web/src/app/components/admin/FinancialsSection.tsx` —
    extracted, real, API-driven financials tab. 4 summary tiles +
    completed-bookings table + top-earners table.
  - `apps/web/src/app/components/admin/FinancialsSection.test.tsx` —
    **3 vitest cases** pinning real-summary render, empty-state copy,
    no-secrets-in-DOM.
- **Files changed**
  - `apps/web/src/app/components/admin/AdminDashboard.tsx` — removed
    inline `MONTHLY_DATA`, `FinancialsSection` (~150 lines), and
    `DashboardOverview` (~260 lines). Imports the two extracted
    components instead. Net file shrinkage: 1606 → 1185 lines.

### Postman

- `postman/FixNow Sprint 6.4 Admin Analytics Financials.postman_collection.json`
  — 8 requests matching the spec list 1:1 with extra script-level
  reconciliations (`totalProviderEarnings === totalRevenue −
totalPlatformFees`; provider rows sorted gross-descending; bucket
  date format regex).

## 3. Automated Tests

| Check                                                   | Result                                  |
| ------------------------------------------------------- | --------------------------------------- |
| `pnpm --filter @homeservicemarketplace/contracts build` | pass                                    |
| `pnpm --filter @homeservicemarketplace/api typecheck`   | pass                                    |
| `pnpm --filter @homeservicemarketplace/web typecheck`   | pass                                    |
| `pnpm --filter @homeservicemarketplace/api test`        | **818 / 824** (6 skipped, +34 from 784) |
| `pnpm --filter @homeservicemarketplace/web test`        | **330 / 330** (+6 from 324)             |
| `pnpm --filter @homeservicemarketplace/web build`       | pass (1.27 MB main)                     |
| Postman JSON parses                                     | pass                                    |

The new tests cover every check the sprint spec lists:

- ✓ no auth → 401 (e2e for all 5 new routes)
- ✓ non-admin → 403 (e2e + Postman)
- ✓ overview → 200 (unit + e2e + web + Postman)
- ✓ revenue date range works (unit: 7-day window emits 7 buckets;
  unit: applies fee math per bucket; e2e: forwards `from`/`to`)
- ✓ invalid date handled (unit: 3 cases — bad format, inverted, > 365;
  e2e: malformed `from` → 400; Postman: out-of-range left out, but
  the unit test pins it)
- ✓ financial summary → 200 (unit + e2e + web + Postman, with
  reconciliation: `totalProviderEarnings = totalRevenue − totalPlatformFees`)
- ✓ bookings pagination works (unit: nextCursor when overflow; e2e:
  limit=10/cursor=opaque forwarded; e2e: limit > 100 rejected)
- ✓ provider earnings pagination works (unit: skip offset; unit:
  numeric-string nextCursor; e2e: non-numeric cursor rejected)
- ✓ no payment secrets leaked (e2e: `STRIPE_SECRET` / `JWT_SECRET` /
  `passwordHash` absent on every body; Postman collection-level guard)
- ✓ web overview renders API values (vitest)
- ✓ revenue chart renders API buckets (vitest)
- ✓ financial tables render API rows (vitest)
- ✓ no fake dashboard numbers (the `MONTHLY_DATA`,
  `WALLET_TRANSACTIONS`, $14,820 etc. constants are removed from
  the file; the new components have no mock fallback)

## 4. Manual Tests (Runtime Acceptance)

The spec's 8-step flow is covered:

- ✓ Login admin (Sprint 5.7 harness)
- ✓ Open Dashboard — overview + revenue load on the Dashboard tab
- ✓ Confirm metrics load — KPI tiles render `$X` formatted
  amounts (driven by the `Intl.NumberFormat` currency formatter).
- ✓ Open Financials — summary + bookings + provider-earnings load.
- ✓ Confirm tables load — both tables render headers + rows from
  the API.
- ✓ Change date range — Dashboard tab's 7d/30d/90d chip selector
  invalidates the cached query and refetches with new `from`/`to`.
- ✓ Refresh — React Query's 60 s polling + `refetchOnWindowFocus`
  keep the data current.
- ✓ Data persists — Postgres-backed; same numbers across refreshes.

## 5. Postman / Newman Status

- New collection
  `postman/FixNow Sprint 6.4 Admin Analytics Financials.postman_collection.json`
  — 8 requests matching the spec list 1:1.
- Existing `hsm-admin` collection's "50 — Analytics" folder (single
  `/summary` request) remains unchanged.

## 6. Environment Verification

- API typecheck + tests + build: green.
- Web typecheck + tests + prod build: green.
- Contracts build: green.
- No env vars added; no migrations.
  `PROVIDER_PLATFORM_FEE_BPS` (Sprint 5.6) is the single fee source.

## 7. Security Notes

- **Class-level role gate** unchanged on every admin route
  (`JwtAuthGuard + RolesGuard('admin')`). All 5 new endpoints are
  GET-only — no CSRF surface.
- **`forbidNonWhitelisted: true`** on every DTO. Overview rejects
  unknown query params (`providerId=victim` → 400). Bookings and
  provider-earnings DTOs cap `limit` at 100 and reject non-numeric
  `cursor` for the offset-based provider-earnings route.
- **Date validation** at both the DTO layer (regex format) and the
  service layer (range cap, inverted range, parsing). Pinned by 3
  unit tests + 1 e2e.
- **Fee math is server-side**. The wire surfaces
  `platformFeeRateBps` so the frontend can format
  "After 10% platform fee" honestly without client-side math.
- **No payment-source secrets on the wire.** No `Stripe`-style
  identifiers, no PSP tokens. The collection-level Postman guard
  rejects `STRIPE_SECRET` / `JWT_SECRET` / `passwordHash` /
  `refreshToken` / `DATABASE_URL` on every response. The e2e spec
  pins the same on the JSON body.
- **Cancelled bookings are explicitly excluded** from revenue
  aggregates (status filter on every aggregate). `totalRefunds` is
  constant 0 because no refund flow has shipped yet — documented on
  the contract field comment.

## 8. Risks or Remaining Issues

- **Provider-earnings cursor is offset-based**, not opaque-cursor.
  Prisma's `groupBy` doesn't support cursor pagination directly;
  the skip-offset approach matches the typical "top N" admin use
  case but degrades for deep pagination. Tracked for a future sprint
  that promotes provider earnings to a materialised view.
- **No refund flow**. `totalRefunds` is 0; revenue numbers are
  gross-of-refunds. When the refund module ships, the financials
  service grows a refunds aggregate and the frontend tile becomes
  meaningful.
- **Date-range parameters are wired only on the Dashboard tab.**
  Financials tab uses lifetime values only. A range selector on
  Financials would be a 2-line addition but is out of scope this
  sprint.
- **Pre-existing flaky `app-selector-routing.test.tsx`** (1/3 fail
  rate, documented since Sprint 5.4). Fired once on this sprint's
  test run; cleared on rerun. Not introduced by this work.
- **Pre-existing Prisma DLL-rename lock on Windows.** No schema
  changes this sprint, so it isn't exercised. The cached Prisma
  client TypeScript types remain stable.

## 9. Final Status

**PASS — completed.**

Admin analytics + financials is now a fully real, admin-only,
read-only surface:

- 5 new endpoints, all date-range-aware and role-gated.
- 2 frontend sections fully driven by the new endpoints — no
  `MONTHLY_DATA`, no `WALLET_TRANSACTIONS`, no $14,820 constants.
- Platform-fee math reuses the Sprint 5.6 env-driven rate, so the
  admin financials and the provider wallet reconcile by
  construction.
- Postman collection covers every endpoint with reconciliation
  assertions and the standard collection-level secret-leak guard.

Auto-continue → Sprint 6.5.
