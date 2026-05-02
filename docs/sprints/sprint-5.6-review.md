# Sprint 5.6 Review Report — Provider Earnings / Wallet Read Model

## 1. Planning Summary

- **Scope:** Read-only earnings surface — summary aggregates +
  cursor-paginated transactions list — wired to the existing
  `WalletScreen`. No payouts, no withdrawals, no balance reconciliation.
  Retire the `WALLET_TRANSACTIONS` and `EARNINGS_CHART_DATA` mocks plus
  the `setTimeout` "withdraw" placeholder that violated the global
  rule against fake persistence.
- **Existing files inspected:**
  - `apps/api/src/modules/bookings/bookings.service.ts` (seeker-side
    booking shape — earnings reads aggregate the same Booking table)
  - `apps/api/src/infrastructure/persistence/bookings/booking.repository.ts`
  - `apps/web/src/app/components/provider/ProviderApp.tsx` (WalletScreen)
  - `apps/web/src/app/context/EcosystemContext.tsx` (mocks being retired)
  - `packages/contracts/src/seeker/bookings/enums/booking-status.ts`
- **Dependencies found:** Sprint 5.4 added `BookingRepository.listForProvider`
  which the transactions endpoint reuses. Sprint 5.1.2's
  `ProviderActiveGuard` already gates the read surface.
- **Risks found:**
  - Mixed-currency providers: when a provider has bookings in different
    currencies, the SUM aggregates collapse to one number while the
    summary surfaces only one currency code. Mitigation: returned
    currency is the _dominant_ one (groupBy + ORDER BY count DESC LIMIT 1)
    and is documented on the contract field comment.
  - The chart was driven by a hardcoded `EARNINGS_CHART_DATA` mock — a
    proper per-day timeseries endpoint isn't shipping in this sprint.
    Mitigation: a pure client-side `buildWeeklyEarnings` reducer
    bucketises the real transactions list into 7 daily totals. No
    server change needed.
  - The Wallet UI's "Withdraw Earnings" button used `setTimeout` for
    fake persistence. Replaced with a permanently disabled
    "Bank withdrawals — coming soon" affordance until the payouts
    module ships.

## 2. Implementation Summary

- **Files added:**
  - `packages/contracts/src/provider/wallet/{request,response,index}.ts`:
    `ListEarningsTransactionsQuery`, `ProviderEarningsSummary`,
    `ProviderEarningsTransaction`, `ListEarningsTransactionsResponse`.
  - `apps/api/src/modules/provider/wallet/dto/list-earnings-transactions.query.ts`
  - `apps/api/src/modules/provider/wallet/provider-wallet.controller.ts`
  - `apps/api/src/modules/provider/wallet/provider-wallet.service.ts`
  - `apps/api/src/modules/provider/wallet/provider-wallet.service.spec.ts`
  - `apps/web/src/lib/provider/provider-wallet-api.ts`
  - `apps/web/src/app/hooks/provider/useProviderEarnings.ts`
- **Files changed:**
  - `apps/api/src/infrastructure/persistence/bookings/booking.repository.ts`
    — added `aggregateEarningsForProvider` (single round-trip; four
    parallel groupBy / aggregate queries — totalGross + currentMonth +
    pending + dominantCurrency).
  - `apps/api/src/modules/provider/provider.module.ts` — register the
    wallet controller + service.
  - `packages/contracts/src/provider/index.ts` — re-export wallet.
  - `apps/web/src/lib/provider/query-keys.ts` — add
    `wallet.{root,summary,transactions}`.
  - `apps/web/src/app/components/provider/ProviderApp.tsx`:
    - Drop the `WALLET_TRANSACTIONS` / `EARNINGS_CHART_DATA` imports
      from `EcosystemContext`.
    - `WalletScreen` consumes `useProviderEarningsSummary()` (60 s
      poll) + `useProviderEarningsTransactions()` (60 s poll).
    - Remove the `setTimeout` fake-withdraw and replace the button
      with a disabled "coming soon" affordance.
    - Header amounts (`balance`, `pending`, `thisMonth`,
      `completedJobsCount`) bind to the summary; `Intl.NumberFormat`
      formats in the dominant currency.
    - Chart binds to `buildWeeklyEarnings(transactions)` — a pure,
      deterministic 7-day bucketiser of the real COMPLETED list.
    - Transaction list maps the real `ProviderEarningsTransaction[]`
      rows. Empty / loading / error states render safe copy.
  - `postman/hsm-provider.postman_collection.json` — added folder
    `50 — Earnings (Sprint 5.6 — read-only wallet)` with summary,
    default-completed-only list, status-filter list, and cross-role
    403 negative.
- **Migrations added:** none.
- **Contracts added/changed:** `provider/wallet` subdomain published.
- **UI added/changed:** `WalletScreen` swapped to real data; visual
  layout unchanged.
- **API endpoints added/changed:**
  - `GET /v1/me/provider/earnings` — summary aggregates.
  - `GET /v1/me/provider/earnings/transactions?status&limit&cursor` —
    cursor-paginated transactions; default filter is COMPLETED.

## 3. Automated Tests

| Check                                                                                  | Result                                |
| -------------------------------------------------------------------------------------- | ------------------------------------- |
| `prisma validate`                                                                      | pass                                  |
| `pnpm --filter @homeservicemarketplace/contracts build`                                | pass                                  |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                  | pass                                  |
| `pnpm --filter @homeservicemarketplace/web typecheck`                                  | pass                                  |
| `pnpm --filter @homeservicemarketplace/api test`                                       | pass — 617 passed (+8 new), 6 skipped |
| `pnpm --filter @homeservicemarketplace/web test`                                       | pass — 295 passed                     |
| `VITE_API_URL=https://api.example.com pnpm --filter @homeservicemarketplace/web build` | pass                                  |

New API tests in `provider-wallet.service.spec.ts` (8 cases):

- summary: returns the four aggregate amounts plus rating + currency
- summary: falls back to USD when no completed bookings exist
- summary: returns 404 if profile vanished
- summary: queries the aggregate with a UTC start-of-month timestamp
- transactions: COMPLETED-only by default + projects to the wire shape (no `line1` leak)
- transactions: honours the explicit `status` filter
- transactions: emits nextCursor when the page overflows
- transactions: returns 404 if the provider profile is missing

## 4. Postman Tests

- Collection updated: `postman/hsm-provider.postman_collection.json`.
- Folder `50 — Earnings (Sprint 5.6)` (4 requests):
  - GET summary — asserts shape + non-negative aggregates
  - GET transactions (default) — asserts COMPLETED-only + no line1 / passwordHash
  - GET transactions?status=IN_PROGRESS — asserts every row is IN_PROGRESS
  - GET summary with customer token — must 401/403/404
- Newman run: deferred to Sprint 5.7 end-to-end harness.

## 5. Manual Checks

- Scenario: WalletScreen no longer references the legacy mocks.
  Expected: grepping the file for `WALLET_TRANSACTIONS` /
  `EARNINGS_CHART_DATA` yields zero matches.
  Actual: confirmed (only the import-comment mentions them by name).
  Result: pass.
- Scenario: the withdraw button is no longer a fake-persistence
  affordance.
  Expected: button is `disabled`; no `setTimeout` references in
  WalletScreen.
  Actual: button is permanently disabled with localised "coming soon"
  copy; the only `setTimeout` left in the file is the BiddingModal's
  cosmetic 1.6 s success-cue auto-dismiss (Sprint 5.3).
  Result: pass.
- Scenario: chart no longer renders fake earnings.
  Expected: `EARNINGS_CHART_DATA` is no longer imported; the chart
  binds to `buildWeeklyEarnings(transactions)`.
  Actual: confirmed.
  Result: pass.

## 6. Fixes Applied

- File: `apps/web/src/app/components/provider/ProviderApp.tsx`
  Reason: WalletScreen was rendering hardcoded balance values and
  using `setTimeout` to simulate a withdraw — both violations of
  CLAUDE.md ("Do not introduce fake production data" / "Do not use
  setTimeout as fake persistence").
  Before: hardcoded `$1,240.00`, `$45.00`, `$310.00`, `$1,240`; chart
  fed by `EARNINGS_CHART_DATA` mock; `setTimeout(handleWithdraw, 1500)`.
  After: amounts come from `useProviderEarningsSummary()`; chart
  derived from the real transactions list; the withdraw button is a
  disabled "coming soon" affordance.
  Risk: low — the visual layout is unchanged; the disabled state is
  honest about the missing payouts feature.

## 7. Remaining Issues

- A proper per-day earnings timeseries (e.g. last 30 days)
  endpoint would be a better fit for the chart than client-side
  bucketising of the most recent transactions page. Defer to a future
  analytics sprint.
- Mixed-currency providers see the dominant currency only — the
  contract documents this explicitly. A multi-currency split / FX
  conversion is out of scope.
- The flaky `app-selector-routing.test.tsx` test from Sprint 5.2
  remains flaky.

No blocking issues.

## 8. Sprint Decision

**PASS** — Continue automatically. All Sprint 5.6 surface area is
green (api typecheck +8 tests, contracts build, web typecheck,
web tests, web build).
