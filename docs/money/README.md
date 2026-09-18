# Milestone M5 — money implementation

Sprint 13 establishes the dark money authority: ADR, shared contracts, domain invariants, persistence foundation, plan/version/entitlement semantics and security/UX contracts. It intentionally does not execute live payments.

Sprint 14 will add payment adapters and authoritative confirmation: Stripe sandbox + signed idempotent webhooks; Sham Cash/Syriatel Cash/cash-office instructions; restricted receipt ingestion, scan/fingerprint/review; atomic manual approval; refunds and event reconciliation.

Sprint 15 will add subscription operations and reconciliation: My Plan, usage/renewal/expiry, admin financial operations, scheduled reconciliation, exception queues, reports and notification scheduling. Payouts remain prohibited until a separate marketplace-funds ADR establishes whether HSM ever holds/transfers customer funds; provider subscription revenue must not be conflated with marketplace payouts.

Documents in this folder are normative for M5 together with ADR 0014 and repository security/UX rules.