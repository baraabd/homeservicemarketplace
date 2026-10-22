# Wave 3 — Conditional G2 handoff

**Status: BLOCKED.** `wave-03.plan.json` and the G2 SOURCE_MANIFEST are authoritative. No lane is startable and no frozen base is assigned while G2 evidence/approval is incomplete.

| Lane    | Package authority                                                        | State                                                                                        |
| ------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| R29 / 1 | Full package not supplied to this task                                   | RESERVED_PENDING_PACKAGE; no invented title, branch, owner or paths                          |
| R30 / 2 | Exact user-supplied full prompt retained at `../../r30/PROMPT.md`        | PLANNED / BLOCKED; branch `feat/r30-manual-payment-review`; dependencies R24/R20/R21/R22/R23 |
| R31 / 3 | Full package not supplied to this task                                   | RESERVED_PENDING_PACKAGE                                                                     |
| R32 / 4 | Exact user-supplied full prompt retained at `../gates/g2/prompts/R32.md` | PLANNED / BLOCKED; branch `feat/r32-refund-recovery`; dependencies R24/R22/R23               |
| R33 / 5 | Full package not supplied to this task                                   | RESERVED_PENDING_PACKAGE                                                                     |

R30 has a conditional registration **PREPARED_FOR_REVIEW** under its recorded preparation lease. Its 70 exact future lane/test/evidence paths come from `../../r30/PROPOSED_OWNERSHIP.json`; all shared runtime requests remain unapplied and both canonical runtime lease lists remain empty. The named R30 lane owner takes execution ownership only after verified G2 approval/publication, revalidation against the accepted tree and any required exact serialized leases. Its frozen base remains null and it stays held in `blockedLanes`. This record does not claim owner-merged registration or authorize R30 runtime work.

The known R32 file list is a conditional implementation plan. It grants no execution before the start barrier. Its actual shared integration changes must receive exact serialized leases after G2 closes; no migration or change to peer-owned files is assumed. The compile-tested G2 money catalog defines the current independent ports, so R32 has no source dependency on unmerged R29/R30/R31 branches.

Before release, verify mandatory G2 evidence, full frozen SHA/tree, explicit owner approval and the owner-merged publication identity. Reconcile registry, wave and publication records; then start a fresh clean R32 worktree from that frozen commit with separate dependencies, generated artifacts, ports, databases, Redis/storage/mail and browser contexts. The current task never merges or deploys its review PR.

Sandbox source implementation follows the approved interface. Missing commercial/entitlement/refund-window/fee/tax policy blocks live operation. R16 payouts remain blocked. Assembled Wave 3 real-adapter refund acceptance and later R34 cross-rail acceptance are required; synthetic rail or ledger-only success cannot replace them.
