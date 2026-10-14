# R19 — Contract catalog (hsm.money.v1)

Producer: `packages/contracts/src/money/` (`wire.ts`, `financial-contracts.ts`,
re-exported from `money/index.ts`). Consumer fixtures:
`contract-fixtures/hsm.money.v1/*.json`. These are synthetic and
NON_PRODUCTION, and use the ISO 4217 test currencies XTS and XXX. They are
validated by `apps/api/test/unit/r19-money-contract-fixtures.spec.ts`.

## Wire rules (frozen)

- **Amounts** are canonical decimal strings: digits only, no sign, no leading
  zero, no fraction or exponent, at most PostgreSQL BIGINT. Internally they
  are `bigint`. Values above 2^53 round-trip exactly.
- **Currency** is three uppercase letters. Only the shape is checked;
  supported codes and their minor-unit scales are undecided (R16 P8, R18 D-2),
  so no code divides by 100.
- **Idempotency payloads** use `canonicalJson`: sorted keys, and bigint tagged
  as `{"$bigint": "…"}`. It refuses `undefined`, non-finite numbers,
  non-plain objects and cycles. A digest is the SHA-256 of that string,
  covering the actor or operation.

## DTOs and ports

| Contract                                      | Producer (wave)                               | Consumers                                                |
| --------------------------------------------- | --------------------------------------------- | -------------------------------------------------------- |
| `QuoteWireV1`                                 | existing `MoneyQuoteService` (pure); R24 port | payment lanes, financial UI                              |
| `PaymentIntentWireV1`, `PaymentAttemptWireV1` | R24 lifecycle                                 | rail adapters (Wave 3), UI                               |
| `PaymentConfirmationCommandV1`                | rail adapters (webhook, manual review)        | `SubscriptionActivationService.confirmAndActivate` (R19) |
| `ReceiptReviewDecisionV1`                     | manual-review lane                            | the same activation unit (`MANUAL_REVIEW`)               |
| `SubscriptionActivationResultV1`              | R19 activation unit                           | subscription engine, UI                                  |
| `RefundReservationCommandV1`, `RefundWireV1`  | refund orchestration (Wave 3)                 | finance UI, reconciliation                               |
| `FinancialProjectionV1`                       | finance read models                           | finance UI; always per currency                          |
| `ReconciliationExceptionWireV1`               | reconciliation (R34)                          | operators                                                |
| `SubscriptionPeriodWireV1`                    | R19 schema                                    | entitlement checks, UI                                   |

The internal port for activation is
`SubscriptionActivationService.confirmAndActivate(command, callerTx?)`
(`apps/api/src/modules/money/domain/`). It runs in a caller-owned
transaction, or its own. A missing adapter or configuration produces no
confirmation: the unit only persists a confirmation that a verified adapter
hands it.

## Approvals the contracts do not make

| Needed for live use                                                | Decision ID                      | State                                                   |
| ------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------- |
| Supported currencies and minor-unit scale                          | R16 P8, R18 D-2                  | BLOCKED                                                 |
| Ledger account purposes for subscription revenue and rail clearing | R16 P7                           | BLOCKED; the caller must name both accounts             |
| Launch plan versions and prices                                    | **R19-P1** (new; no existing ID) | POLICY_BLOCKED; no plan row exists                      |
| Refund and entitlement-on-refund policy                            | **R19-P2** (new)                 | POLICY_BLOCKED; reservations capped, nothing dispatches |
| Zero-total (free or 100 % coupon) activation                       | **R19-P3** (new)                 | POLICY_BLOCKED; refused with 400                        |
| Live rails                                                         | `docs/money/LIVE_MONEY_GATE.md`  | disabled; no adapter, credential or route               |
