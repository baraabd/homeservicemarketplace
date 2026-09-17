# ADR 0014 — Money, subscriptions, entitlements and immutable ledger

Status: Accepted for Sprint 13 foundation
Date: 2026-09-18

## Context
HSM needs provider subscriptions paid by Stripe, Sham Cash, Syriatel Cash, or approved cash offices. Manual methods require evidence review; Stripe is webhook-authoritative. Money must not go live until Sprints 1–12 gates are green, no High/Critical security finding is open, and this ADR is accepted.

## Decisions
1. Money is represented as integer minor units plus ISO-4217 currency. Floating point is forbidden.
2. Prices are server-authoritative. Clients submit plan/version, billing interval, coupon and payment method; the server calculates subtotal, discount and total.
3. Plans are mutable containers; published PlanVersion records are immutable commercial snapshots. Existing subscriptions remain bound to the purchased version.
4. Entitlements are data, not plan-name conditionals. Limits use atomic server-side usage counters.
5. PaymentIntent is the common orchestration boundary for STRIPE, SHAM_CASH, SYRIATEL_CASH and CASH_OFFICE.
6. Payment confirmation never comes from a browser success page. Stripe is confirmed by verified/idempotent server webhook. Manual rails are confirmed by an authorized admin review transaction.
7. Ledger transactions are double-entry and append-only. Posted entries are never updated/deleted; corrections use reversing transactions.
8. Every financial command requires an idempotency key. Unique constraints make replay harmless.
9. Subscription activation and ledger posting happen atomically in one database transaction after authoritative payment confirmation.
10. Financial audit records contain identifiers/reasons, never secrets or unrestricted evidence bytes.
11. Manual receipt evidence reuses the restricted MediaAsset pipeline: private storage, detected type, server hash, malware state and audited authorization. A review derivative may be watermarked; the original is never modified. Image analysis is a risk signal, never proof of authenticity.
12. Coupons are validated and redeemed server-side with concurrency-safe redemption limits.

## Core states
PaymentIntent: CREATED → AWAITING_PAYMENT → PROCESSING → SUCCEEDED | FAILED | CANCELLED | EXPIRED.
Subscription: PENDING_PAYMENT → ACTIVE → EXPIRED | SUSPENDED | CANCELLED.
LedgerTransaction: DRAFT → POSTED | REVERSED. A POSTED transaction is immutable.

## Invariants
- amountMinor >= 0; currency is normalized uppercase ISO code.
- sum(debit entries) == sum(credit entries) for every posted transaction and currency.
- a PaymentIntent can activate at most one subscription period.
- one provider cannot consume the same coupon redemption or usage event twice through replay.
- no entitlement is granted from UI state alone.

## Rollout
Sprint 13 is dark infrastructure only: schemas, contracts, services and tests. Live payment credentials and live-money behavior remain disabled. Sprint 14 adds sandbox adapters/evidence review/webhooks. Sprint 15 adds renewal, reconciliation and operational UX.

## Verification
Required gates: schema validation/drift, unit/integration/property tests for money precision, plan versioning, entitlement limits, coupon races, state transitions, idempotency, balanced ledger and reversal; existing CI/CodeQL/security gates must remain green.