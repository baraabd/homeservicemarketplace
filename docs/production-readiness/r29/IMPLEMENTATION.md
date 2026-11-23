# R29 — Stripe sandbox transport and signed inbox boundary

Status: **IMPLEMENTED (bounded components), SOURCE_VERIFIED for the recorded
local checks, INTEGRATION_PENDING, EXTERNAL_BLOCKED and POLICY_BLOCKED**.
This source does not mount Stripe in the running application. It does not
establish SANDBOX_ACCEPTED, HOSTED_ACCEPTED or RELEASE_ACCEPTED. G3 remains
blocked. No merge or deployment is authorized or performed.

## Source and ownership

- Sprint: R29; assigned branch `feat/r29-stripe-sandbox-webhooks`.
- Frozen G2 start SHA: `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`.
- Frozen G2 tree: `43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`.
- Verified owner publication: PR #183 / `986b4707776711e80564f0642133ede90ba16f3c`.
- Actual implementation base: `5ff2b7e6a46b4e42114184fac89928372f4c8d4c`.
- Base tree: `54e00d4e9eaa7bd81146f01b69dfa9b396eab45c`.
- Final containing SHA/tree: recorded and verified in the R29 PR body, avoiding
  a self-referential commit hash. No unmerged peer branch is consumed.
- Exact finite allowlist and record-only leases: [OWNERSHIP.md](OWNERSHIP.md).

The dedicated worktree started at frozen G2 then advanced by checked
fast-forward to the already owner-merged R30–R33 source before product edits.
R24 ports remain authoritative. Shared globals, schema, dependencies, root
configuration, routes and CI are untouched. Only the R29 assignment objects
and its ACTIVE_STATUS table row change in the coordinator records. Historical
peer status prose is preserved instead of silently rewriting their evidence.

## Implemented behavior

- Explicit, expiring, sandbox-only configuration. Test credentials expire in
  at most 24 hours; live keys, cross-account bindings, duplicate plan selection
  and changed immutable binding fields fail closed. No environment variables,
  currencies, prices, role grants or production defaults are invented.
- Constructor injection of official stripe-node 23.0.1 / API
  2026-09-30.endive, with exact version check, 10-second timeout and no hidden
  automatic POST retries. Every transport checks the assigned direct account.
- PaymentIntent transport consumes only a committed R24 attempt/dispatch,
  server-calculated integer amount, immutable binding and stable provider key.
  It reads a known operation rather than recreating it. Unknown creates older
  than 23 hours cannot replay a potentially pruned provider key.
- Official raw-Buffer signature verification, bounded signature/body size,
  timestamp checks, exact API version, test mode and no Connect/org context.
  Only paid PaymentIntent success is a collection confirmation. A verified
  captured Charge supplies the stable economic timestamp across distinct events.
- Delivery identity is the provider event ID; economic identity is the
  PaymentIntent. Existing R24 inbox/ledger/activation transactions own both
  dedupe boundaries. No new financial schema, ledger authority or inbox exists.
- HTTP acknowledgement follows durable inbox commit and reports receipt/
  processing only. The bounded inbox handler resumes RECEIVED records after a
  restart, allows existing R24 locks to arbitrate replicas and pages past poison
  records. Global parser and schedule registration remain CR-002/003.
- Refund transport verifies the existing reservation and its processed original
  payment. Amount/currency/metadata binding, partial amounts, stable keys,
  query-first known IDs, bounded pagination and signed refund normalization are
  implemented. Pending, timeout, incomplete lookup and duplicate-match outcomes
  remain pending/unknown. No reservation release or policy is inferred.
- Refund event normalization is available as an internal method; the collection
  endpoint does not acknowledge refund events without an approved durable inbox
  handoff. R32's existing query recovery is the current integration boundary.

## Remaining concrete integration

[CR-001](shared-change-requests/CR-001-sdk-api-pin.md) names the exact SDK pin,
concurrent dependency ownership, security advisory and missing purchase-surface
decision. [CR-002](shared-change-requests/CR-002-raw-body-wiring.md) contains the
exact parser patch and ingress registration. [CR-003](shared-change-requests/CR-003-inbox-binding.md)
names the one-per-port rail router, worker/CI registration and refund policy
handoff. No unapproved live operation or commercial decision is hidden in them.

No frontend is changed. A PaymentIntent or success URL alone does not deliver
a working browser checkout. The current frozen observation has no client-secret
or checkout URL wire; owner/coordinator selection and any approved additive UI
contract are prerequisites for that acceptance.

## Versions and unchanged authority digests

Contract: `hsm.money.v1`. Prisma: 6.12.0. Existing migrations: 73.
No new schema, migration, shared barrel or package change. SHA-256 values:

- `apps/api/src/modules/money/ports/collection.port.ts`: `b6cc60e09e6e06d46bb44b9331a0f82150e69e4910c50be52e604d37eca41dac`
- `apps/api/src/modules/money/ports/refund.port.ts`: `36b8db533189f787fdb8cef89c69f43eac39dc020d582d69904438c1bdc39dfb`
- `apps/api/src/modules/money/ports/activation.port.ts`: `5f9737d2204f0fffd5345a59b180b15043a28200d34536ba72c9cf7accbb921e`
- `packages/database/prisma/schema.prisma`: `8d408b8219f8aa8c1ededc1d50cd8261adddc07f716261c2ce8432b52e946515`
- `pnpm-lock.yaml`: `38c763b2348edacd22c88f61d7efbae67455ca92e5fb23320e3a5543e0a9d7c4`
- `package.json`: `0531f716047ee05770bcf9bb9884004e2b936bb3a98890536256867cd81c889a`

## Changed path inventory

33 exact files: 30 owned implementation/test/evidence files and three coordinator record files.

```text
apps/api/src/modules/money/adapters/stripe/stripe-bindings.spec.ts
apps/api/src/modules/money/adapters/stripe/stripe-bindings.ts
apps/api/src/modules/money/adapters/stripe/stripe-collection.adapter.spec.ts
apps/api/src/modules/money/adapters/stripe/stripe-collection.adapter.ts
apps/api/src/modules/money/adapters/stripe/stripe-refund.adapter.spec.ts
apps/api/src/modules/money/adapters/stripe/stripe-refund.adapter.ts
apps/api/src/modules/money/adapters/stripe/stripe-sandbox.config.spec.ts
apps/api/src/modules/money/adapters/stripe/stripe-sandbox.config.ts
apps/api/src/modules/money/adapters/stripe/stripe-sdk.spec.ts
apps/api/src/modules/money/adapters/stripe/stripe-sdk.ts
apps/api/src/modules/money/webhooks/stripe/stripe-inbox.job.spec.ts
apps/api/src/modules/money/webhooks/stripe/stripe-inbox.job.ts
apps/api/src/modules/money/webhooks/stripe/stripe-webhook.controller.spec.ts
apps/api/src/modules/money/webhooks/stripe/stripe-webhook.controller.ts
apps/api/src/modules/money/webhooks/stripe/stripe-webhook.module.spec.ts
apps/api/src/modules/money/webhooks/stripe/stripe-webhook.module.ts
apps/api/src/modules/money/webhooks/stripe/stripe-webhook.service.spec.ts
apps/api/src/modules/money/webhooks/stripe/stripe-webhook.service.ts
apps/api/test/integration/r29-stripe-sandbox.integration.spec.ts
apps/api/test/support/r29-stripe.fixture.ts
docs/production-readiness/post-r18/ACTIVE_STATUS.md
docs/production-readiness/post-r18/SPRINT_REGISTRY.json
docs/production-readiness/post-r18/waves/wave-03.plan.json
docs/production-readiness/r29/ACCEPTANCE.md
docs/production-readiness/r29/IMPLEMENTATION.md
docs/production-readiness/r29/OWNERSHIP.md
docs/production-readiness/r29/RISKS.md
docs/production-readiness/r29/ROLLBACK.md
docs/production-readiness/r29/shared-change-requests/CR-001-sdk-api-pin.md
docs/production-readiness/r29/shared-change-requests/CR-002-raw-body-wiring.md
docs/production-readiness/r29/shared-change-requests/CR-003-inbox-binding.md
scripts/production/stripe-sandbox/verify-sandbox.cjs
scripts/production/stripe-sandbox/verify-sandbox.test.cjs
```
