# CR-002 — immutable financial receipt and review persistence

## Current disposition — 2026-10-23

The coordinator applied the nine-model receipt/review/refund schema and guarded migration under the exclusive root lease. See `../RUNTIME_OWNERSHIP.json`, `../IMPLEMENTATION.md` and `../ACCEPTANCE.md`.

## Historical request (preserved)

The following source observation/request predates authorized runtime work. Its blocked/unapplied status is historical, not the current disposition above.

Status: **REQUESTED / UNAPPLIED / G2_BLOCKED**. Runtime: **NOT_IMPLEMENTED**.
This is a coordinator integration request, not a schema lease or migration.
Source inspected: `96e92825f9b65cf124317f43b55ce42fc97f5b49`; source tree:
`68f4e926eabeb37bb70382c62b75272cf67bd02c`. Approved execution source/tree and
runtime migration writer remain unassigned.

## Existing authority and observed gap

`packages/database/prisma/schema.prisma` already owns `MediaAsset`, immutable
money obligations/bindings, `MoneyExternalEvent`, `MoneyPaymentConfirmation`,
refund reservations and ledger references. `MediaAssetPurpose` currently has
only `REQUEST_ATTACHMENT`; a generic restricted asset is not a financial receipt.
There is no R30 instruction version, receipt revision, inspected review or
independent deposit claim model. `MoneyPaymentConfirmation.receiptMediaAssetId`
is nullable and is not unique. Its presence alone cannot prevent receipt reuse
on a second obligation.

`MoneyExternalEvent` is unique by `(adapterId, mode, accountReference,
externalEventId)`. In
`apps/api/src/modules/money/application/money-command.service.ts`,
`processExternalEvent` separately derives economic confirmation identity from
`[adapterId, mode, accountReference, externalConfirmationId]` and delegates to
`SubscriptionActivationService.confirmAndActivate`. The confirmation model is
unique by `(source, externalConfirmationId)` and by payment intent. Preserve
these authorities and their different delivery/economic identities. Making
`externalConfirmationId` unique on the inbox event table would incorrectly
reject distinct valid deliveries of the same economic confirmation.

`MoneyIntentBinding.configVersion` exists. `requireConfiguredBinding` currently
resolves configuration by `{ planVersionId, method }` and compares every binding
field, including the version. A new current instruction version can therefore
make an earlier binding unavailable; the current port does not establish a
policy for honoring older instructions. CR-004 requests the bounded integration
decision instead of changing old recipients in place.

## Exact shared paths requested

| Path                                                                                   | Requested change                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/database/prisma/schema.prisma`                                               | Add the financial purpose, R30 persistence described below, corresponding relation fields and narrowly named audit event values. Preserve all existing financial models and constraints. |
| `packages/database/prisma/migrations/20261022120000_r30_manual_receipts/migration.sql` | Proposed new forward migration; no SQL exists or was applied in this preparation.                                                                                                        |
| `docs/production-readiness/baseline/MODEL_MIGRATION_INDEX.json`                        | Register the reviewed models, raw SQL constraints/triggers and migration after schema integration.                                                                                       |

The migration name is a proposed October 22 name, not reserved execution order.
The coordinator must revalidate its uniqueness and ordering against the accepted
G2 tree and other Wave 3 migrations before authoring SQL. There is one serialized
schema/migration writer. Permission definitions belong to CR-003, with no role
or user grants; no package version or lockfile change is requested.

## Minimal proposed persistence

These model names and invariants are reviewable proposals, not existing schema.
The coordinator may consolidate a representation only if every invariant remains
expressible and tested; do not introduce a second payment or ledger authority.

| Proposed authority                    | Required fields and constraints                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MediaAssetPurpose.FINANCIAL_RECEIPT` | Financial assets are `RESTRICTED`, belong to the obligation owner, and cannot simultaneously have identity-case, pending identity-document or request-attachment associations. Purpose and intent association are fixed at reservation, before bytes arrive.                                                                                                                                                                                                                 |
| `MoneyManualInstructionVersion`       | Immutable method, adapter/mode/account identity, configuration version, currency, authorized market and recipient instructions, validity and policy reference. No invented merchant data or default market/currency. A new version is a new row; an existing obligation references its original version.                                                                                                                                                                     |
| `MoneyManualReceiptVersion`           | Intent FK, unique media asset FK, positive monotonically allocated revision, predecessor and submission facts. Unique `(paymentIntentId, revision)`; a predecessor belongs to the same intent, is older, and cannot form a cycle. Replacement creates a new reserved asset/version, never changes the prior bytes or moves a receipt to another intent.                                                                                                                      |
| `MoneyManualReview`                   | One current cursor per intent: current receipt revision, monotonic state/version, and an optional pending external-event FK. It also owns bounded recovery scheduling (`nextAttemptAt`, attempt count, claim token and lease expiry); these operational fields are mutable, separately from history.                                                                                                                                                                         |
| `MoneyManualReviewDecision`           | Append-only pending candidates and final approval/rejection/correction facts, with decision identity, reviewer, inspected receipt revision/hash provenance, policy version, expected review version, event correlation and idempotency digest. Provider-visible reason and internal reviewer note are separate fields with separate projections. An earlier candidate is not edited into an approval.                                                                        |
| `MoneyManualSettlement`               | Independently permitted evidence of incoming funds: adapter/mode/account scope, canonical external deposit reference, original protected reference, exact minor-unit amount/currency, authoritative occurrence time, evidence source, recorder and applicable policy version. A receipt image/hash or a fresh UUID is not a deposit reference. Corrections retain history rather than rewriting a consumed economic identity.                                                |
| `MoneyManualSettlementClaim`          | One economic deposit may settle at most one obligation. Unique scoped canonical identity, settlement FK, intent FK and final decision linkage. Create the final claim inside the CR-004 activation transaction; a pending candidate may reference a settlement but does not consume this claim. The intent supplies the subsequent confirmation association, so the pre-activation callback need not invent a not-yet-created confirmation ID.                               |
| `MoneyManualRefundOperation`          | Correlate the existing R24/R32 refund, original confirmation, immutable provider idempotency key and external operation ID. Record operator-reviewed dispatch and independently confirmed return as separate protected facts. Preserve uncertain outcomes and observation history; dispatch is not success. Any single-assignment terminal evidence is immutable, and action history is append-only. Do not duplicate the existing refund reservation or compensation model. |

Use existing exact money representation (`BigInt` minor units and currency) and
restricting FKs. The server chooses amount, recipient, currency, expiry and
instruction version; browser input cannot replace them. Enforce same-intent
receipt ownership and financial purpose in the database as well as the service.
Where Prisma cannot express a cross-row or immutable-history invariant, record
the narrowly scoped SQL constraint/constraint trigger in the migration index
and exercise it through direct SQL, not only controller validation. Finalized
object key, size, detected type and digest cannot be replaced after completion;
purpose and intent association cannot change even before completion.

Audit enum additions proposed for this migration are
`MONEY_RECEIPT_UPLOADED`, `MONEY_RECEIPT_SCANNED`, `MONEY_RECEIPT_VIEWED`,
`MONEY_MANUAL_REVIEW_DECIDED` and `MONEY_MANUAL_REFUND_RECORDED`.
CR-003 limits their metadata. Existing R24 command and ledger audit events remain
authoritative for their existing actions.

## Policy and lifecycle boundaries

- Reference normalization must be approved for each method and account scope.
  A hash match is a duplicate-risk signal, never proof of payment. No fuzzy or
  global reference matching may silently merge unrelated deposits.
- Preserve a unique asset-to-intent association and refuse a historical approved
  receipt for another obligation. Decisions about identical bytes uploaded as a
  different asset require explicit policy; do not treat their new asset ID as a
  new economic payment.
- Keep obligation expiry, upload reservation expiry and the time funds arrived
  distinct. Review after expiry of an on-time deposit and a genuinely late
  deposit require explicit approved handling; there is no automatic extension
  or arbitrary grace period.
- R30 does not adopt identity-document retention periods. Financial retention,
  holds, cancellation/abandonment and erasure authority require owner policy.
  Missing policy keeps the relevant method unavailable; do not infer indefinite
  lawful retention or enable identity cleanup of financial evidence.
- Do not backfill historical restricted identity assets as receipts. Do not
  cascade-delete financial history, reset a database or rewrite ledger rows.

## Required verification after integration

The future dedicated tests are
`apps/api/test/integration/r30-manual-payments/r30-receipt-storage.integration.spec.ts`,
`r30-review-lifecycle.integration.spec.ts`,
`r30-review-concurrency.integration.spec.ts` and
`r30-manual-refund.integration.spec.ts` in that same directory. Their shared
HTTP/environment fixture is `r30-http.fixture.ts`. These paths are proposed in
`../PROPOSED_OWNERSHIP.json`; none of these tests was created or run here.

Use a disposable real PostgreSQL database to verify fresh and populated forward
migration, Prisma validation/generation, drift, preservation of pre-existing
raw constraints and repeat seed behavior. Direct-SQL negative tests must reject
cross-intent reuse, non-financial or public associations, mutable finalized
bytes/purpose, invalid predecessor linkage and duplicate economic claims.
Race two reviewers and two obligations against one deposit; verify at most one
committed claim/payment, with no partial decision, ledger posting, period or
notice. Verify rollback after each transaction participant, immutable correction
history and recovery of a received candidate after process failure. Refund tests
must keep unconfirmed transfers unresolved and preserve the original provider
key. Constraint violations must become safe domain conflicts, not raw SQL.

Rollback is a reviewed forward repair or disablement of the manual method.
Financial evidence, confirmations and posted ledger history are retained.
Destructive down migrations or synthetic reverse entries are not authorized.

## Acceptance of this request

G2 acceptance, exact serialized ownership, approved policy and executable
schema/contract integration remain prerequisites. This document establishes
neither a migrated database nor a passing runtime test. CR-003 supplies evidence
isolation; CR-004 supplies final approval atomicity and recovery; CR-005 supplies
the published DTOs and UI projections.
