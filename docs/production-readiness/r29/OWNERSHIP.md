# R29 ownership and start authorization

Mode A — backend integration and correctness. The owner requested R29 on
2026-10-23. The previously delegated root coordinator assigns this one writer,
`r29-20261023-b3dda4f7`, to `feat/r29-stripe-sandbox-webhooks`.

Frozen G2 start: `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`, tree
`43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`. Owner-merged G2 publication:
PR #183, `986b4707776711e80564f0642133ede90ba16f3c`. The isolated worktree
`/workspace/scratch/b3dda4f7b9ef/hsm-r29` was created at that frozen source.
Before product edits the coordinator approved a checked fast-forward to the
already owner-merged develop source `5ff2b7e6a46b4e42114184fac89928372f4c8d4c`,
tree `54e00d4e9eaa7bd81146f01b69dfa9b396eab45c`, retaining G2 ancestry and
R30–R33 integration. This is the actual implementation comparison base; it
does not refreeze G2 or certify G3. No unmerged peer source was imported.

## Exact single-writer assignment, recorded before implementation

The coordinator approves these finite paths for root. Unused paths need not
be created; no blanket directory grant is implied.

```text
apps/api/src/modules/money/adapters/stripe/stripe-bindings.ts
apps/api/src/modules/money/adapters/stripe/stripe-bindings.spec.ts
apps/api/src/modules/money/adapters/stripe/stripe-collection.adapter.ts
apps/api/src/modules/money/adapters/stripe/stripe-collection.adapter.spec.ts
apps/api/src/modules/money/adapters/stripe/stripe-refund.adapter.ts
apps/api/src/modules/money/adapters/stripe/stripe-refund.adapter.spec.ts
apps/api/src/modules/money/adapters/stripe/stripe-sandbox.config.ts
apps/api/src/modules/money/adapters/stripe/stripe-sandbox.config.spec.ts
apps/api/src/modules/money/webhooks/stripe/stripe-webhook.controller.ts
apps/api/src/modules/money/webhooks/stripe/stripe-webhook.controller.spec.ts
apps/api/src/modules/money/webhooks/stripe/stripe-webhook.service.ts
apps/api/src/modules/money/webhooks/stripe/stripe-webhook.service.spec.ts
apps/api/src/modules/money/webhooks/stripe/stripe-webhook.module.ts
apps/api/test/integration/r29-stripe-sandbox.integration.spec.ts
scripts/production/stripe-sandbox/verify-sandbox.cjs
scripts/production/stripe-sandbox/verify-sandbox.test.cjs
docs/production-readiness/r29/IMPLEMENTATION.md
docs/production-readiness/r29/ACCEPTANCE.md
docs/production-readiness/r29/RISKS.md
docs/production-readiness/r29/ROLLBACK.md
docs/production-readiness/r29/OWNERSHIP.md
docs/production-readiness/r29/shared-change-requests/CR-001-sdk-api-pin.md
docs/production-readiness/r29/shared-change-requests/CR-002-raw-body-wiring.md
docs/production-readiness/r29/shared-change-requests/CR-003-inbox-binding.md
apps/api/src/modules/money/adapters/stripe/stripe-sdk.ts
apps/api/src/modules/money/adapters/stripe/stripe-sdk.spec.ts
apps/api/src/modules/money/webhooks/stripe/stripe-inbox.job.ts
apps/api/src/modules/money/webhooks/stripe/stripe-inbox.job.spec.ts
apps/api/src/modules/money/webhooks/stripe/stripe-webhook.module.spec.ts
```

## Serialized record-only lease

Root alone may update only the R29 objects and derived startable/blocked lists in:

- `docs/production-readiness/post-r18/waves/wave-03.plan.json`
- `docs/production-readiness/post-r18/SPRINT_REGISTRY.json`

Preserve every peer object, accepted-source identity and gate validator. This
lease ends at R29 PR closure or coordinator revocation. No automatic grants,
merge, deployment, account creation, production credential or live rail is
authorized.

## Shared changes remain requests

PR #192 currently owns `apps/api/package.json` and `pnpm-lock.yaml` for its
R27 dependency comparison. R29 will not write either file concurrently. SDK
installation, root module composition, parser and CI changes are concrete
requests CR-001/002/003, to be applied by the coordinator after a serialized
ownership handoff. A constructor-injected official SDK permits complete
transport and signature-boundary implementation without a hidden dependency,
vendoring or an import from a peer branch. SDK contract doubles are labeled.

The inspected foundation does not select a specific hosted Checkout versus
Elements purchase surface. R29 implements only the server PaymentIntent
transport matching the frozen ports; no checkout URL, client secret wire,
recurring Stripe Billing policy or new frontend flow is inferred. CR-001
records the outstanding browser purchase decision.

## Isolation

Independent node_modules, generated Prisma, builds, logs and SDK verification
installation live in this task worktree/scratch. Planned isolated ports are
API 4329, browser 4429, PostgreSQL 5529 and Redis 6429; none is a claim of
provisioning. Never use an existing DB/Redis/user environment, global flush or
shared storage. No authorized Stripe sandbox credentials or account allocation
is present. Offline official-SDK tests are not external payment evidence.

## Exact test fixture extension

Before test edits, root assigns `apps/api/test/support/r29-stripe.fixture.ts`
to this session for explicitly labeled SDK/durable-port doubles. It selects
no provider account or commercial policy and is mirrored in both records.

## Serialized status-row lease

The unchanged governance test correctly rejected an R29 registry/status mismatch.
Before correction root leases only the R29 table row in
`docs/production-readiness/post-r18/ACTIVE_STATUS.md`. Root also owns the pending
supplemental PR #191; it never changed that row and will not edit this row there.
This is an explicit scoped handoff, not shared concurrent authorship. Preserve
all other rows/prose and all peer JSON objects. No validator is relaxed.
