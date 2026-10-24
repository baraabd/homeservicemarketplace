# CR-003 — One rail router, durable inbox scheduling and refund handoff

State: **INTEGRATION_PENDING**. Exact shared paths for serialized coordinator work:

- `apps/api/src/modules/money/money.module.ts`
- `apps/api/src/modules/money/money.module.spec.ts`
- `apps/api/src/modules/money/adapters/money-rail-router.ts` (new shared composition)
- `apps/api/src/modules/money/adapters/money-rail-router.spec.ts` (new)
- `.github/workflows/ci.yml`

Minimal composition: create one `StripeTransportModule.register` with the
accepted PrismaModule import, explicit sandbox configuration and official Stripe
constructor pinned by CR-001. Import that transport instance into MoneyModule.
CR-002 mounts the ingress separately with the same exported instance. No
MoneyModule → ingress → MoneyModule cycle or duplicate command/ledger provider.

Replace exactly the three current manual-only aliases with one router per
frozen port. Keep the receipt participant and R31 activation aliases unchanged:

| Existing token             | Minimal delegation rule                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONEY_CONFIGURATION`      | `resolve` dispatches STRIPE to StripeSandboxConfiguration, manual methods to ManualRailConfiguration; `resolveBinding` chooses the same exact method and adapter ID, never a fallback |
| `MONEY_COLLECTION_ADAPTER` | `isConfigured`/`createOrResume` select the exact binding; signed-event normalization accepts only `hsm.stripe.v1`/SANDBOX through StripeCollectionAdapter; retain all manual behavior |
| `MONEY_REFUND_ADAPTER`     | exact STRIPE binding selects StripeRefundAdapter; manual binding selects ManualRefundAdapter; no timeout fallback or changed provider key                                             |

The router rejects unsupported adapter/method combinations. Add regression
tests for both families, no live mode, no ambiguity, exact old binding lookup
and unchanged unavailable defaults. No shared port signature or database change.

Credentials/configuration are supplied only by the coordinator's approved
secret/configuration provider. An absent configuration uses
`new StripeSandboxConfiguration()` and remains unavailable. Before any enabling
env-schema change, separately record its exact paths and approval; no implicit
environment keys or unreviewed JSON blob are authorized here. Credentials have
at most 24-hour validity, a test-key prefix and exact test-account binding.

## Durable processing

Schedule the exported `StripeInboxJob.runBatch()` through the approved existing
worker registration. Each invocation reads at most 25 scoped RECEIVED records,
calls the existing R24 transaction boundary and returns processed/pending counts.
It writes no parallel inbox, ledger or subscription record. The cursor is an
in-memory fairness aid only; durable status is the existing inbox. Restart scans
received records from the beginning. R24 database locks/keys arbitrate replicas.
No production timer or handler has been registered in this lane.

`StripeWebhookService` acknowledges only after `acceptExternalEvent` commits;
activation is separate durable work. DB receipt failure returns failure; failed
activation retains RECEIVED evidence. Repeated event IDs use existing delivery
dedupe; distinct events for one PaymentIntent use that PaymentIntent as the
economic identity and a verified Charge timestamp as a stable confirmation time.

## Refunds and actual remaining policy

Refund transport reads the existing reserved refund and one processed original
payment binding. It never reserves, grants eligibility, posts a compensation or
changes entitlements. Submit/query retain the provider key, bind the original PI,
validate integer amount/currency, and keep ambiguous results UNKNOWN. Unknown-ID
queries scan at most 10 pages × 100 refunds; incomplete/duplicate pages and
multiple matching refunds are UNKNOWN. No match is not proof of failure.

R32's current query/dispatch and durable result boundary consumes these
observations. Its unavailable commercial policy source and confirmed-refund
participant are unchanged. The coordinator must obtain actual approved policy
and consequence wiring before real refunds can be accepted. R29 does not invent
them. Signed refund normalization is supplied, but the collection endpoint does
not ACK refund events: no frozen refund-event inbox contract exists. Prefer R32's
existing query recovery; approve a durable signed-refund intake contract before
subscribing to refund events. A successful transport response alone is not local
financial success.

## Required checks and final gate

Add the official-SDK harness to CI after dependency pinning:

```sh
pnpm --filter @homeservicemarketplace/api build
node scripts/production/stripe-sandbox/verify-sandbox.cjs --offline-signatures --sdk-root "$PWD/apps/api"
```

The repository's real PostgreSQL/Redis job discovers the dedicated
`r29-stripe-sandbox.integration.spec.ts` under RUN_DB_INTEGRATION=1. Its Stripe
SDK is explicitly synthetic; it proves local transaction behavior, not external
money. Real sandbox payment/authentication/cancellation/decline/async and
partial/full-refund tests, missed-webhook recovery from the provider, normal
browser purchase flow and both-family G3 acceptance remain required separately.
Keep PR Draft and G3 BLOCKED until source-bound integrated evidence exists.
