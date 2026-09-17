# Sprint 13 money foundation migration

This migration is intentionally additive and dark. It creates no live payment credentials or payment execution path.

Database-enforced invariants include non-negative minor-unit money, uppercase three-letter currency codes, unique command idempotency, one active subscription per provider, positive ledger entries, append-only posted ledger records, and a balance/currency check before a ledger transaction may become POSTED.

Application code must still use serializable/transactional commands for coupon redemption, entitlement consumption, payment confirmation and subscription activation. Database constraints are the final race-condition boundary, not a replacement for domain validation.
