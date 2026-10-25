# R34 — Current reconciliation preflight after merged PR #198

**Mode A. R34 runtime implementation: NOT_STARTED.**
**Acceptance: INTEGRATION_PENDING / POLICY_BLOCKED / EXTERNAL_BLOCKED.**

## Exact source and evidence boundary

- Inspection base: `c9de08d07b12871db8801fb9662b14de83a2c391`.
- Inspection tree: `67136183b8a81de9773c2c6a3831441c320729c0`.
- G3 candidate/frozen source and tree: **null** in the canonical gate.
- Branch: `feat/r34-reconciliation-settlement`.
- Final documentation SHA/tree and final-head CI: recorded in the PR body.
- Scope: the seven files in [OWNERSHIP.md](OWNERSHIP.md).

PR #198 was merged at `2026-10-25T00:26:28Z`. Its merge is the inspection
base above. This update replaces stale R34 claims about missing prerequisites;
it does not turn source integration into gate acceptance. The earlier
preflight remains available in Git at
`d634bfe66408c0f990e33713b7b0a83a983da51f` and is referenced by
[preflight.json](evidence/preflight.json).

## Technical prerequisites now present

| Earlier prerequisite                        | Merged source now inspected                                                                                                           | Remaining qualification                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Stripe dependency and runtime composition   | `stripe` 23.0.1, `@stripe/stripe-js` 10.1.0, concrete collection/refund routers, raw-body ingress, runtime module and inbox scheduler | Installed source is not independent external payment evidence.                                     |
| Real purchase entry point                   | `MyPlanScreen` composes `StripePlanPurchase`; the private session controller binds the exact attempt                                  | The actual Payment Element browser matrix still needs approved sandbox execution.                  |
| Refund policy and subscription consequences | `ApprovedRefundPolicySource` and `ApprovedRefundParticipant` are bound in `MoneyModule`                                               | They require explicit currently valid immutable approved inputs; no commercial policy is inferred. |
| Durable reconciliation persistence          | Window, run, observation, case and decision models plus migration `20261024120000_g3_financial_integration`                           | These are reusable foundations, not an implemented R34 worker.                                     |
| Exception action vocabulary                 | `hsm.reconciliation.v2` request/result/provenance types and RESOLVE/REOPEN actions                                                    | Current response projections and executable operator routes do not yet consume them.               |

The additive persistence provides bounded cursor/revision/lease/fencing state,
scoped unique windows, overlap-safe observation identities, source completeness,
severity/last-check data and immutable decision history. It preserves the
original exception evidence and enforces distinct checker identity for resolve.
R34 must reuse it; a second schema authority or duplicate base migration is not
justified by this audit. Source paths and byte fingerprints are in preflight.json.

## Work that R34 actually still needs

1. Implement the owned reconciliation module and operational scripts after the
   start gate opens. Neither proposed module exists in this integrated source.
2. Compare an independent, authorized statement source with attempts, ledger,
   periods, refunds and settlements. The existing Stripe SDK boundary has no
   bounded settlement/event/balance-transaction paging port; approve that
   extension through the existing SDK owner before implementation.
3. Implement per-rail/mode/account/currency windows, bounded page/cursor validation,
   durable overlap dedupe, expiring credentials, rate limits, restart recovery
   and fenced concurrent workers using the already merged persistence.
4. Replace R33's unavailable run-status binding through coordinator integration.
   `FinancialReportingModule` still uses `UnavailableFinancialReconciliationStatus`.
   Its unavailable state and an empty exception list must never imply success.
5. Connect existing V2 provenance to an approved response shape. Current page/detail
   responses remain V1; declaring `FinancialReconciliationProvenanceV2` alone
   does not expose revision, severity, source window or original evidence digest.
6. Add the authorized dry-run/resolve/reopen workflow. Current exception details
   return `allowedActions: []`; the reporting controller and web client are read-only.
   Enforce unchanged payload hashes, revision, maker/checker, reason, idempotence
   and append-only history. A disagreement never creates an automatic balancing entry.

The exact remaining shared interfaces, files and tests are requested in
[CR-001](shared-change-requests/CR-001-integration.md). No request is an active lease.

## Start gate and coordinator handoff

The executed guard `node .github/scripts/g3-record.mjs --ready R34` exits 1:
`FAIL R34 is not authorized to start`. The canonical gate remains BLOCKED;
all seven mandatory evidence categories remain NOT_RUN, publication is
NOT_PREPARED and R34's exact session assignment is absent.

The [G3 runbook](../post-r18/gates/g3/SANDBOX_RUNBOOK.md) specifies the missing
inputs and execution: authorized expiring Stripe test configuration and authentic
webhook forwarding, an explicit approved immutable plan/refund policy, the actual
external lifecycle and Payment Element/browser/failure scenarios, and assembled
manual/activation/refund/outbox evidence on the same source. Successful existing
CI jobs do not supply the missing provider or policy authority.

After the evidence is complete, the coordinator must publish accepted G3, verify
the separately owner-merged acceptance record, freeze the tested full source/tree,
and assign the named R34 session with exact nonoverlapping paths. The existing
guard must then pass before implementation. No gate record is rewritten here.

## R34 scenario matrix awaiting implementation

| Group                      | Required observation after G3                                                                                                                       | Current evidence |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Independent reconciliation | Clean/missing/duplicate confirmations, missing activation, amount/currency mismatch, unmatched external reference, genuine missed webhook recovery  | NOT_RUN          |
| Resumption and concurrency | Delayed settlements, repeated/overlapping windows, duplicate pages, provider outage/rate limits, worker interruption/restart and concurrent fencing | NOT_RUN          |
| Refund and entitlements    | Partial/full refunds, timeout after actual provider success, no over-refund, one activation and correct expiry/consequence                          | NOT_RUN          |
| Operator and audit         | Unauthorized/stale/hash-changed/self-checker actions, dry-run, resolve/reopen, immutable evidence, ledger invariants and notification dedupe        | NOT_RUN          |
| Real Admin UI              | Inspection and approved resolution using real APIs in AR/EN, RTL, required widths, zoom and keyboard                                                | NOT_RUN          |

Matched/unmatched counts and unresolved exception severity are **NOT MEASURED**
and remain null. No R34 functional SOURCE_VERIFIED, SANDBOX_ACCEPTED,
HOSTED_ACCEPTED or RELEASE_ACCEPTED claim is made.
