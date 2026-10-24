# G3 integration implementation

Status: IMPLEMENTED; local source checks completed/published as recorded in ACCEPTANCE.md. INTEGRATION_PENDING, POLICY_BLOCKED and EXTERNAL_BLOCKED. This is the G3 integration gate, not a new product sprint and not R34 acceptance.

- Actual starting source: `73a4a64a77844db7815466f47d8afdefb0b35c2f`; tree `04fbecf5ff028f95136cdddca5aeb7bb7451e09f`.
- Published implementation source: `134301e255d339d2b31acd7038787a2c3924210d`; tree `f1fddb0a55a234e141697cc0b045be3733059c55`.
- Equivalent normal-hook local implementation commit: `da1bbede4390d753f85d88cef6752a869f0ed5a4`.
- Branch: `coord/g3-wave4-start-gate`. Subsequent source/evidence commits and the final PR head are recorded in the PR; a document cannot contain its own final commit SHA. No G3 frozen execution SHA is issued.
- Writer: owner-delegated G3 coordinator; exact lease: [OWNERSHIP.md](OWNERSHIP.md) and [ALLOWLIST.json](evidence/ALLOWLIST.json). No same-wave peer source is consumed.

## Implemented behavior

1. The actual AppModule mounts one shared official Stripe transport, exact raw signed webhook route and bounded inbox scheduler. MoneyModule routes Stripe/manual collection and refund work by the frozen mode/method/adapter identity. No timeout fallback, new provider key, live binding or second ledger authority is introduced. The scheduler processes at most 25 inbox rows per batch, prevents local overlap and waits for active work during shutdown. Existing durable R24 command locking handles duplicate replicas.
2. My Plan includes a sandbox purchase surface with explicit exact-amount confirmation and the official Payment Element. Prices/currency come from the server intent, displayed as exact integer minor units. Opaque idempotency keys survive refresh per account/plan; client secrets never enter query caching or storage. The private session endpoint validates the external intent binding and repeats current permission/ownership checks after network I/O. Stripe browser success and redirects cannot activate a subscription; only the server read reports confirmation.
3. ApprovedRefundPolicySource reads bounded, immutable, explicitly scoped sandbox policy records. Missing or overlapping approvals fail closed. `MONEY_REFUND_AUTHORIZATION_ENABLED` defaults to false and disables new reservations without discarding historical recovery authority. ApprovedRefundParticipant validates the original obligation and enlists R31's lifecycle service in the same R24 confirmation transaction. Only an explicitly approved whole-subscription SUSPEND_SUBSCRIPTION or CANCEL_SUBSCRIPTION effect is supported. No policy row or commercial decision is seeded.
4. One additive migration preserves the existing exception identity and adds durable window/cursor/fence/lease, independent-source run provenance, overlap dedupe, original-evidence and append-only decision storage. Database guards prohibit incomplete-source completed runs, cross-scope observations, evidence rewriting, negative counters and same-person resolution checking. The additive `hsm.reconciliation.v2` action contract covers dry-run, unchanged payload hash, expected revision, resolution/reopening and checker approval reference. R34 must implement and exercise the reconciliation worker and operator execution after G3; this foundation does not claim those actions are mounted. R33 continues to report unavailable run/action state truthfully.
5. SDK dependencies are exactly pinned (server 23.0.1; browser 10.1.0). R27 comparison now includes the web manifest in its exact dependency inventory. Immutable baseline/repair controls were committed with normal hooks, published, fetched and checked; no performance budget was weakened.

## PR repair after the first combined CI run

The four Stripe checkout controls now disable color transitions during theme changes, matching the existing My Plan accessibility behavior. This addresses the observed transient contrast failure without changing the flow or widening a visual budget.

The refund orchestrator now records SUCCEEDED and its compensating posting before calling the concrete R31 participant, all inside one transaction. Previously the participant read the earlier refund state and rejected every real successful consequence. The two new assembled manual cases execute the registered collection, activation, approved-policy, refund and outbox implementations through actual HTTP/PostgreSQL/Redis/ClamAV. They prove both approved consequence types and rollback/recovery after a real participant has made its transactional writes. The original R30 suite remains unchanged.

The existing R30 CI service job now runs the six G3 runtime cases into a separate report with an exact-six, zero-failure/zero-skip requirement and uploads that report with its evidence. Original required jobs, counts, timeouts and browser assertions remain intact. Forty negative tests protect the new external runner's explicit authorization, test-only configuration, source identity and evidence reporting.

`scripts/production/stripe-sandbox/verify-external.cjs` and its TypeScript helper provide an explicitly authorized Stripe test-account execution path. Fourteen ordered checkpoints cover authentic provider confirmation, durable inbox/replay, real activation rollback, independent refund observation and query recovery after a local consequence failure. It uses zero money-port overrides and retains its isolated database if an external operation may exist when a failure occurs. It never generates a provider signature or treats synthetic approval as real authority. Its successful result is scoped to those HTTP/database scenarios; browser Payment Element, process-kill and other required external cases remain separate evidence. See [SANDBOX_RUNBOOK.md](SANDBOX_RUNBOOK.md).

Additional repair paths are `.github/workflows/ci.yml`, `apps/api/src/modules/money/application/money-command.service.ts`, the existing G3 runtime integration spec and StripePlanPurchase component, `apps/api/test/support/g3-stripe-external.fixture.ts`, the external runner and its tests, and the leased G3 documentation/evidence. Exact local results are recorded in [ACCEPTANCE.md](ACCEPTANCE.md). No external provider execution or G3 publication is inferred from source completion.

## Configuration and authority

`MONEY_STRIPE_SANDBOX_JSON` is a secret-manager supplied JSON document matching the existing R29 strict configuration: test secret, webhook secret, account reference, expiry no more than 24 hours away, signature tolerance and explicit immutable plan/account/currency bindings. `MONEY_STRIPE_PUBLISHABLE_KEY` accepts test publishable keys only. Empty settings leave Stripe disabled. `OUTBOX_WORKER_ENABLED` controls scheduled processing. The isolated sandbox web build additionally requires `VITE_STRIPE_SANDBOX_ENABLED=true` to admit the documented Stripe.js/API/3DS frame origins in the enforced document CSP. The default remains self-only scripts and no frames; malformed values fail the build. Existing Vite policy injection consumes this option. Server test-mode binding remains authoritative; this browser option cannot enable a live rail. Any additional deployment header policy must admit the same reviewed subset or the sandbox remains blocked. Do not print these settings or copy another session's environment.

Refund policy rows require a real approval reference, exact version/scope, approval/effective dates, strict existing R32 rules and explicit entitlement effect. The operator must separately authorize policy data and sandbox credentials. The migration creates neither grants nor an approval. Existing R16/R18 market, fee, payout and verification holds are preserved.

Source schema version: Prisma 6.12.0 plus `20261024120000_g3_financial_integration`; money contracts remain `hsm.money.v1` with additive session/reconciliation types; new action protocol is `hsm.reconciliation.v2`. Configuration SHA-256: `bc65c33b8aa687e5f123347e6522ad19cfff015c6f0011f14cc7b9f8fc0badd3`.

Official integration references inspected: [PaymentIntents](https://docs.stripe.com/payments/payment-intents), [Payment Element](https://docs.stripe.com/payments/payment-element), [intent-first integration](https://docs.stripe.com/payments/accept-a-payment-intent-first), [webhook raw body](https://docs.stripe.com/webhooks), [official SDK](https://github.com/stripe/stripe-node), [Elements CSP](https://docs.stripe.com/security/guide#content-security-policy).

## Changed paths

- `.github/scripts/r27-dependency-controls.mjs`
- `.github/scripts/r27-dependency-controls.test.mjs`
- `.github/workflows/r27-performance.yml`
- `apps/api/package.json`
- `apps/api/src/app.module.spec.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/config/env.schema.ts`
- `apps/api/src/infrastructure/http/request-body.spec.ts`
- `apps/api/src/infrastructure/http/request-body.ts`
- `apps/api/src/modules/money/money.module.spec.ts`
- `apps/api/src/modules/money/money.module.ts`
- `apps/api/src/modules/money/refunds/refund-eligibility.policy.ts`
- `apps/api/src/modules/money/runtime/approved-refund-policy.source.spec.ts`
- `apps/api/src/modules/money/runtime/approved-refund-policy.source.ts`
- `apps/api/src/modules/money/runtime/approved-refund.participant.spec.ts`
- `apps/api/src/modules/money/runtime/approved-refund.participant.ts`
- `apps/api/src/modules/money/runtime/money-rail-router.spec.ts`
- `apps/api/src/modules/money/runtime/money-rail-router.ts`
- `apps/api/src/modules/money/runtime/stripe-inbox.scheduler.spec.ts`
- `apps/api/src/modules/money/runtime/stripe-inbox.scheduler.ts`
- `apps/api/src/modules/money/runtime/stripe-runtime.module.spec.ts`
- `apps/api/src/modules/money/runtime/stripe-runtime.module.ts`
- `apps/api/src/modules/money/runtime/stripe-session.controller.ts`
- `apps/api/src/modules/money/runtime/stripe-session.service.spec.ts`
- `apps/api/src/modules/money/runtime/stripe-session.service.ts`
- `apps/api/src/modules/money/subscriptions/subscription-lifecycle.service.ts`
- `apps/api/src/modules/money/webhooks/stripe/stripe-webhook.module.ts`
- `apps/api/test/integration/g3-financial-foundation.integration.spec.ts`
- `apps/api/test/integration/g3-financial-runtime.integration.spec.ts`
- `apps/web/package.json`
- `apps/web/src/app/features/financial-operations/financial-operations.copy.ts`
- `apps/web/src/app/features/subscriptions/MyPlanScreen.tsx`
- `apps/web/src/app/features/subscriptions/StripePlanPurchase.test.tsx`
- `apps/web/src/app/features/subscriptions/StripePlanPurchase.tsx`
- `apps/web/src/app/features/subscriptions/stripe-purchase.api.test.ts`
- `apps/web/src/app/features/subscriptions/stripe-purchase.api.ts`
- `docs/performance/post-r18/r27-dependency-controls.json`
- `docs/production-readiness/post-r18/gates/g3/OWNERSHIP.md`
- `docs/production-readiness/post-r18/gates/g3/SOURCE_MANIFEST.json`
- `docs/production-readiness/post-r18/gates/g3/evidence/ALLOWLIST.json`
- `docs/production-readiness/post-r18/gates/g3/shared-change-requests/CR-004-g3-integration.md`
- `packages/contracts/src/money/api-contracts.ts`
- `packages/contracts/src/money/financial-contracts.ts`
- `packages/contracts/src/money/financial-operations.ts`
- `packages/database/prisma/migrations/20261024120000_g3_financial_integration/migration.sql`
- `packages/database/prisma/schema.prisma`
- `pnpm-lock.yaml`

CSP follow-up owned paths: `scripts/production/security-app/web-csp.cjs` and `scripts/production/security-app/verify-boundaries.test.cjs`.
