# R34 — Reconciliation preflight; implementation blocked

## Identity and evidence boundary

- Observed documentation parent: `73a4a64a77844db7815466f47d8afdefb0b35c2f`.
- Observed source tree: `04fbecf5ff028f95136cdddca5aeb7bb7451e09f`.
- Approved G3 candidate/frozen source/tree: **absent**.
- Final documentation SHA/tree: recorded in the PR after publication.
- Exact paths and scope: [OWNERSHIP.md](OWNERSHIP.md).
- Machine-readable findings: [preflight.json](evidence/preflight.json).

Mode A, preflight documentation only. Implementation is **NOT_STARTED**;
acceptance is **INTEGRATION_PENDING / POLICY_BLOCKED / EXTERNAL_BLOCKED**.
No functional SOURCE_VERIFIED, SANDBOX_ACCEPTED, HOSTED_ACCEPTED or
RELEASE_ACCEPTED is asserted. No unmerged branch is imported.

## Findings from the current integrated tree

1. R29 is now owner-merged through PR #193, merge
   `794e9ce82978f94c97ad598e7d1f3708020c6fc1`, an ancestor of this observation.
   G3's prose saying all R29 paths are absent is stale. Its BLOCKED verdict
   remains correct: MoneyModule binds manual-only configuration, collection
   and refund adapters. AppModule does not mount Stripe ingress. The API
   manifest and lockfile contain no Stripe SDK dependency. Existing R29
   CR-001/002/003 specify dependency, parser, single-router and scheduler work.
2. R31's real activation participant is registered. Refund policy and
   consequences still use `UnavailableRefundPolicySource` and
   `UnavailableMoneyRefundConfirmationParticipant`. Approved immutable rules
   and a real consequence participant are prerequisites, not fixture defaults.
3. `MoneyReconciliationException` contains id, kind, subjectType, subjectId,
   detectedAt, resolvedAt and resolutionCode; uniqueness is kind/subject.
   It has no run/window/cursor, evidence digest, severity, last-checked time,
   worker lease or immutable resolution history. Its seven kinds do not
   directly represent every requested timing/unmatched/ambiguous category.
   Do not hide JSON in resolutionCode, overwrite detectedAt or silently change
   the frozen schema. A compatible companion design needs coordinator approval.
4. `MoneyManualSettlement` and `MoneyManualSettlementClaim` provide the
   authorized manual persistence boundary. Reading application tables alone
   is not independent settlement reconciliation. No authorized external
   statement source or real sandbox evidence was exercised here.
5. R33 binds `FINANCIAL_RECONCILIATION_STATUS` to an unavailable implementation.
   Its published actions are ACKNOWLEDGE and REQUEST_RECHECK; its detail
   exposes no executable actions. Severity/window provenance, resolve/reopen
   and actual Admin controls need coordinated contract/UI ownership.

## Required next implementation

The coordinator must accept the seven G3 categories on one integrated source,
publish the owner-reviewed acceptance, verify its merge and assign the full
frozen SHA plus R34's exact 24-file conditional plan. The observation above
is not an execution-base substitute. Resolve
[CR-001](shared-change-requests/CR-001-integration.md) before introducing an
interface or schema change.

After release, implement resumable rail/mode/account/currency windows, bounded
independent statement paging, overlap-safe durable dedupe, immutable evidence,
rate limits and expiring least-privilege credentials. Approved operator actions
need dry-run, unchanged payload digest, idempotency, reason and maker/checker
controls. Never create an automatic balancing entry or enable live rails.

## Required but unexecuted scenarios

Clean/missing/duplicate/mismatched confirmation, missing activation, partial/full
refund, timeout-after-success, delayed settlement, interruption/restart,
overlapping/repeated windows, concurrent workers, unauthorized actions and
notification dedupe are NOT RUN. Real Admin inspection and approved resolution
must preserve original evidence and verify audit/ledger invariants.

Matched/unmatched counts and unresolved severity are **NOT MEASURED**, never
zero by default. External unavailability must yield BLOCKED/EXCEPTION.
