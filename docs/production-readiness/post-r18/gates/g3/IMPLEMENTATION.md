# G3 current-source verification before R34

Disposition: **INTEGRATION_PENDING / POLICY_BLOCKED / EXTERNAL_BLOCKED**.
R34 is **NOT_STARTED**. This gate change corrects stale coordination evidence;
it implements no payment, refund or reconciliation behavior.

## Identity and bounded scope

- Actual branch-start/inspected source: `5ff2b7e6a46b4e42114184fac89928372f4c8d4c`.
- Actual inspected source tree: `54e00d4e9eaa7bd81146f01b69dfa9b396eab45c`.
- Branch: `coord/g3-evidence-b3dda4f7`; sole writer/session: `/root`, `g3-b3dda4f7b9ef`.
- Final documentation commit/tree: recorded in the PR after committing; a source
  document cannot contain its own future commit hash. This final commit does not
  replace the inspected runtime identity above or freeze a Wave 4 base.
- Exact nine changed paths and shared-document leases: [OWNERSHIP.md](OWNERSHIP.md).
- Contract: existing `hsm.money.v1`; schema, migrations, dependencies, flags,
  published interfaces and runtime registrations unchanged.

The task read CLAUDE.md, the UX/UI policy, R15 accounting/ledger/authority records,
R16 payout policy, R18 blockers, ADR 0014, transactional-outbox ADR, live-money
gate, reconciliation policy, G2/G3 manifests, Wave 3/4 ownership and the current
R30–R33 implementations and acceptance records. There is no R29 evidence
directory at the inspected source. Historical documents were not used as proof
that current external integrations run.

## Observed source and merge facts

| Sprint | PR         | Merge SHA                                  | G3 interpretation                                                                |
| ------ | ---------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| R29    | none found | none                                       | No implementation, branch, source delivery or Stripe registration found          |
| R30    | #184       | `aaa22a9a04025fc312cbcc2121687aca2e467cac` | Merged manual payment implementation; actual combined-rail acceptance pending    |
| R31    | #186       | `c3c080cf28f142ed46495ec7e5d549937da90096` | Merged activation/entitlements implementation                                    |
| R32    | #187       | `70962ea24be36035b62c81e537002353795ca00a` | Merged recovery implementation; policy and refund consequence remain unavailable |
| R33    | #185       | `5ff2b7e6a46b4e42114184fac89928372f4c8d4c` | Merged financial reports/UI; reconciliation remains unavailable by design        |

Git ancestry checks confirmed the four merges and G2 publication are included.
`git diff --quiet 25fec75db092cd68ea1f08297601d8baecde6b1a HEAD` succeeded
before edits: the R33 reviewed head and owner-merged candidate have identical
trees. The PR-head checks are useful source evidence, but their different commit
identities do not satisfy G3's exact-candidate acceptance requirements.

## Why G3 cannot be accepted yet

`MoneyModule` binds `MONEY_CONFIGURATION` to `ManualRailConfiguration`,
`MONEY_COLLECTION_ADAPTER` to `ManualCollectionAdapter` and
`MONEY_REFUND_ADAPTER` to `ManualRefundAdapter`. It has no Stripe multiplexer,
collection transport, signed-webhook controller or Stripe refund adapter.
Payment-method enum values and tests using STRIPE strings are not implementations.

The real R31 `SubscriptionActivationParticipant` is registered. However,
`REFUND_POLICY_SOURCE` is still `UnavailableRefundPolicySource`, and
`MONEY_REFUND_CONFIRMATION_PARTICIPANT` is still
`UnavailableMoneyRefundConfirmationParticipant`. These intentionally fail closed.
Replacing them with an always-successful participant would fabricate financial
acceptance and is not an integration fix.

R33's `FINANCIAL_RECONCILIATION_STATUS` remains bound to
`UnavailableFinancialReconciliationStatus`. That is an honest future R34 boundary,
not a reason to return a false clean report. The R34 frozen exception model and
financial reporting contract remain the future authorities; no second ledger,
exception schema or reconciliation module is introduced here.

## Concrete changes

The supplemental inspection anchors the observed partial candidate, verifies
the G2 source/publication identities, and identifies the concrete blockers.
Another session published canonical G3 review PR #189 during this task; its
REQUIREMENTS.md and SOURCE_MANIFEST.json edits are not overwritten or imported.
The final diff leaves those two paths unchanged from develop, preserving all
seven evidence requirements, null frozen SHAs and every operational restriction.
The canonical gate review can consume these inspected results after review.

The active index and Wave 4 prose now distinguish completed owner merges from
G3 acceptance. A sanitized remote-check/test snapshot, exact local verification,
rollback and a concrete serialized integration request accompany the correction.
No existing test, gate, budget, schema, module or policy is weakened.

## R34 handoff

First deliver R29 under its existing sprint identity, resolve the explicit refund
policy/consequence boundary, and execute the seven G3 categories through the
actual registered application on one combined source. Then publish accepted G3
evidence for owner review; after the owner's separate merge and verification,
assign the frozen source and the existing exact R34 file allowlist. Only then
create the R34 worktree and implement independent cross-rail reconciliation.

This task does not execute the other Wave 4 sprints, start a blocked R34 branch,
merge a PR, deploy, grant access or enable live money.
