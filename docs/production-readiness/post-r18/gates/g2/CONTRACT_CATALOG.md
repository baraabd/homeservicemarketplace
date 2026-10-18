# G2 — Money interface catalog for Wave 3

## Authoritative source and versions

The callable adapter/application boundary is the R24 API in `apps/api/src/modules/money/ports/`, composed once by MoneyModule and the existing LedgerModule. Public money wire contracts remain `hsm.money.v1`, exported by `packages/contracts/src/money/index.ts`; branded decimal-string minor units are constructed with `toMoneyWire`. No floating-point amount, new ledger, refund authority or public contract version is introduced.

The older generic R19 `domain/money-ports.v1.ts` describes a prior boundary. It is not structurally interchangeable with the actual R24 collection, receipt, refund and activation ports. Consumers must use the listed current tokens/signatures. `apps/api/test/support/g2-money-ports-consumer.fixture.ts` compiles against those concrete ports, including a synthetic amount above JavaScript's safe integer range and negative transaction-argument checks.

| Token / interface                                                                  | Owner and caller rule                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONEY_CONFIGURATION` / `MoneyConfigurationPort`                                   | Resolve the captured plan/method binding, mode, account reference, currency, ledger accounts and configuration version. Default absence blocks operations. No fixture selects an approved market, price or live account.                                                |
| `MONEY_COLLECTION_ADAPTER` / `MoneyCollectionAdapterPort`                          | R29/R30 transport outside database transactions; stable outbound key and operation identity; verified normalized external events preserve account/mode/amount/currency correlation.                                                                                     |
| `MONEY_RECEIPT_ACCEPTANCE` / `MoneyReceiptAcceptancePort`                          | R30/manual receipt authority enlists in the caller's PrismaTx. Restricted evidence, method, owner and reviewer must be revalidated; a filename or upload alone is no payment proof.                                                                                     |
| `MONEY_ACTIVATION_PARTICIPANT` / `MoneyActivationParticipantPort`                  | R31 applies approved subscription entitlement consequences inside the same caller transaction as authoritative local confirmation. Failure rolls back; no verification/work-access grant is inferred.                                                                   |
| `MONEY_REFUND_POLICY` / `MoneyRefundPolicyPort`                                    | R32 re-reads approved eligibility, actors and obligation through required PrismaTx. Existing `authorizeReservation` remains unchanged. Missing policy fails closed.                                                                                                     |
| `MONEY_REFUND_ADAPTER` / `MoneyRefundAdapterPort`                                  | R29/R30 `submit` and `query` are transaction-free. Stored key/reference and captured binding survive retries. PENDING/UNKNOWN retain reservations.                                                                                                                      |
| `MONEY_REFUND_CONFIRMATION_PARTICIPANT` / `MoneyRefundConfirmationParticipantPort` | Additive G2 signature for R32's approved consequence. Input identifies refund/request/original confirmation/policy/partial amount/linked compensation. `applyConfirmedRefund(input, tx)` must enlist and deduplicate in the caller transaction. Default is unavailable. |
| `MONEY_FINANCE_READ` / `MoneyFinanceReadPort`                                      | Existing authorized projection and exception reads; estimates are not cash or a new accounting authority.                                                                                                                                                               |

## Reservation and accounting invariants

The authoritative original is a posted payment confirmation with captured payer/provider obligation, currency and amount. The existing repository locks the original confirmation before its refund request and totals RESERVED, DISPATCHED and SUCCEEDED amounts. Concurrent partial reservations cannot exceed remaining confirmed capacity. A refund request does not show returned money.

`MoneyDispatch` durably binds the refund and outbound idempotency key. R24 derives refund dispatch keys in its `r24_refund_` namespace and linked compensation keys in its `r24_compensate_` namespace. R32 must reuse persisted identities, never derive a replacement operation after a timeout. Verified observations are correlated to refund, confirmation, adapter, mode, account, currency, amount and external operation.

Only authoritative SUCCEEDED evidence permits local linked compensation. Terminal proof is persisted before the accounting transaction so a local failure remains recoverable. Late nonterminal observations cannot erase a definitive result. The G1 refund-binding migration enforces the posted original, exact amount/currency and opposite accounts. Partial compensation is a separately linked STANDARD posting; a REVERSAL remains a full-original reversal. R15 posted history is immutable.

`PENDING` and `UNKNOWN` mean financial capacity remains reserved. A timeout, lease expiry, missing lookup or inconclusive provider response is not a definitive failure or absence proof. The adapter must normalize it to UNKNOWN unless it has authoritative evidence for a bound operation. No network call may occur under a PrismaTx or lock.

## Explicit R32 work after approval

1. The new confirmed-refund participant is a frozen callable interface and composition default. MoneyCommandService does not invoke it in this G2 change. R32 must wire authoritative compensation and the approved consequence into one transaction; missing configuration and consequence/audit failure must roll back local success.
2. Existing dispatch selection accepts a caller `queryOnly` choice. R32 must inspect durable prior uncertainty and enforce query-first recovery before another external action. A compile-time fixture does not prove this orchestration.
3. R32 must commit reservation/audit/outbox before external execution and deliver through the existing R22 durable consumer contract. Existing direct HTTP dispatch and an after-commit callback alone do not satisfy durable outbox delivery.
4. Reservation expiry/cancellation must inspect dispatch history. RESERVED can already have an external PENDING/UNKNOWN operation. No TTL, fee, refund window or capacity release is invented.
5. R29/R30-backed sandbox refund acceptance runs on the assembled Wave 3 candidate. A synthetic adapter or linked ledger entry alone is never described as a returned payment.

## Policy and publication holds

R19-P2 and the existing R16/R18 policy holds remain. Refund windows, pro-rata calculation, fees/tax, supported markets/currencies, plan pricing, actor-separation choices and paid-entitlement effects require explicit policy. The current delegation authorizes engineering coordination, not invented commercial rules, live rails, payouts, escrow or verification grants. Unconfigured money ports remain unavailable.

A source can be proposed for freeze only after the exact candidate tests. The manifest currently controls whether that has happened. Owner review/publication precedes R32 work; an interface document or green PR alone cannot release the lane.
