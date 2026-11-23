# CR-001 — R33 additive reporting integration

Status: approved for serialized implementation by the continuing owner-delegated coordinator on 2026-10-23, after verified owner publication of G2 PR #183 and canonical R33 readiness. Exact leases are mirrored in the Wave 3 manifest, registry and R33 OWNERSHIP.md. Local source verification is recorded in ACCEPTANCE.md; combined-wave acceptance remains INTEGRATION_PENDING.

## Concrete minimal patches

| Exact path                                                      | Writer                | Minimal change and purpose                                                                                                                                                                                      |
| --------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/money/financial-operations.ts`          | `/root/reporting_api` | Add reporting/page/detail/provenance/capability and future reconciliation action wire types using the existing MoneyWire. Prior contracts remain unchanged.                                                     |
| `packages/contracts/src/money/index.ts`                         | `/root`               | Export the additive financial-operations contract through the existing published workspace package.                                                                                                             |
| `apps/api/src/app.module.ts`                                    | `/root`               | Import and mount FinancialReportingModule. It imports MoneyModule and composes the existing R24 query authority; no token replacement.                                                                          |
| `apps/web/src/app/routes.ts`                                    | `/root`               | Lazy guarded standalone `/admin/financial-operations` and `/provider/financial-history` routes. Own subscription history remains subject to fresh API permission/ownership checks and confers no work access.   |
| `apps/web/src/app/components/admin/AdminRouteContent.tsx`       | `/root`               | Add one bilingual link from existing booking financials to the separate subscription-money operations route.                                                                                                    |
| `apps/web/src/app/components/provider/screens/WalletScreen.tsx` | `/root`               | Add one bilingual link to provider subscription payment history; preserve booking estimates and disabled withdrawal control.                                                                                    |
| `apps/web/playwright.config.ts`                                 | `/root`               | Exclude only the dedicated R33 real-API spec from the mocked run; it must execute in its real-service CI step.                                                                                                  |
| `.github/workflows/ci.yml`                                      | `/root`               | Add explicit R33 browser execution/count validation and artifacts to the existing disposable Admin real-API job after its original tests. Preserve all existing checks, budgets, assertions, jobs and timeouts. |

The preceding coordination-only overlay and G2 publication verification are separately leased in OWNERSHIP.md; they record actual already completed owner actions. They do not refreeze G2 or release another lane.

## Verification

Frozen install; affected contracts/API/web formatting, lint, typecheck, unit and builds; real PostgreSQL fixtures with true posted ledger/attempt/refund records, stable pagination and bounded query counts; real API/browser guards, new login after permission changes, exact large-value/currency rendering, AR/EN/RTL/mobile/keyboard and inspected screenshots; CSV formula injection and redaction; negative reconciliation/settlement/unavailable-command states; current final-PR CI and official CodeQL. Actual executed commands/counts belong in ACCEPTANCE.md.

The same leased CI segment also runs the offline verifier's negative tests and checks exactly seven actual browser-read response documents. Raw response documents remain ephemeral; only synthetic screenshots and sanitized count summaries enter the R33 artifact. The original login budget expires naturally for 61 seconds between independent suites; its phase5-only reset helper is not invoked or modified.

## Consequences and integration boundaries

No dependency, package manager, root manifest, lockfile, Prisma schema or migration changes. No pricing/currency-scale, payout, identity, account grant or production rollout decision. Missing R30 receipt review, R31 My Plan, R32 refund commands and R34 reconciliation runtime remain server-declared unavailable. Coordinated hrefs remain null until those routes are accepted; no guessed successful links, peer imports or balancing adjustments. R34 receives additive list/detail/action contracts with empty current allowed actions, not an implemented reconciliation service.

R24's exact frozen ports and existing hsm.money.v1 contract meaning stay intact. Reports distinguish intent/attempt values from confirmed posted collections; grouped integer minor units are shown without inventing the unresolved currency scale. Pending-state and ledger snapshot times remain explicitly separate.

## Rollback

Remove the additive route/module imports and two entry links before removing the feature files. Retain prior money authority, migrations and immutable history. No data rollback, ledger rewrite, permission grant or live rail action is needed. Do not revert the valid G2 owner-publication fact to an unmerged state.
