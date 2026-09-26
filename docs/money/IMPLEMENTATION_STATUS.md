# Money implementation status — source-authoritative correction

Audited base: `66e336cb4823802aabacc536584972aa43056d23`. The earlier version of this file described additive SQL persistence as implemented on a historical Sprint 13 branch. That claim is not supported by the current baseline: the Prisma schema and its 60 migration scripts contain no financial ledger/account/payment-intent authority. Do not treat an old branch report as deployed or merged functionality.

## Implemented in this source lineage

Accepted ADR 0014; shared type contracts; pure quote, ledger-balance, entitlement, coupon and state-transition functions; a catalog-port-based MoneyQuoteService; domain/application/policy unit tests; live-money gate, threat model and acceptance specifications. S10 additionally hardens actual runtime amount, currency, ledger-side/account, billing-interval, coupon-kind/value and state-transition boundaries. TypeScript annotations alone do not validate values arriving from runtime adapters.

## NOT implemented / not certified

Authoritative financial Prisma models/migrations; append-only posted-row database constraints; repositories and transactional activation/posting/idempotency receipts; payment-intent/plan/subscription/entitlement persistence; HTTP controllers and authorization wiring; immutable financial audit/outbox integration; reversal/concurrency/rollback integration against real PostgreSQL; migration rehearsal; captured-payment/settlement/payout reconciliation; complete financial UI and release certification.

Provider earnings and Admin financials currently compute marketplace booking summaries. They are not proof of actual captured, settled or paid-out money. Pure balanced-entry tests are not proof of a durable, immutable ledger.

S10 remains PARTIALLY IMPLEMENTED. No financial schema is created by this initial runtime-hardening commit, and no in-memory substitute is presented as persistence. LIVE MONEY remains OFF under LIVE_MONEY_GATE.md; no Stripe credentials, checkout, webhook or real movement is enabled.
