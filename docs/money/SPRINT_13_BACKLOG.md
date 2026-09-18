# Sprint 13 implementation slices

S13.1 architecture: ADR, threat model, state machines, live-money gate.
S13.2 contracts/domain: integer money, quote calculation, plan/version semantics, entitlements, calendar periods, ledger balance.
S13.3 persistence: additive Prisma schema + migration, constraints, indexes, immutable ledger, migration/drift tests.
S13.4 application services: plan draft/publish/retire, coupon validation/redemption, quote/intent idempotency, subscription/entitlement reads, atomic usage consumption.
S13.5 API/RBAC: provider plan/quote/subscription/entitlement routes; admin plan/coupon routes; CSRF/IDOR/audit.
S13.6 UX/UI: mobile-first provider plans/My Plan foundation and admin plan/coupon management; EN/AR/RTL/WCAG 2.2 AA.
S13.7 verification: unit/integration/concurrency/E2E, migration rehearsal, CI/CodeQL/security/Docker and final evidence.

No slice may silently enable Stripe/manual payment confirmation. Those remain Sprint 14.