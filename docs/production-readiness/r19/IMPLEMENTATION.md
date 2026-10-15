# R19 — Implementation

Status: **IMPLEMENTED, SOURCE_VERIFIED locally, INTEGRATION_PENDING**
(Wave 1 gate G1). No live money movement is enabled.

## Owner-approved corrective continuation (2026-10-15)

PR #159 was already merged on 2026-10-14. The owner approved continuing the
reviewed eight-file CR-004 correction and opening one corrective R19 PR on
`feat/r19-money-authority-contracts`. Exact ownership and authorization are
recorded in `shared-change-requests/CR-004-canonical-json-corrective-follow-up.md`.

- Original wave base: `059c018576a75837d4dfb262ee49168d9217d881`.
- Corrective parent / branch-start merge base:
  `fcdf1deb1a34044b9253ebac8e0e308a69e7a667`.
- Parent tree: `809ffede1b03d3e53241aea2e3a6d01134c6fde0`.
- Inspected develop: `af662586a640e41d8438d0cb2dd69e8cbb0e172a`.
- Final corrective commit and tree are bound in the corrective PR metadata,
  as required by the PR template; a commit cannot contain its own hash.

The previous `canonicalJson` allowed a caller object to impersonate its
bigint tag, skipped sparse-array elements and hidden/symbol/extra properties,
and executed accessors. The existing helper now rejects those shapes before
hashing. It keeps valid financial payloads byte-compatible, preserves precise
bigint serialization and sorted keys, and never rewrites stored digests.

Changed runtime path: `packages/contracts/src/money/wire.ts` only.
New regression suite:
`apps/api/test/unit/r19-canonical-json-regression.spec.ts`, importing the
published workspace contracts. The other six changed files are this sprint's
approved evidence/catalog/CR-004 paths. No schema, migration, root barrel,
AppModule, manifest, lockfile, permission, account purpose or live-rail change.

This is a corrective implementation, not acceptance of G1. The original
ledger and transaction boundary below remain unchanged. CR-002, the remaining
internal-port freeze and policy decisions remain coordinator/domain-owner
handoffs; only the canonical-encoding defect is closed by this continuation.

## Original implementation record

- Frozen base: `059c018576a75837d4dfb262ee49168d9217d881` (Wave 1, `post-r18/waves/wave-01.ready.json`).
- Branch: `feat/r19-money-authority-contracts`. The final SHA and tree are recorded on the PR.

## Inventory before editing

- **R15 ledger.** `LedgerAccount`, `LedgerTransaction` (kinds STANDARD and
  REVERSAL), `LedgerEntry`; migration `20261004150000_r15_ledger_foundation`,
  with 16 CHECKs and 5 trigger functions; `LedgerService` with a caller-owned
  `PrismaTx`.
- **Baseline before any edit.** Money specs and the R15 real-PostgreSQL suite:
  6 suites, 95 tests, all passing.
- **Pure domain code from the old money plan** (`money-domain.ts`,
  `money-policy.ts`, `money-application.ts`): quotes, coupons, the payment and
  subscription transition tables, and period arithmetic. No persistence and
  no caller.
- **Contracts** for plan versions, quotes, payment intents and subscriptions:
  types only.
- Nothing else existed: no plan, payment, subscription, coupon, refund or
  reconciliation table.

R15 stays the accounting authority. No second ledger, no rename of an applied
migration, no backfill.

## What R19 adds

| Layer                    | Files                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts                | `packages/contracts/src/money/wire.ts`, `financial-contracts.ts` (version `hsm.money.v1`, see `CONTRACT_CATALOG.md`)                                                                                                                                                                                                                                                                           |
| Schema (exclusive lease) | `schema.prisma`: 9 enums and 11 tables (`SubscriptionPlanVersion`, `MoneyPaymentIntent`, `MoneyPaymentAttempt`, `MoneyPaymentConfirmation`, `ProviderSubscription`, `SubscriptionPeriod`, `MoneyRefund`, `MoneyCoupon`, `MoneyCouponRedemption`, `MoneyEntitlementUsage`, `MoneyReconciliationException`); back-relations only on `User`, `ProviderProfile`, `MediaAsset`, `LedgerTransaction` |
| Migration                | `20261014090000_r19_subscription_money_foundation`, expand-only: alters no table it did not create; inserts no row                                                                                                                                                                                                                                                                             |
| API                      | `modules/money/domain/subscription-activation.service.ts`, provided by the existing `LedgerModule` (no AppModule change, no controller, no caller)                                                                                                                                                                                                                                             |
| Tests                    | `test/unit/r19-money-wire.spec.ts`, `test/unit/r19-money-contract-fixtures.spec.ts`, `test/integration/r19-subscription-money.integration.spec.ts`; one R15 assertion re-scoped (CR-001)                                                                                                                                                                                                       |

## Database-enforced rules (proven with raw SQL in the R19 suite)

| Rule                                                                                                                   | Mechanism                                                                              |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Plan versions are immutable; only `retiredAt` may be set, once; never deleted                                          | `subscription_plan_version_guard`, `money_no_delete`                                   |
| Intent total = subtotal − discount; amounts ≥ 0; currency shape                                                        | CHECKs                                                                                 |
| Intent currency = its plan version's                                                                                   | composite FK `(planVersionId, currency)`                                               |
| Intent is priced once; status follows `money-policy.ts`; never deleted                                                 | `money_payment_intent_guard`                                                           |
| At most one successful attempt per intent                                                                              | partial unique index                                                                   |
| One confirmation per intent, and per `(source, externalConfirmationId)`                                                | unique keys                                                                            |
| A confirmation needs a SUCCEEDED intent, exactly its total, and one POSTED STANDARD ledger transaction in its currency | `money_payment_confirmation_insert_guard`, composite FKs, unique `ledgerTransactionId` |
| Manual confirmation names receipt and reviewer; webhook names neither                                                  | CHECK `source_evidence`                                                                |
| Confirmations, periods, redemptions and usage are append-only                                                          | `money_append_only`                                                                    |
| One period per confirmation; same provider and plan as the intent; no overlap                                          | unique; `subscription_period_insert_guard` (locks the subscription)                    |
| Refunds ≤ the confirmed amount (RESERVED, DISPATCHED, SUCCEEDED counted); legal transitions only; amount fixed         | `money_refund_guard` (locks the confirmation)                                          |
| A compensation is linked only to a SUCCEEDED refund and is POSTED in its currency                                      | CHECK and trigger                                                                      |
| Coupon total and per-provider limits; redemption matches its intent                                                    | `money_coupon_redemption_guard` (locks the coupon)                                     |
| A usage key is counted once                                                                                            | unique `(subscriptionId, entitlementKey, usageKey)`                                    |

## Transaction boundary

`confirmAndActivate` runs in one database transaction, in this order:

1. Lock the intent `FOR UPDATE`.
2. Replay or refuse by idempotency key and digest.
3. Set the intent to SUCCEEDED.
4. Post exactly one ledger transaction, keyed from the confirmation key.
5. Insert the confirmation.
6. Create or renew the subscription.
7. Insert exactly one period.
8. Redeem the coupon.
9. Enqueue one identifier-only outbox event, deduplicated per confirmation.

Every step commits together with the caller, or not at all. No network call
is made inside it. A rail adapter verifies its webhook or a receipt review
before calling it, outside any lock.

## Full reversal versus partial compensation

R15's `REVERSAL` remains an exact mirror of the whole original, at most once,
and the database still enforces that. A partial subscription refund is a
**separate STANDARD posting**, linked through
`MoneyRefund.compensatingLedgerTransactionId`. The suite proves three things:

- a partial `REVERSAL` is refused by the mirror rule;
- the full reversal of a confirmed payment still works;
- the original posting is unchanged byte for byte.

## Deliberately not done

- No rail adapter, webhook route, receipt-review UI, refund dispatch, renewal
  job or entitlement enforcement. Those belong to later waves.
- No plan, price, currency, coupon, account purpose or permission row.
- No live caller; nothing reads these tables in the product.
- Customer funds, escrow, payouts and withdrawals: R16, policy-blocked.
