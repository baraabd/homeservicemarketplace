# CR-005 — published manual-payment contracts and real routes

Status: **REQUESTED / UNAPPLIED / G2_BLOCKED**. Runtime: **NOT_IMPLEMENTED**.
Source inspected: `96e92825f9b65cf124317f43b55ce42fc97f5b49`, tree
`68f4e926eabeb37bb70382c62b75272cf67bd02c`. These are proposed coordinator
integrations. No shared contract, route or CI change is applied by this request.

## Exact shared paths requested

| Path                                                           | Minimal proposed integration                                                                                                                                                                                                |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/money/manual-payment-contracts.ts`     | New additive `hsm.money.v1` DTOs for method availability/instruction versions, immutable receipt history, provider-visible corrections, finance review and explicit unresolved refund observations.                         |
| `packages/contracts/src/money/index.ts`                        | Publish the new module through the existing money barrel. The root barrel already reaches money; no root barrel edit is requested.                                                                                          |
| `packages/contracts/src/money/api-contracts.ts`                | Add the reviewed `money:receipt:read` capability definition and narrowly required failure reasons. Preserve all existing capabilities, states and command semantics.                                                        |
| `apps/web/src/app/routes.ts`                                   | Add the explicit lazy provider route `/provider/subscription-payments/:paymentIntentId` in the existing authenticated shell, ahead of the provider catch-all. Keep onboarding, verification and eligibility routing intact. |
| `apps/web/src/app/components/admin/admin-routes.ts`            | Recognize only `/admin/financials/manual-payments` and `/admin/financials/manual-payments/:paymentIntentId` as explicit financial descendants. Unknown descendants still return not-found.                                  |
| `apps/web/src/app/components/admin/AdminRouteContent.tsx`      | Render the two lazy R30 pages for those route kinds, within the existing admin shell and async/error boundary. Preserve other sections and R27 lazy chart loading.                                                          |
| `apps/web/src/app/components/admin/AdminRoutes.test.tsx`       | Cover the explicit route inventory, correct identifiers, back navigation and unknown descendants.                                                                                                                           |
| `apps/web/src/app/components/admin/AdminRouteContent.test.tsx` | Assert each new route renders its intended page, with isolation from unrelated dashboards and safe failed chunk loading.                                                                                                    |
| `apps/web/src/app/App.router.test.tsx`                         | Verify authenticated provider/admin routing and refresh/deep-link behavior through the actual router.                                                                                                                       |
| `.github/workflows/ci.yml`                                     | Add the reviewed dedicated R30 typecheck and real-service/browser commands only after the implementation and isolated fixture exist. Preserve every existing gate and assertion.                                            |

These ten paths exactly match the CR-005 entry in `PROPOSED_OWNERSHIP.json`.
Permission registration belongs to CR-003 and uses
`UNGRANTED_MONEY_PERMISSIONS`, with no role or user grants. This request adds no
package dependency, changes no package-manager/Prisma version and does not
require a lockfile rewrite. R33 owns the surrounding financial dashboard;
`FinancialsSection.tsx` is neither an R30 implementation path nor an authority
for subscription revenue or provider-withdrawable funds.

## Contract and privacy rules

Use type-only imports from the published workspace package in browser code.
Do not bypass the package with relative source imports or introduce another
financial state machine. Exact amounts use existing `MoneyWire` decimal strings
for minor units and a currency code. Never coerce a large amount to `number` or
assume `/ 100`: display requires the approved currency/scale policy and preserves
the exact server obligation. The browser cannot select a different recipient,
amount, expiry, market or instruction version for an existing obligation.

Separate provider and finance projections. Provider data includes the selected
method's actual availability, immutable authorized instructions, upload/scan and
review state, receipt revision history and provider-visible decision reasons.
It excludes internal notes, protected deposit evidence, storage keys, scanner
internals, reviewer credentials and unrelated providers. Finance projections
expose only information permitted for the current reviewer and purpose. A
client-side role check cannot substitute for a fresh server permission check.

Transport acceptance, a persisted pending decision and an uploaded/CLEAN receipt
remain distinct from economic confirmation. The UI shows success only from the
committed existing R24 payment/activation state. A stale revision, revoked
permission, expired policy or unresolved deposit produces the actual safe domain
state; it does not optimistically turn a subscription ACTIVE. Keep command
idempotency identity through retry and reload. UNKNOWN refund observations stay
unresolved; a ledger compensation is not proof of transferred funds.

## Owned feature behavior

The finite proposal includes 19 feature files under
`apps/web/src/app/features/manual-payments/`: a typed API client, AR/EN copy,
scoped stylesheet, five components, a receipt-preview hook, three pages and
seven unit-test files. The three pages implement provider instructions/history,
the finance queue and an individual review. All names are enumerated in the
proposal; this document grants no extra prefix-wide ownership.

Use existing authenticated request/CSRF/error infrastructure. Disable unavailable
methods with a useful localized reason; do not show fictional account numbers,
QRs, fees or confirmation messages. Correction and rejection reasons are
provider-visible fields, separately labeled from internal notes. Replacement
creates a new immutable revision and retains earlier approved/inspected
evidence. Queue filters/cursors and selections must not leak between accounts.

Fetch receipt bytes through the authenticated private API. Use a bounded blob
preview, revoke object URLs on asset changes, unmount, cancellation or logout,
and clear stale previews during a provider/reviewer switch. Never persist bytes,
deposit references or privileged review state in local/session storage, public
URLs, service-worker caches, analytics or notifications. The server establishes
byte integrity, `no-store`, authorization and audit before disclosure; a browser
preview alone establishes none of them.

Provide explicit labels, focus order, status announcements and errors associated
with their controls. Preserve keyboard access, readable mobile layouts, AR RTL
and EN LTR, logical CSS properties and copy-key parity. The approval action
must identify the inspected immutable revision and the independently verified
settlement candidate; no image-only one-click approval. Show concurrency
conflicts without discarding entered provider-visible text or silently applying
it to a different revision.

## Dedicated executable evidence after integration

The exact dedicated browser paths are:

- `apps/web/manual-payment-tests/fixtures.ts`
- `apps/web/manual-payment-tests/manual-payments.real-api.spec.ts`
- `apps/web/manual-payment-tests/tsconfig.json`
- `apps/web/playwright.r30.config.ts`

The existing general E2E typecheck does not automatically cover this new
directory. The coordinated CI must explicitly run:

```bash
pnpm --filter @homeservicemarketplace/web exec tsc --noEmit -p manual-payment-tests/tsconfig.json
pnpm --filter @homeservicemarketplace/web exec playwright test --config playwright.r30.config.ts
```

These commands are a future wiring request; the files do not yet exist and
these R30 checks were not run. Test actual router/API/private storage/ClamAV
services with synthetic receipts and explicitly labeled operator settlement
simulation. Cover provider A/B isolation, finance revocation, pending/failed
scan, replacement/reload/relogin, stale parallel review, immutable prior receipt,
delayed activation, server failures and UNKNOWN refunds. Inspect screenshots
from AR/EN, mobile and desktop, verify keyboard/focus, and retain only sanitized
screenshots and aggregate reports. Component doubles cannot establish these
journeys, hosted acceptance or real settlement.

## Rollback and acceptance

Disable new manual route/method availability through reviewed configuration;
preserve required access to existing obligations and protected history. Removing
a UI must never delete receipts, change ledger history or imply that a pending
refund failed. Acceptance requires approved G2 ownership, coordinated contracts
and runtime, all applicable checks, owner policy and the final exact-head CI.
Live acceptance additionally requires approved merchant setup and independent
authorized real settlement evidence.
