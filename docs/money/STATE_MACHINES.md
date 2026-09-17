# Authoritative state machines

## PaymentIntent
CREATED → AWAITING_PAYMENT | CANCELLED | EXPIRED
AWAITING_PAYMENT → PROCESSING | CANCELLED | EXPIRED
PROCESSING → SUCCEEDED | FAILED
FAILED is terminal for that attempt; a retry creates/reuses an explicitly idempotent command according to rail policy. SUCCEEDED is terminal and may be observed repeatedly without repeating side effects.

## Subscription
PENDING_PAYMENT → ACTIVE | CANCELLED
ACTIVE → EXPIRED | SUSPENDED | CANCELLED
SUSPENDED → ACTIVE | CANCELLED | EXPIRED according to policy.
Expired/cancelled historical periods are never deleted to simulate a new subscription.

## PlanVersion
DRAFT → PUBLISHED → RETIRED. Published commercial fields and entitlements are immutable. Price/benefit changes create a new version.

## Ledger
DRAFT → POSTED. A posted transaction and its entries are immutable. Correction posts a separate balanced transaction whose `reversesTransactionId` references the original; the original record remains unchanged.

Every transition is server-owned, checked against current persisted state and audited. Unknown/out-of-order transitions fail closed.