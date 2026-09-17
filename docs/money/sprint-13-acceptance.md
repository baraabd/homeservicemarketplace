# Sprint 13 — acceptance matrix

## Scope
Dark-launch money foundation only. No live credentials and no live-money behavior.

## Required capabilities
- [x] Money ADR: integer minor units, server authority, idempotency, immutable double-entry policy.
- [x] Shared contracts for billing intervals, payment methods, payment intents, subscriptions, entitlements and ledger entries.
- [x] Pure domain invariants for currency, quote arithmetic, ledger balancing, entitlement decisions and calendar periods.
- [x] Unit tests for precision, invalid amounts, currency validation, balanced/unbalanced/mixed-currency ledger, finite/unlimited/expired entitlement decisions and month/year boundaries.
- [ ] Additive persistence models and forward-only migration for Plan/PlanVersion/Entitlement/Subscription/Coupon/PaymentIntent/Ledger.
- [ ] Database-enforced append-only ledger and one-way published plan-version semantics.
- [ ] Repository/services with transactional idempotency and concurrency tests.
- [ ] Admin plan management API and provider read/quote API.
- [ ] Admin/provider UX using the repository design policy, responsive EN/AR/RTL.
- [ ] Full CI, CodeQL, dependency/security, Docker and schema-drift gates green on final SHA.

## Money gate
Sprint 13 is NOT complete and MUST NOT enable live money until every unchecked item above is complete and Sprints 1–12 plus High/Critical security prerequisites are independently confirmed.
