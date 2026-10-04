# R14 — Implementation

Status: **IMPLEMENTED (Option B); acceptance pending exact-head CI and prerequisites**

Base: `develop@a2b31c3090000d2ef8a5e96dd21e80023ee160a7`. Policy:
[`BUDGET_POLICY.md`](BUDGET_POLICY.md). Matrix:
[`BUDGET_AUTHORITY_MATRIX.md`](BUDGET_AUTHORITY_MATRIX.md).

## Changes

- API: removed `toBudget()` and the `budget` property from the provider
  available-request summary/detail mapper.
- Contracts: removed `ProviderAvailableRequestBudget` and
  `ProviderAvailableRequestSummary.budget` (type-only; no runtime import).
- Web: removed the budget chip, detail tile, offer-form note and map-popup value;
  removed the legacy `ServiceRequest.budget` field and invented seed budgets; the
  adapter no longer reads a budget.
- No schema change, no migration, no feature flag.

## Compatibility

Only `apps/api` (producer) and `apps/web` (consumer) used the field; the redacted
preview contract never had it. The field was always null, so no client could depend on
a value. A web bundle older than this change reads `job.budget.label` and would fail on
a feed without `budget`; web and API must therefore ship together. There is no
production deployment yet, so no such bundle exists in production.

## Tests

- API unit: `available-requests.service.spec.ts` asserts list and detail carry no
  `budget` and no `amountMin`/`amountMax`.
- Web unit: `ProviderApp.test.tsx` asserts the detail overlay and the offer form show
  no "Budget"/"الميزانية"/"ميزانية".
- Real browser + API + PostgreSQL (`apps/web/e2e/r14-budget-authority.real-api.spec.ts`,
  CI Phase 5 real-API job): three budget-carrying create payloads are refused with 400
  and store nothing; a budget-free create succeeds; in English and Arabic at 390 px the
  provider's feed wire, reloaded feed, job card, detail overlay and offer form contain no
  budget, and the page has no horizontal overflow.

## Known limitations

- The offer form still labels the price "Your Price ($/hr)" / "سعرك ($/ساعة)" while
  bids are stored as an amount plus a currency defaulting to USD. That is quote/money
  semantics, outside R14's budget scope, and belongs with the money work.
- The map popup change is covered by source review only; Leaflet popups are not opened
  by the browser spec.

## Rollback

Revert the merge. No data or schema is involved.
