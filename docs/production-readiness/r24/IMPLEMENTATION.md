# R24 — Money application API and module wiring

**Evidence state:** IMPLEMENTED / SOURCE_VERIFIED; external integration and published-head acceptance remain pending. Actual local results, including the initial full-suite failure and focused correction, are recorded in ACCEPTANCE.md.  
**Sprint:** R24, Wave 2, lane 1; hard dependencies R19, R22 and R23.  
**Branch:** `feat/r24-money-api-integration`.  
**PR:** Draft required; publication URL, containing commit/tree and final CI/CodeQL run IDs are maintained in the PR body after publication.  
**Decision:** No sprint/wave acceptance, merge, deployment, account grant or live-money activation is asserted.

## Source identity

| Identity                                         | Full value                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| Frozen G1 runtime source                         | `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`                              |
| Frozen G1 runtime tree                           | `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`                              |
| Owner-merged G1 acceptance record                | `0568739096ceeaf0cfc79034626886e258fe4328`                              |
| Execution start / publication overlay            | `07c8e584c684111bfc80995c7efb0144cfb6161b`                              |
| Ownership checkpoint, before runtime edits       | `60df8018ea9c76b1cda1c322fb279c7b9d7fde93`                              |
| Already owner-merged develop integrated into R24 | `21089a5065169b78bea5e711a4839e1a467531dc`                              |
| Normal merge on the assigned R24 branch          | `65b2a0e59604931a4b8b87acb971c71afaaf9a74`                              |
| Normal-merge tree, before the R24 implementation | `bf13f28e3c7c21aa6b9f5d418ad2e0ea92a0fb09`                              |
| Final implementation/source commit               | Maintained in the PR body after publication                             |
| Final source tree                                | Maintained in the PR body after publication                             |
| Final PR head / CI run / artifact identifiers    | Maintained in the PR body after publication; no CI success claimed here |

The normal merge has parents `60df8018ea9c76b1cda1c322fb279c7b9d7fde93` and `21089a5065169b78bea5e711a4839e1a467531dc`. It preserves the accepted R26/R27 source already merged by the owner. It does not change the original frozen G1 or execution-start identity and imports no unmerged R25 source. The worktree remains `/workspace/scratch/3c602a5e36ee/homeservicemarketplace-r24`. The merge tree above predates the R24 implementation. Exact source-file hashes and local artifact hashes are recorded in SOURCE_MANIFEST.json; the containing commit/tree and final-head CI are recorded externally in the PR body to avoid a self-referential commit, as required by the repository PR template.

The exact authority is recorded in [OWNERSHIP.md](OWNERSHIP.md), [CR-001](shared-change-requests/CR-001-integration.md), the [wave plan](../post-r18/waves/wave-02.plan.json), and [sprint registry](../post-r18/SPRINT_REGISTRY.json). The coordinator owns [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) and the acceptance decision. [ACCEPTANCE.md](ACCEPTANCE.md) records executed results and remaining published-head/external evidence.

## Problem and implemented boundary

R19 supplied the accepted money contracts, immutable subscription-payment domain/schema and ledger authority. R24 needed one application composition boundary, authorized HTTP operations, durable orchestration around future adapters, and safe read models. Mounting a module or returning a network response must not establish payment confirmation or subscription activation by itself.

`AppModule` imports `MoneyModule` once. `MoneyModule` imports the existing `LedgerModule` once and reuses R19 pricing, confirmation, period, coupon and outbox behavior. The module also composes the existing authentication, authorization and audit modules. The topology tests retain SupportModule and the previous ledger invariants; they now inspect the complete AppModule → MoneyModule → LedgerModule relationship.

The application exposes URI version `v1` under `/v1/money` and consumes the published `@homeservicemarketplace/contracts` surface. Existing financial contracts retain `hsm.money.v1`; additive API contracts describe purchase selectors, command receipts, refund requests and separate transport knowledge. There is no package-relative bypass of the published contracts package and no second ledger implementation.

## HTTP and read contracts

| Boundary                | Operations                                                                                              | Authority                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Provider purchase       | Server-priced quote, create intent, start or resume attempt, cancel an eligible intent                  | Provider role plus fresh `money:purchase:self`; current user resolves the provider and owned obligation |
| Provider reads          | Intent list/detail, attempt status, subscription list/detail, grouped usage, refund-request list/detail | Provider role plus fresh `money:read:self`; all resources remain ownership-scoped                       |
| Provider refund request | Request review of a positive amount against an owned payment confirmation                               | Fresh `money:refund:request:self`; the request starts `PENDING_POLICY`                                  |
| Review reads            | Intent/refund-request lists, ledger financial projection, reconciliation exceptions                     | Admin role plus fresh `money:review:read`                                                               |
| Receipt review          | Accept restricted receipt evidence through the configured R30 port                                      | Fresh `money:receipt:review`, eligible owned receipt and required transaction participant               |
| Refund review           | Reserve through policy; dispatch or query through transport                                             | Fresh `money:refund:review`; configured R32 policy and R29/R30 transport boundaries                     |

Every HTTP mutation uses the existing cookie authentication, CSRF and RBAC guards, the repository error envelope, the current authenticated user and an `Idempotency-Key`. The existing PermissionsGuard classifies `money:` as sensitive and resolves the current user's database grants on each request, for revocation and regrant alike. Services repeat fresh permission, active-account, current provider/admin base-role and ownership checks, including before replay and manual-event processing. A stale JWT role or a separate capability role cannot replace current base-role membership. Purchase DTOs accept plan version, method and optional coupon selectors; the server supplies price, currency, provider, mode and ledger accounts. Extra raw amount, actor or account authority is rejected.

Money amounts use canonical decimal-string minor units and the accepted BIGINT-range parser. Command/body identifiers are limited to 64 ASCII letters/digits/underscore/hyphen; adapter IDs to 80 characters; configuration and refund-policy versions to 100; external references to 200; controlled reason codes to 2–64. A supplied number, decimal, exponent, sign, leading zero or out-of-range money value cannot become a canonical amount through JavaScript-number coercion. Purchase normalization explicitly projects required selectors and a present coupon before fingerprinting, so class-transformed optional fields with `undefined` cannot enter canonical JSON.

Lists default to 20 items and cap at 50. Keyset cursors bind the resource, current owner/reviewer and currency, and the service verifies the cursor anchor against the authorized database scope. Usage pagination groups whole entitlement keys instead of splitting a key's count across pages. Attempt plus dispatch status and financial aggregates use consistent transaction snapshots. Provider wires omit private command envelopes, hashes, account bindings, claim tokens and raw transport observations.

The financial projection derives separate currency totals from posted ledger transactions linked to confirmed subscription payments and successful refund compensations. It does not sum currencies or include booking estimates/provider withdrawable earnings. The exception view exposes existing R19 reconciliation records; it does not invent a reconciliation processor. Exception currency filtering is explicitly rejected because the accepted heterogeneous exception records have no currency column.

## Durable command and adapter protocol

`MoneyCommand` freezes the actor, action, contract version, canonical request fingerprint, immutable server authority and original response. A transaction-scoped advisory lock serializes the global command key. Cross-actor, cross-action or changed-request reuse conflicts. Fresh authorization precedes both execution and immutable replay. User commands cannot occupy the reserved `r24_event_`, `r24_process_` or `r24_refund_result_` internal key namespaces.

Collection work commits the attempt, immutable binding, stable provider idempotency key and dispatch before network transport. The adapter returns `PENDING`, `UNKNOWN`, `SUCCEEDED` or `FAILED`; transport success alone leaves financial confirmation pending. Timeouts and invalid responses preserve uncertainty. Resume reuses the same attempt and provider key. A bounded claim/lease and fenced observation update coordinate concurrent transport attempts.

Validated external evidence commits as a durable `RECEIVED` event before financial processing. The event is bound to the actual intent, attempt, adapter, account, mode, currency, amount and known external operation ID. Stripe requires `PROVIDER_WEBHOOK`; the current SHAM_CASH, SYRIATEL_CASH and CASH_OFFICE methods require `MANUAL_REVIEW`, restricted owned receipt metadata and current reviewer authority. Browser clients have no public confirmation/result-ingestion route.

The financial transaction calls accepted R19 confirmation, posts the ledger, creates its existing subscription period/coupon effect and outbox intent, invokes the configured activation participant with the caller's `PrismaTx`, and records processed evidence and audit together. The R31 participant receives the immutable plan reference and existing `subscriptionPeriodId`; it must enlist all effects in that transaction and deduplicate by that period. Missing or failed participation rolls back these effects and leaves the separate received event available for retry.

Delivery IDs and economic confirmation IDs have separate dedupe identities. Distinct deliveries of one scoped confirmation reuse one R19 activation key. A replay may skip the participant only when another committed, processed R24 event proves matching confirmation, subscription, period and ledger references. A pre-existing R19 result without that R24 participation proof fails closed for reconciliation.

Refund requests do not reserve or complete a refund. R32 policy must authorize a named policy version inside the caller transaction. Reservation locks the original confirmation and includes reserved, dispatched and successful refunds in the cumulative paid-amount cap. Unknown transport outcomes retain that reservation. R29/R30 transport uses a stable provider key outside the transaction.

A normalized terminal refund observation and external operation ID become durable before local compensation. Application logic and the SQL guard prevent terminal evidence from being replaced by a late pending response or timeout. Recovery can consume that saved evidence while the current adapter/configuration is unavailable, while retaining fresh review authority and immutable binding checks. Successful compensation reverses the original two-account posting for the refunded amount in the same currency. Ledger, refund success and audit commit together; a failed local transaction retains evidence for retry.

## Frozen internal ports and downstream owners

| Port/token                              | Frozen responsibility                                                                                       | Downstream owner / current default                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `MONEY_CONFIGURATION` / `MONEY_CATALOG` | Resolve immutable server configuration; read accepted R19 published plans/coupons in the caller transaction | Configuration unavailable by default; catalog reuses R19 |
| `MONEY_COLLECTION_ADAPTER`              | Create/resume one collection identity; validate and normalize external evidence                             | R29; unavailable by default                              |
| `MONEY_RECEIPT_ACCEPTANCE`              | Authorized manual receipt acceptance in the caller transaction                                              | R30; unavailable by default                              |
| `MONEY_ACTIVATION_PARTICIPANT`          | Apply effects to the existing R19 period in the caller transaction                                          | R31; unavailable by default                              |
| `MONEY_REFUND_POLICY`                   | Approve refund eligibility/consequences under a named policy before reservation                             | R32; unavailable by default                              |
| `MONEY_REFUND_ADAPTER`                  | Submit/query the reserved refund and normalize scope/finality                                               | R29/R30; unavailable by default                          |
| `MONEY_FINANCE_READ`                    | Freshly authorized ledger-only financial and exception projection                                           | Implemented by `MoneyQueryService`                       |

The test overrides are explicitly contract components. They certify neither a real rail's sandbox behavior nor hosted acceptance, SMTP delivery, scanning or R31/R32 policy completeness. There is no real vendor integration selected in this change. Sample request/response/error/event shapes are in [fixtures/api-v1.json](fixtures/api-v1.json); synthetic XTS/XXX examples select no supported currency, market, price, FX, tax or payout policy.

## Additive persistence and permissions

The single migration `20261017163000_r24_money_api_orchestration` adds these tables to the accepted schema:

| Model                | Durable authority                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `MoneyCommand`       | Immutable canonical request/response and actor/action identity                                          |
| `MoneyIntentBinding` | Immutable obligation-to-adapter/mode/account/configuration binding                                      |
| `MoneyExternalEvent` | Normalized immutable evidence; retryable received state and immutable processed result                  |
| `MoneyRefundRequest` | Owned request, policy decision/version and optional authorized reservation reference                    |
| `MoneyDispatch`      | Collection/refund subject, stable provider key, claim/lease, external operation and durable observation |

Checks and triggers cover explicit non-null state requirements, identity immutability, evidence source fields, owner/amount binding, immutable terminal evidence and deferred correspondence between terminal dispatch and financial outcome. Referencing command rows can be completed within the same transaction; financial history is not deleted or rewritten. The baseline model/migration reference inventory includes the actual five new model tokens and the Permission reference.

Exactly six capability definitions are registered: `money:purchase:self`, `money:read:self`, `money:refund:request:self`, `money:review:read`, `money:receipt:review`, and `money:refund:review`. The migration grants no RolePermission or UserRole. The seed upserts a separate ungranted money catalog so the existing automatic admin mapping cannot acquire these capabilities. R19's obsolete zero-definition assertion becomes the exact six definitions plus zero automatic grants; its remaining history, ledger, no-backfill and booking-revenue invariants stay in place.

R24 registers bounded audit events for accepted commands, processed external evidence and recorded refund outcomes, adding only allowlisted identifiers to the existing audit service. Raw provider payloads, restricted receipt bodies, credentials and private binding data remain outside audit metadata. No new environment key, dependency, lockfile or workflow change is required or included.

## Exact ownership and changed-path scope

The change contains 39 exact paths: 22 approved lane files, 15 shared files under three leases, and two coordinator-owned central records. The complete inventory and source-file digests are in SOURCE_MANIFEST.json. The final containing commit/tree is maintained in the PR body.

```text
apps/api/src/modules/money/api/money.controller.spec.ts
apps/api/src/modules/money/api/money.controller.ts
apps/api/src/modules/money/application/money-command.service.spec.ts
apps/api/src/modules/money/application/money-command.service.ts
apps/api/src/modules/money/application/money-query.service.spec.ts
apps/api/src/modules/money/application/money-query.service.ts
apps/api/src/modules/money/money.module.spec.ts
apps/api/src/modules/money/money.module.ts
apps/api/src/modules/money/ports/activation.port.ts
apps/api/src/modules/money/ports/collection.port.ts
apps/api/src/modules/money/ports/finance-read.port.ts
apps/api/src/modules/money/ports/refund.port.ts
apps/api/test/integration/r24-money-api.integration.spec.ts
apps/api/test/support/r24-money-http.fixture.ts
docs/production-readiness/r24/ACCEPTANCE.md
docs/production-readiness/r24/IMPLEMENTATION.md
docs/production-readiness/r24/OWNERSHIP.md
docs/production-readiness/r24/RISKS.md
docs/production-readiness/r24/ROLLBACK.md
docs/production-readiness/r24/SOURCE_MANIFEST.json
docs/production-readiness/r24/fixtures/api-v1.json
docs/production-readiness/r24/shared-change-requests/CR-001-integration.md
```

Three serialized coordinator leases contain these 15 exact shared paths, with bounded patches and expiry in CR-001. The original 12-path lease was followed by the PermissionsGuard/spec extension at `2026-10-17T16:36:36Z` and the seed-unit regression extension at `2026-10-17T16:48:10Z`. Each extension was recorded in both canonical records before its files were edited:

```text
packages/database/prisma/schema.prisma
packages/database/prisma/migrations/20261017163000_r24_money_api_orchestration/migration.sql
packages/database/src/seed.ts
packages/contracts/src/money/api-contracts.ts
packages/contracts/src/money/index.ts
apps/api/src/app.module.ts
apps/api/src/modules/iam/audit/audit.service.ts
apps/api/src/modules/iam/audit/audit.service.spec.ts
apps/api/src/modules/iam/authorization/guards/permissions.guard.ts
apps/api/src/modules/iam/authorization/guards/permissions.guard.spec.ts
apps/api/test/integration/r19-subscription-money.integration.spec.ts
apps/api/test/unit/seed-with-tx.spec.ts
apps/api/src/app.module.spec.ts
.github/scripts/merge-integrity.test.mjs
docs/production-readiness/baseline/MODEL_MIGRATION_INDEX.json
```

The coordinator separately owns the R24 objects in `wave-02.plan.json` and `SPRINT_REGISTRY.json`. Neither prefix ownership nor permission to edit another lane follows from this list. The lease expires at the earliest of R24 PR closure, the G2 decision or revocation.

## Review findings corrected before publication

| Original defect found during R24 review                                      | Source correction now inspected                                                              | Remaining evidence                                                                                           |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Different delivery IDs could strand one economic confirmation in `RECEIVED`  | Scoped economic activation key and prior processed R24 participation proof                   | Economic dedupe passed in the 56-case real-service run; published-head verification remains required         |
| Local compensation failure could lose a verified terminal refund observation | Durable observation before compensation, monotonic SQL/application guards and local recovery | Recovery/compensation cases passed in the real-service run; published-head verification remains required     |
| A normalized webhook could authorize a current manual method                 | Central method/source binding                                                                | Manual-method webhook rejection passed in the real-service run; published-head verification remains required |
| Service/DTO identifier and reason-code bounds differed from SQL              | Field-specific 80/100 bounds, 64-character IDs, 2–64 reason codes                            | Focused combined units supplied as 223/223; published-head verification remains required                     |

Independent source review also inspected fresh replay authorization, refund-cap locking, SQL NULL guards, immutable account/mode correlation and the seed's no-grant behavior. That review is source evidence only. Exact test commands, counts, failures/skips, runtime fingerprint and final CI/CodeQL links belong in [ACCEPTANCE.md](ACCEPTANCE.md). Residual policy/external dependencies are recorded in [RISKS.md](RISKS.md); recovery and reversion boundaries are in [ROLLBACK.md](ROLLBACK.md).

### Additional defects exposed by actual HTTP execution

The class-transformed purchase DTO initially retained an absent `couponCode` as `undefined`, causing canonical JSON to fail before configuration resolution. The service now constructs the canonical request explicitly. The focused component regression and real HTTP rerun exercise this corrected normalization.

A subsequent real-service run reported 51 of 55 cases passing and four failures involving current role/permission handling. JWT RolesGuard could retain a removed provider role while a separate capability role remained, and the ordinary PermissionsGuard cache could deny a restored money permission before the service's fresh check ran. The coordinator recorded the two-path lease extension before editing the existing PermissionsGuard/spec. Money permissions now use its existing fresh-user path; command/query services require a current nondeleted provider/admin role and an active account, including transaction-bound financial reads and manual-event reviewer checks. These changes were inspected in source. The expanded real-service rerun passed 56/56 cases, including provider/reviewer role revocation and explicit wallet/booking HTTP 200 regressions. The combined focused unit run passed 223/223 across seven suites. Prisma validation/generation, database/contracts/API typechecks and production builds, API lint, dependency audits and the full enabled API run have now completed; their actual outcomes and the remaining published-head gate are recorded in ACCEPTANCE.md. No cache flush, weakened assertion, global RolesGuard change or alternate authorization framework was introduced.

### Full-suite seed regression correction

The complete enabled API run executed 6,476 cases and reported 6,394 passed, one failed and 81 existing gated/pending cases across 340 passing suites, one failing suite and 13 gated suites. Its sole failure was the older `seedWithTx` unit assertion expecting 24 automatic admin grants. The approved six-definition ungranted money catalog correctly leaves 18 ordinary admin grants.

Before editing, the coordinator recorded the third exact lease for `apps/api/test/unit/seed-with-tx.spec.ts` at `2026-10-17T16:48:10Z`. The revised assertion explicitly requires all six money definitions with zero role grants, keeps `outbox:replay` ungranted, and preserves the ordinary admin mapping and two self grants for each end-user role. The focused seed unit rerun passed 10/10 with zero skips in 1.703 seconds. This correction changes test expectations, not runtime source or seed behavior. The initial full-run failure remains recorded; a zero-failure full run on the final published head is still required. A separate R22 worker-process run passed 3/3 with zero failures/skips in 6.149 seconds against the compiled API.
