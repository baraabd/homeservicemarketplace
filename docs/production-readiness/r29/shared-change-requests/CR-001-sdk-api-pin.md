# CR-001 — Official SDK pin and purchase-surface decision

State: **INTEGRATION_PENDING / POLICY_BLOCKED**. Not applied by R29.

Exact shared paths: `apps/api/package.json`, `pnpm-lock.yaml`. PR #192 owns
these paths for an independent dependency comparison. Do not import it, edit
its branch, or write the same files before a coordinator ownership handoff.

Minimal package patch:

```diff
   "dependencies": {
+    "stripe": "23.0.1",
```

The coordinator uses pinned Node 24.21.0 / pnpm 10.32.1 to resolve this one
addition, reviews the generated lockfile diff, then performs a fresh frozen
install. No other package, workspace pin or Prisma version changes. The isolated
verification installation resolved exactly one package and no dependencies.
Do not hand-edit integrity data or copy an unrelated dependency branch.

The owned `StripeSdk` takes the actual official Stripe constructor. It checks
`PACKAGE_VERSION === '23.0.1'`, constructs with `apiVersion:
'2026-09-30.endive'`, `timeout: 10000`, `maxNetworkRetries: 0` and telemetry off.
No host override, Connect account option or live credential is supported.
Official `webhooks.constructEvent` verifies the untouched Buffer; no custom
HMAC implementation exists. The task-local SDK is a verification dependency,
not an undeclared production import or a shared node_modules installation.

## Sources inspected 2026-10-23

- [stripe-node v23.0.1](https://github.com/stripe/stripe-node/releases/tag/v23.0.1)
  and [SDK/API mapping](https://github.com/stripe/stripe-node/wiki).
- [PaymentIntent create](https://docs.stripe.com/api/payment_intents/create):
  creation alone is not confirmation; amount is an integer in minor units.
- [Webhooks](https://docs.stripe.com/webhooks): exact raw body, signature
  verification, unordered delivery and distinct delivery/economic dedupe.
- [Idempotency](https://docs.stripe.com/api/idempotent_requests): keys can be
  pruned after at least 24 hours. R29 stops unknown creates at 23 hours using
  existing durable dispatch creation time; operator reconciliation is required.
- [Refund create](https://docs.stripe.com/api/refunds/create) and
  [refund object](https://docs.stripe.com/api/refunds/object): original payment,
  partial amount, terminal/pending status, no inference from an HTTP timeout.

## Open purchase-surface authority

ADR 0014 chooses the HSM PaymentIntent orchestration boundary, while
`docs/money/UX_UI_2026.md` mentions a hosted/approved checkout surface. Neither
selects hosted Checkout versus Elements/PaymentIntents in a versioned decision.
The frozen R24 observation contains only status and externalOperationId; it
contains no checkout URL or client-secret delivery contract. R29 therefore
implements the server-only PaymentIntent/card sandbox transport. It does not
invent a client-secret response, hosted URL, recurring Stripe Billing model,
plan price, market, production currency or payment-method policy.

Owner/coordinator must record the specific browser purchase approach and, if
needed, approve an additive shared contract/route and its UI owner before an
end-to-end purchase can be accepted. This request supplies no automatic approval.

Verification: existing R29 adapter/HTTP units, official-SDK signature harness,
TypeScript compatibility with the actual Stripe constructor, frozen install,
dependency/security scan, build and final-head CI/CodeQL. No schema/migration
consequence. Sandbox/merchant credentials and endpoint subscriptions remain
separately authorized external inputs.

## Existing dependency acceptance blocker

The unchanged full dependency tree audit on this execution failed with two HIGH
package occurrences for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5):
`apps/api > zod@3.25.76` and `eslint-plugin-react-hooks > zod@4.3.6`.
The advisory reports patched versions >=4.6.6. Neither was introduced by R29;
the root manifest and lockfile remain byte-identical to the base. This is still
a release/CI blocker. The dependency owner must supply a reviewed upgrade and
compatible performance evidence. Do not mute the advisory, relax the zero-finding
policy or import PR #192 automatically. R29 bounds raw webhook bytes but does
not claim that local bound remediates the repository advisory.
