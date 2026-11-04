# K07 — open owner decisions and external inputs

Status: **OPEN**. Nothing below is approved. Each item names the evidence that
makes it a decision rather than an engineering default. No code in K07 assumes
an answer.

## K07-OD-01 — What does a repeat purchase of the same plan version do?

Observed on real PostgreSQL/Redis/ClamAV (`k07-repeat-purchase.integration.spec.ts`):
the HTTP confirmation path never passes a `subscriptionId` to activation
(`apps/api/src/modules/money/domain/subscription-activation.service.ts`, the
`else` branch that creates a new `ProviderSubscription`). A second confirmed
purchase of the same plan version therefore opens a **separate subscription
whose period overlaps the first**, with its own entitlement limits. The domain
renewal branch (next period starts at the previous end) exists and is tested
in `r19-subscription-money.integration.spec.ts`, but no route uses it.

ADR 0014 defers renewal to a later sprint, and no owner record decides it.
Choose one, with its policy version and effective date:

1. renew: the next period starts at the current period's end on the same
   subscription;
2. parallel: separate subscriptions are intended (state how entitlements and
   refunds combine);
3. refuse: a new purchase is rejected while a paid period is current or
   scheduled (state the reason code and the UI copy).

Until then the K07 browser fix only guarantees a distinct intent, attempt,
confirmation and period. The integration test deliberately does not assert
which of the three answers is correct.

## K07-OD-02 — Payment provider for a Saudi-incorporated merchant

K07 must use the K02-selected provider. **No provider is selected.** There is
no selection on `develop` `92770ea6` or in K02's in-progress worktree
(searched 2026-11-03 for Moyasar, HyperPay, PayTabs, Tap, Checkout.com,
Tamara, Tabby, mada).

The only implemented card rail is Stripe (sandbox). Stripe's official
availability page (<https://stripe.com/global>, fetched 2026-11-04) does not
list Saudi Arabia as a supported, preview or invite-only country. The United
Arab Emirates is listed. Accepting Saudi-issued cards is not merchant
eligibility. Stripe therefore cannot be assumed to serve a Saudi-incorporated
HSM entity. Re-check this before relying on it; the page may change.

Required from K02 or the owner:

- the selected provider and the approved contracting entity and country;
- the provider's written merchant-onboarding acceptance for that entity, the
  subscription product, SAR settlement and the chosen methods (for example
  mada, Visa/Mastercard, Apple Pay);
- whether Stripe stays a G3 acceptance dependency (existing G3 categories
  require a real Stripe sandbox) while another provider serves launch. If so,
  both sets of evidence are needed. K07 does not rewrite G3 to pass.

## K07-OD-03 — Inputs needed before a selected-provider adapter can be built

Not started, because building an adapter without these would invent contracts:

- provider sandbox credentials and a webhook signing secret, through the
  approved secret store (never in the repository or chat);
- a webhook route that staging can reach, and its forwarding configuration;
- the provider's signature scheme, idempotency semantics, refund API and
  query-by-reference recovery API, from current official documentation;
- K02's lawful KYC and minimal-evidence policy, and a provider-hosted
  verification reference where approved.

## K07-OD-04 — Commercial and policy inputs (unchanged from G3)

Still absent, and not invented by K07: an approved SAR plan catalogue
(immutable plan versions and prices), fee and tax treatment, the refund
window, partial-refund rules, the whole-subscription consequence of a refund
(`SUSPEND_SUBSCRIPTION` or `CANCEL_SUBSCRIPTION`), cancellation terms, the
manual-settlement authority, and the policy version with its effective dates.
The G3 integration tests use explicitly synthetic XTS fixtures.

## K07-OD-05 — Refund workspace route

The R32 refund commands exist in the API, but the web application has no
refund workspace route. The finance link now reports
`REFUND_WORKSPACE_ROUTE_ABSENT` instead of the stale `R32_INTEGRATION_PENDING`.
Building that workspace is a separate scoped UI task (Mode B/C). It needs
OD-04's refund policy first.

## Publication authority

G3 acceptance, freeze and publication are not K07 actions. They need all
K01–K07 engineering outputs accepted and merged on one candidate, including
K04 and K07, then coordinator approval and verified publication.
`node .github/scripts/g3-record.mjs --ready R34` still exits 1, as intended.
