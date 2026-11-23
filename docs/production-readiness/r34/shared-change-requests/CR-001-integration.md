# R34 CR-001 — Remaining integration after merged PR #198

Status: **FOUNDATION REQUESTS SATISFIED IN MERGED SOURCE; REMAINING REQUESTS
NOT APPLIED. NO SHARED-FILE LEASE GRANTED.**

Inspection source: `c9de08d07b12871db8801fb9662b14de83a2c391`.
This update supersedes the earlier preflight request at
`d634bfe66408c0f990e33713b7b0a83a983da51f`. It does not authorize R34 to
start before accepted, separately verified G3 publication and exact assignment.

## Requests already satisfied by #198

| Earlier request                                                    | Current source                                                                                                                |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Stripe SDK/dependency pin                                          | API `stripe` 23.0.1 and web `@stripe/stripe-js` 10.1.0 are installed through existing manifests/lockfile.                     |
| Bounded raw body, ingress, single rail router and inbox scheduling | Existing AppModule/runtime modules, request-body parser and MoneyModule compose the actual R29/manual implementations.        |
| Purchase surface                                                   | My Plan renders StripePlanPurchase and uses the private exact-attempt session route.                                          |
| Concrete refund policy and consequence bindings                    | MoneyModule selects ApprovedRefundPolicySource and ApprovedRefundParticipant. Explicit approved inputs still remain required. |
| Durable window/run/evidence/history schema                         | Five additive reconciliation models and forward migration `20261024120000_g3_financial_integration/migration.sql` exist.      |
| RESOLVE/REOPEN, dry-run and evidence payload types                 | Shared financial-operations contracts define `hsm.reconciliation.v2` action request/result/provenance.                        |

Do not reimplement these authorities, reinstall another SDK or invent a second
reconciliation migration. The old request to replace an absent-R29 gate blocker
is also obsolete: the current manifest has an external-sandbox-unaccepted blocker.
Source presence and policy/provider acceptance remain distinct.

## G3 handoff that still blocks implementation

The coordinator-owned paths remain untouched:

- `docs/production-readiness/post-r18/gates/g3/SOURCE_MANIFEST.json`
- `docs/production-readiness/post-r18/waves/wave-04.plan.json`
- `docs/production-readiness/post-r18/SPRINT_REGISTRY.json`
- `docs/production-readiness/post-r18/ACTIVE_STATUS.md`

Minimal requested changes are evidence-derived publication and lane assignment,
not changing BLOCKED to ACCEPTED from merge/CI alone. Collect the seven actual
G3 categories on one source, supply the approved sandbox plan/refund inputs,
inspect external/browser/process-recovery evidence, and publish the separate
owner-reviewed acceptance record. Verify its merge before freezing the full
source/tree and assigning R34. Correct ACTIVE_STATUS's historical unmerged-R29
wording as a coordinator-owned narrative update without removing the real holds.

Use the existing [G3 runbook](../../post-r18/gates/g3/SANDBOX_RUNBOOK.md).
The actual release guard remains:

```sh
node .github/scripts/g3-record.mjs --check
node .github/scripts/g3-record.mjs --ready R34
```

The first validates record consistency; the second must succeed before R34 code.
No new credential, account grant, commercial choice or merge authority is inferred.

## Exact remaining shared-file requests after G3

The coordinator authors each minimal patch serially or records an explicit
single-writer lease. Paths named below are not this documentation session's
allowlist. Proposed new test files must be included explicitly in that lease.

| Exact path(s)                                                                                                                                                                                                                                  | Minimal requested patch and reason                                                                                                                                                                                                                                                                    | Required verification                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/money/adapters/stripe/stripe-sdk.ts`; `apps/api/src/modules/money/adapters/stripe/stripe-sdk.spec.ts`                                                                                                                    | If approved as the authority, add a bounded read-only independent statement/paging port through the existing official client. Current API has no settlement/event/balance-transaction paging. Approve the concrete source and schema before adding methods; do not create an unrestricted second SDK. | Test account/mode/expiry refusal, bounded windows/pages/cursors, repeated pages, rate limits, provider outages and genuine missed-webhook recovery; query the independent source. |
| `packages/contracts/src/money/financial-operations.ts`                                                                                                                                                                                         | Add an approved backwards-compatible detail/page response carrying existing V2 provenance. Reuse V2 action request/result types; current V1 responses do not expose the new provenance.                                                                                                               | Type compatibility, exact integer/currency serialization, bounded/redacted evidence and unchanged-action payload tests.                                                           |
| `apps/api/src/modules/money/reporting/financial-reporting.module.ts`; `apps/api/src/modules/money/reporting/financial-reporting.module.spec.ts`                                                                                                | Bind FINANCIAL_RECONCILIATION_STATUS to the owned module's exported run reader after it exists, without a dependency cycle.                                                                                                                                                                           | DI registration, no duplicate authority, correct NOT_RUN/UNAVAILABLE/FAILED/AVAILABLE distinction.                                                                                |
| `apps/api/src/modules/money/reporting/financial-report.service.ts`; `apps/api/src/modules/money/reporting/financial-report.service.spec.ts`                                                                                                    | Project actual case/window/revision/severity/evidence data and permission-derived action capabilities. Current allowedActions is empty.                                                                                                                                                               | Read permissions, unavailable/empty/partial state, pagination, redaction and fresh entitlement/permission changes.                                                                |
| `apps/web/src/app/features/financial-operations/financial-operations.api.ts`; `apps/web/src/app/features/financial-operations/financial-operations.api.test.ts`                                                                                | Add typed V2 dry-run/execute mutation and targeted private-query revalidation after server routes exist.                                                                                                                                                                                              | Stale revision, changed hash, double submit, cancellation and unauthorized action handling.                                                                                       |
| `apps/web/src/app/features/financial-operations/FinancialOperationsView.tsx`; `apps/web/src/app/features/financial-operations/FinancialOperationsView.test.tsx`; `apps/web/src/app/features/financial-operations/financial-operations.copy.ts` | Render server-authorized dry-run, separate checker, resolve/reopen, reason and unchanged-payload confirmation in AR/EN. Keep unknown/unavailable outcomes truthful.                                                                                                                                   | Actual Admin route, API/DB persistence, maker/checker and audit/ledger invariants; RTL, required widths, zoom and keyboard review.                                                |
| `apps/api/src/app.module.ts`; `apps/api/src/app.module.spec.ts`                                                                                                                                                                                | Mount exactly one reconciliation module/handler composition after its owned exports exist. Scheduler registration remains coordinator-owned.                                                                                                                                                          | Registered worker discovery, disabled-live behavior, restart/lease/fencing and post-commit outbox dedupe.                                                                         |
| `.github/workflows/ci.yml`                                                                                                                                                                                                                     | Register the already planned isolated R34 service and browser suites and artifact capture. Preserve all existing jobs, security checks and budgets.                                                                                                                                                   | Final-head PostgreSQL/Redis/storage/browser/security/CodeQL evidence with actual failure/skip counts and inspected screenshots.                                                   |

R34's owned controller/module/service/outbox files and dedicated integration/
browser suites remain in the existing conditional 24-file wave plan. Test
sources and contract doubles do not establish real independent settlement.
No new dependency or base migration is requested by this audit. Any later
proven schema gap requires a separate exact migration request, serialized
ownership, drift/rehearsal checks and PostgreSQL constraint/concurrency evidence.

## Acceptance of the future integration

Required cases include clean reconciliation, delayed/unavailable statements,
duplicates and overlap, mismatch classification, interruption/restart and
concurrent fencing, partial/full/ambiguous refunds, unchanged dry-run hashes,
unauthorized/stale/self-checker actions, reopen/resolve with original evidence,
single activation, no over-refund and notification dedupe. Report actual
matched/unmatched and unresolved severity counts. Preserve R15/R16/R18 holds,
live-off defaults and the rule against unapproved automatic adjustments.
