# R14 — Budget policy

Status: **OPTION B — budget concept removed (authorized non-fabrication fallback)**

## Decision source

The roadmap (`FUNCTIONAL_COMPLETION_ROADMAP.md`, R14) lists two options and requires a
product decision:

1. add an optional seeker min/max/currency budget intent; or
2. remove/hide the budget concept until the product is ready.

A repository search found **no approved decision** for either option:

- The roadmap and gap matrix describe both as options only.
- ADR 0011 proposes a `budgetBand` for the redacted preview and records budget bands as
  an outstanding product/legal decision; the shipped preview omits budget entirely.
- `PRODUCTION_GAP_MATRIX.md`, `FEATURE_INVENTORY.json`, `RELEASE_BLOCKERS.md`,
  `ROUTE_API_MATRIX.md`, `money/` and `seeker-request/` do not define a request budget.
- `ServiceRequest` has no budget column, the seeker wizard has no budget input, and no
  supported-currency or market list exists to validate a currency against.

The R14 execution brief (2026-10-04) authorizes Option B as the safe fallback when no
approved choice exists. This document records that fallback; it is not a product
decision to never offer budgets.

## Rules

- The seeker states no budget, so no budget exists on any request.
- No budget is derived from bids, categories, history, averages, AI or booking totals.
- The provider projection (`/v1/provider/available-requests` list and detail) carries
  no `budget` field. The previous always-null `{amountMin, amountMax, currency, label}`
  object was removed from the API and the shared contract.
- The provider web surfaces show no budget label, chip, tile, note or popup value.
- Request create and update reject any budget-like property (`forbidNonWhitelisted`);
  nothing is stored.

## Request lifecycle

Unchanged. A request is editable only while `OPEN_FOR_BIDS`; cancel is allowed from
`OPEN_FOR_BIDS`; reopen goes `CANCELLED → OPEN_FOR_BIDS`; `BID_ACCEPTED`, `BOOKED`,
`IN_PROGRESS` and `COMPLETED` are not seeker-editable. Since no budget exists, there is
no budget mutation rule. Historical requests are unaffected: they never had a budget.

## Re-enabling budgets later (Option A)

Requires an approved product decision covering: optional min/max/currency in integer
minor units; a currency allowlist tied to supported markets (none exists today);
min ≤ max; currency required with an amount; immutability once the first bid exists or
at `BID_ACCEPTED`; provider-only projection; locale rendering. That would be an additive
migration (nullable columns, existing rows `NULL`) and a new contract field.
