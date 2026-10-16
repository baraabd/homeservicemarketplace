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
  as `{"$bigint": "…"}`. The `$bigint` key is reserved: caller-supplied
  objects cannot impersonate the bigint encoding. Arrays must be dense and
  carry no extra properties. Symbol keys, non-enumerable properties and
  accessors are refused, without invoking getters. It also refuses
  `undefined`, functions, symbols, non-finite numbers, non-plain objects and
  cycles. Finite numbers retain standard JSON semantics (including `-0` as
  `0`); financial amounts use bigint internally and decimal strings on the
  wire. A digest is the SHA-256 of that string, covering the actor or operation.

CR-004 hardens invalid-input handling without changing `hsm.money.v1` or the
encoding of valid existing confirmation commands. It never rewrites stored
digests. Previously accepted ambiguous objects now fail with `NOT_CANONICAL`;
any adapter that persisted such a payload requires an explicit reconciliation
decision, not a silent history repair.

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

**G1 callable freeze candidate:**
`apps/api/src/modules/money/domain/money-ports.v1.ts` defines the server-side
ports below. `test/support/money-ports-consumer.fixture.ts` compiles a consumer
for each later-lane operation under API typecheck. This proves signatures,
not implementations or live-provider execution. Review of this catalog and
these types is part of G1 owner acceptance.

| Port                           | Callable methods                                                | Transaction rule                                                           |
| ------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `QuoteCreationPortV1`          | `quote`                                                         | optional caller transaction                                                |
| `PaymentLifecyclePortV1`       | `createIntent`, `startAttempt`, `recordAttempt`, `cancelIntent` | optional caller transaction; confirmation uses the activation unit         |
| `ReceiptReviewPortV1`          | `review`                                                        | fresh reviewer authority; optional caller transaction                      |
| `SubscriptionActivationPortV1` | `confirmAndActivate`                                            | existing atomic R19 implementation; caller result provisional until commit |
| `RefundPortV1`                 | `reserve`, `dispatch`, `recordResult`                           | reserve/result transactional; dispatch outside transaction locks           |
| `FinancialProjectionPortV1`    | `read`                                                          | explicit currency and as-of; never sum unlike currencies                   |
| `ReconciliationPortV1`         | `record`, `list`                                                | record transactional; bounded cursor list                                  |

Writes carry the `hsm.money.v1` contract version, idempotency key and explicit
actor (the existing activation command retains its already frozen signature).
The implementation must authorize fresh capabilities and ownership, replay an
equal key/payload, and reject a changed payload. Internal amounts remain bigint;
wire values remain decimal strings. No lifecycle/refund/rail implementation or
HTTP endpoint is fabricated to satisfy this interface handoff.

G1 strengthens `money_refund_guard`: success requires posted compensation of
exactly the reserved amount and currency, reversing only the original accounts
and directions. A full reversal must reference that confirmation's original
posting. A standard compensation carries `money.refund:<refundId>`. The existing
unique compensation link, reservation cap, state machine and R15 immutability
remain enforced in PostgreSQL, including direct SQL callers. The migration
validates existing succeeded/linked refunds and refuses an inconsistent history.

CR-002 is resolved by the existing R17 inbox boundary: a registered
`SubscriptionActivatedHandler` validates persisted identifiers and writes one
provider notification plus its announcement in the delivery transaction. A
unique notification domain key also prevents duplicate notices if a handler
marker is removed and replayed. Read/deleted state is preserved. The handler
creates no R31 entitlement engine, verification result, work-access grant,
payout or provider withdrawable balance. Its link targets the existing provider
profile route; it introduces no subscription-management page.

## Approvals the contracts do not make

| Needed for live use                                                | Decision ID                      | State                                                   |
| ------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------- |
| Supported currencies and minor-unit scale                          | R16 P8, R18 D-2                  | BLOCKED                                                 |
| Ledger account purposes for subscription revenue and rail clearing | R16 P7                           | BLOCKED; the caller must name both accounts             |
| Launch plan versions and prices                                    | **R19-P1** (new; no existing ID) | POLICY_BLOCKED; no plan row exists                      |
| Refund and entitlement-on-refund policy                            | **R19-P2** (new)                 | POLICY_BLOCKED; reservations capped, nothing dispatches |
| Zero-total (free or 100 % coupon) activation                       | **R19-P3** (new)                 | POLICY_BLOCKED; refused with 400                        |
| Live rails                                                         | `docs/money/LIVE_MONEY_GATE.md`  | disabled; no adapter, credential or route               |
