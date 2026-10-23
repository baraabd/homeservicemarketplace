# R31 — Subscription plans, My Plan and atomic entitlements

## Scope and source authority

R31 implements the subscription participant, paid-usage accounting, lifecycle
consumers and provider My Plan view on the accepted R19/R24 authority. Mode C
applies to the bounded feature; Mode A applies to the shared composition and
publication-record corrections. This document does not grant production,
payment, permission, merge or deployment approval.

- Sprint and branch: `R31`, `feat/r31-subscription-entitlements`.
- Session: `r31-20261023-d799cbee`.
- Actual branch-start / accepted G2 source:
  `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`.
- Accepted source tree: `43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`.
- Separately owner-merged G2 publication:
  `986b4707776711e80564f0642133ede90ba16f3c`, PR #183.
- Published money contract: `hsm.money.v1`; additive subscription read DTOs.
- Database authority: the existing 72 migrations and Prisma 6.12.0 schema;
  no schema, migration, dependency or lockfile change.
- Final source SHA/tree: recorded in the PR's full `Final SHA` field and
  final-head CI provenance, including the R31 browser summary. A commit cannot
  contain its own hash; older local results are not claimed for a newer head.

The coordinator verified the actual G2 merge and its source tree before
reconciling the publication record. The thirteen differences from the frozen
source were already owner-merged evidence/registry files. Only this R31 session
was assigned. The unchanged G2 readiness validator accepted that assignment;
unassigned R29/R30/R32/R33 lanes and Wave 4 remain held.

## Missing behavior and implementation decisions

| Boundary             | Observed frozen behavior                                                              | R31 behavior                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Activation           | R19 creates the authoritative period; R24's participant defaults unavailable          | Bind the real R31 participant to R24, verify the existing period/confirmation/ledger identity and enqueue lifecycle work in the caller transaction |
| Purchased terms      | Immutable plan-version persistence already exists                                     | Publish a newer approved version through a trusted internal service; preserve the purchased version and existing server quote calculation          |
| Usage                | Unique usage identities exist, but uniqueness alone cannot enforce a shared limit     | Lock the owned subscription, verify a current paid period, count and insert in the caller transaction; deduplicate stable domain operation keys    |
| Lifecycle            | Frozen period history and worker/outbox contracts exist                               | Schedule stable expiry identities, inject time, reject early events and protect renewed periods from stale expiry                                  |
| Commercial decisions | Cancellation, grace, auto-renewal, refund consequences and usage reset are unresolved | Preserve blocked defaults; allow only named, explicitly configured internal policy operations with immutable replay receipts                       |
| Provider screen      | No dedicated server-backed My Plan surface                                            | Add authenticated `/provider/my-plan`, a profile-menu entry, selected-subscription history/usage and a published plan catalog                      |

### One financial authority

The flow remains R24 command/orchestration to R19 confirmation, balanced ledger
posting and immutable period creation, followed by the R31 activation participant
inside the same database transaction. R31 does not create a second period,
ledger, quote engine or payment adapter. A participant failure aborts the caller
transaction, including confirmation, ledger, period, coupon redemption and
outbox work. Existing unique identities prevent repeated confirmation from
extending access twice.

The participant checks payer/provider, purchased plan, subscription and period
IDs, the successful obligation, posted standard ledger transaction, amount,
currency and exact period bounds. A valid purchased entitlement snapshot is
required before scheduling anything. No subscription action writes provider
verification, work access, account standing or withdrawable earnings.

### Entitlements and usage

Entitlements are validated data with `BOOLEAN` or `LIMIT` values. Invalid,
duplicate or unsafe stored definitions fail closed. Consumption uses the
existing `MoneyEntitlementUsage` table and its unique subscription/key/usage
identity, plus a subscription row lock shared with lifecycle transitions.
Distinct concurrent keys cannot exceed a limit; a repeated operation consumes
no extra unit. A caller can supply its transaction so usage and its domain
operation commit together. The service also offers a transaction wrapper.

R19 usage is cumulative per subscription and has no period foreign key.
R31 deliberately preserves that stored meaning. Monthly resets, pooling across
multiple subscriptions and paid enforcement inside unrelated domain actions
require explicit policy and integration. Consumers must still enforce their
own action permission, identity, legal/age and work eligibility requirements.

### Published plans and quotes

`PlanVersionService` accepts an approved internal commercial input, validates
the frozen monthly/annual intervals and money representation, serializes version
publication by plan key and inserts a newer immutable version. It exposes no
public publishing route and no default approved commercial policy. Existing
subscribers remain bound to the version they bought. The existing R19/R24
server-calculated quote, coupon validity/caps and confirmation/redemption
transaction remain authoritative.

The public application surface does not invent a supported currency, exponent,
price, trial, tax, fee or refund window. The catalog includes only published,
unretired versions visible at the injected server time. Its cursor is validated
and scoped to the authorized provider account.

### Lifecycle and durable work

`money.subscription.expiry-due.v1` and
`money.subscription.reminder-due.v1` use stable period/event identities. The
existing OutboxWorker invokes `SubscriptionOutboxHandler`; payload shape,
aggregate identity and confirmation linkage are validated before effects.
Expiry uses the stored period end with an injected clock. A confirmed current
or future renewal prevents an old expiry event from ending that subscription.
There is no inferred grace interval or unconfirmed renewal access.

Reminders require an explicitly configured policy version and lead time. They
create one bilingual durable notification through the existing notifications
service in the worker transaction. No subscription SMTP template or production
reminder schedule is invented.

Approved internal cancellation/suspension and confirmed refund effects require
a matching named policy. The existing immutable `MoneyCommand` table stores
their operation digest and response in the same transaction, under actor system
`money.subscription-lifecycle` and a reserved `r31_` key. Public R24 keys cannot
claim that namespace. Replays return the original receipt rather than repeating
an old effect against a later period. No lifecycle write endpoint is exposed.

### My Plan experience

The standalone authenticated provider route uses the existing auth, language,
React Query and design-system primitives. The server projects pending payment,
action required, failed, active, scheduled, expired, suspended and cancelled
states. The browser never treats redirect parameters as payment confirmation.

The additive payment projection exposes the latest persisted attempt status
separately from the intent and subscription states. A failed new attempt does
not relabel a confirmed active subscription. A still-processing intent is
described as awaiting a payment update, with an explicit failed-attempt
explanation when applicable. This is read projection only; R24 remains the
payment state authority.

The screen shows purchased version and interval, confirmed period dates,
entitlement usage, scoped immutable history and available published versions.
It supports multiple subscriptions through the existing paginated list; the
selection persists in the URL. Query keys include the signed-in account.
Refresh, mount, reconnect and periodic revalidation retrieve server state.
Offline/stale data is labeled, and authorization or ownership failures hide
cached private content. A fresh browser login retrieves the same persisted
purchased terms and usage.

Arabic and English share the existing language context, semantic language and
direction attributes, logical spacing, accessible labels and visible keyboard
focus. Used/limit numbers have explicit left-to-right bidi isolation inside
Arabic text. Theme changes update feature text and backgrounds together so
intermediate color transitions cannot reduce contrast. A missing numeric
limit is not described as unlimited access when the
server denies the entitlement. Unapproved purchase/coupon/cancel/renew actions
are explained without presenting nonfunctional form controls. Money remains
exact in the contract; the UI does not guess a currency exponent from BIGINT.

## Composition, ownership and tests

[`OWNERSHIP.md`](OWNERSHIP.md) and
[`CR-001`](shared-change-requests/CR-001-integration.md) record each exact writer
and shared lease before edits. Backend, frontend and test-harness writers have
disjoint file lists. Root alone owns shared contract exports, module/outbox
composition, routes/profile entry, R24 reserved-key validation, CI and records.

The existing composition fence retains its missing/duplicate ledger and lost
export rejection cases. Only its whitespace-sensitive mutation fixture was
made robust to the formatter wrapping the import array; no assertion or
production validator was removed.

CI adds required `r31-subscriptions`, a separate real PostgreSQL/Redis and
Chromium job, to both CI and R18 aggregates. The normal API suite discovers the
R31 PostgreSQL spec. The generic browser configuration excludes only the new
dedicated R31 suite, which its required job runs with real authentication and
persisted API state. Existing suites, limits and security gates remain active.

The browser launcher verifies clean committed source by default, builds a fresh
private bundle, uses disposable database storage, requires exactly four named
journeys and twenty named screenshots (twelve AR/EN viewport images plus
eight theme/state images), checks zero skips/flaky/retries,
and cleans owned processes and private credentials. A local `--development`
run is explicitly diagnostic; CI refuses that flag. Public output contains a
fixed summary and the sanitized screenshot matrix, never OTPs, cookies, raw
traces or environment files.

Actual commands, counts, inspected visuals and remaining evidence boundaries
are recorded in [`ACCEPTANCE.md`](ACCEPTANCE.md). R29 sandbox and R30 protected
manual collection evidence remain a separate G3 integration requirement.
