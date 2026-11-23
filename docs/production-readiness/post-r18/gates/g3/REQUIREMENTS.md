# G3 integration and Wave 4 publication requirements

## Current state and authority

G3 is **BLOCKED**. The 2026-10-23 coordinator review of develop
`5ff2b7e6a46b4e42114184fac89928372f4c8d4c` is a historical snapshot: it found
merged R30–R33 source, absent R29 implementation, and unavailable refund
participants. Preserve [that review](READINESS_REVIEW_2026-10-23.md) and its
API snapshot as historical evidence.

The current integration branch starts from develop
`73a4a64a77844db7815466f47d8afdefb0b35c2f`, where all R29–R33 merge commits
are ancestors. PR #198 composes the actual Stripe transport, checkout,
explicit approved-policy/refund participants and additive reconciliation
persistence/contracts. Its subsequent repair adds concrete cross-lane
regressions and an explicitly authorized external Stripe runner. Implemented
source and passing component/infrastructure checks alone do not satisfy the
seven categories below. No complete combined candidate has been accepted;
independent sandbox execution and explicit policy inputs remain required.
The canonical manifest records the evidence and publication state. G2
acceptance/publication cannot release R34–R38 directly.

Authority is the original coordinator prompt, Mode 3, and full R29–R38 prompts
preserved under `../g2/prompts/`, with original pack provenance in
[`../g2/PROMPT_PROVENANCE.md`](../g2/PROMPT_PROVENANCE.md). The start package is
[`../../waves/wave-04.plan.json`](../../waves/wave-04.plan.json). Conditional
file ownership is separate from source/real-service acceptance.

## Required evidence on one combined source

The future coordinator gathers all five lane PR heads, actual base/diff/lease
records and raw sanitized artifacts, applies shared changes serially, then tests
the assembled candidate. Contract doubles may establish isolated behavior;
they cannot replace registered real adapters, routes, durable service state or
actual operator/sandbox authority at this gate.

| Required category                                  | Required actual observation                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `combined-wave3-checks`                            | Pinned frozen install and applicable formatting/lint/typecheck/unit/build, real PostgreSQL/Redis/storage/scan/browser/security suites, checked exit codes and complete failure/skip counts, final-source CI/official CodeQL. Inspect artifacts and route/provider/handler discovery.                                                                     |
| `r29-real-stripe-sandbox`                          | Authorized real sandbox collections/refunds with untouched-byte signature verification, amount/currency/payer/mode binding, durable inbox before acknowledgement, logical confirmation dedupe, out-of-order/replay, raw-body tampering, durable failure/crash and ambiguous remote success recovery.                                                     |
| `r30-real-manual-review`                           | Actual API/PostgreSQL/private storage/ClamAV receipt lifecycle, immutable correction/reupload/relogin, revoked reviewer/no-self-review checks, deposit/reference dedupe, double-approval races and rollback. Label operator/sandbox simulation accurately; it is not real live settlement.                                                               |
| `r31-atomic-subscription-entitlements`             | Existing immutable plan versions and period/usage persistence, transaction-bound activation, payer/duplicate/concurrency/rollback tests, expiry/renewal/coupon/usage behavior, actual My Plan AR/EN/RTL/mobile/keyboard routes. Purchase never establishes identity/work eligibility.                                                                    |
| `r32-refund-ambiguity-recovery`                    | Assembled Stripe/manual transport with policy/permission/ownership/currency checks, concurrent reservations, unknown outcomes/query-before-retry, unchanged outbound keys, duplicate result handling, linked compensation/entitlement rollback. Ledger reversal alone is not returned money.                                                             |
| `r33-financial-operations`                         | Real finance controller/read/UI wiring, permission/owner boundaries, exact per-currency/large-value formatting, bounded paging/query counts, CSV injection and private-evidence redaction, pending/unknown/confirmed distinctions, truthful reconciliation-not-run state and fresh-login durability.                                                     |
| `integrated-confirmation-activation-refund-outbox` | Both real R29/R30 confirmations enter R24 and the actual R31 participant; R32 results and R33 UI use the same authority. Confirmation, ledger, period/entitlements and post-commit outbox stay atomic under retries, concurrency and injected failure. Discover actual registered providers/consumers and prove no partial business success on rollback. |

The final category cannot use fake confirmation, no-op activation, mock refund
transport or a connected socket alone. Unresolved commercial/refund/market/
currency/receipt policies and hosted requirements remain owned blockers for
their in-scope claims. R16/R18 holds and live-money-off defaults are preserved.

## Machine-readable acceptance contract

`SOURCE_MANIFEST.json` uses the existing `schemaVersion: 1` gate vocabulary.
Validation checks record consistency; remote artifact authenticity and owner
authorization remain coordinator responsibilities. Malformed or incomplete
records fail closed; no archive substitutes for active input.

- `gateId` is `G3`; `decision` is `BLOCKED` or `ACCEPTED`. Candidate source/tree
  are both null before assembly, or full distinct nonzero Git SHAs afterwards.
  A blocked gate cannot assign frozen source or accepted sprints.
- `prerequisite` names the canonical accepted and separately verified merged G2
  record. Accepted G3 binds that exact G2 frozen source/publication commit.
  Accepted-but-unpublished G2 is insufficient.
- `mandatoryEvidence` contains exactly the seven ordered categories above.
  Every entry names its state, candidate source/tree and nonempty reference.
  Before a candidate exists, every entry is `NOT_RUN` with null source/tree.
  Acceptance requires all `PASS` on the frozen candidate and an identified
  artifact (`reference`, SHA-256 digest and positive artifact/run IDs) for each.
  Blockers must be empty.
- `checks` retains the complete unique inventory of successful completed
  exact-source check runs plus official GitHub Advanced Security CodeQL with
  zero annotations. Required gate, governance and CodeQL names cannot be omitted.
  The inherited `R27 comparable measurements and unchanged budgets` acceptance
  job remains required on the candidate; measurement alone is insufficient.
  Failed, cancelled, skipped or wrong-source checks refuse acceptance.
- `sourceArtifact` records verified tracked blobs, recomputed tree and source
  archive SHA-256. `lanes` records five actual R29–R33 branches/PRs, full source
  and merge identities, and integrated PASS. These are assertions to verify,
  not automatic merge permission.
- `integration` binds the same source/tree and actual registered Stripe, manual,
  activation, refund and finance participants. Execution mode must be
  `REAL_REGISTERED_IMPLEMENTATIONS`; observed boundaries include actual
  route/handler discovery, atomic rollback, retries/concurrency and post-commit
  outbox. A reference is mandatory. Synthetic adapters cannot be relabeled.
- `acceptedSprints` contains unique earlier-wave IDs, including all five Wave 3
  lanes and every dependency of a released Wave 4 lane. No same-wave source
  dependency is permitted. `restrictions` explicitly preserve prior gates/policy
  holds and deny live money, deploy, merge, account grants and spend.
- `publication.state` starts `NOT_PREPARED`, may become
  `DRAFT_PENDING_OWNER_REVIEW`, and becomes `MERGED` only after actual owner
  approval/merge and independent verification. Unmerged acceptance may record
  a tested frozen source but holds Wave 4. A merged publication requires a full
  separate acceptance-record commit and `verifiedMerge: true`; it cannot use
  the candidate source itself as the publication identity.

`.github/scripts/g3-record.mjs --check` also validates canonical G2 input.
`--ready R34` through `R38` additionally require accepted, verified merged G3,
an explicitly startable lane, identical registry/plan bases and exact ownership.
Missing, ambiguous, corrupt or wrong-gate inputs exit unsuccessfully without
printing raw input content.

## Publication and final release separation

Any source change during integration requires a new candidate and new
applicable evidence, including the actual synthetic merge source used by CI.
Only after owner-reviewed accepted G3 publication is merged and verified may
the coordinator assign that full source to Wave 4 and release sessions.

G3 does not certify R34 reconciliation, R35 final product reruns, R36 restore,
R37 hosted acceptance or R38 final release. R38 Phase A prepares tools after
G3. Phase B is a serialized G4 join after R34/R35/R36/R37 finish, with required
evidence rerun on a frozen combined candidate and explicit owner scope approval.
`PHASE_A_READY`, `RELEASE_ACCEPTED`, actual authorized `DEPLOYED`, and separate
live-money activation remain distinct states.
