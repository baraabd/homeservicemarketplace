# Wave 2 — historical G1 start grant and current closeout

## Current closeout

G2 is **BLOCKED** on inspection source
`4e87bf03663fb3c72ffee983fdb70c2863e1ce8a`, tree
`eaca9cdeab15e719570f7997c4fc3bbeb64e562e`. See
[the Wave 2 closeout](wave-02.closeout.json) and [G2 blockers](../gates/g2/BLOCKERS.md).
R24-R27 are merged, but the actual integrated R25 browser run failed and R28
implementation/evidence is absent. This is not an accepted Wave 3 baseline.

## Historical verified G1 publication

Frozen runtime source: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.
Frozen runtime tree: `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
Owner-merged acceptance record: `0568739096ceeaf0cfc79034626886e258fe4328` (PR #171).
Reviewed/merged record tree: `ceaa111acd43e07a89e49728996933b9204bd73d`.

G1 source and publication conditions are satisfied. The exact pre-reviewed
allowlists and leases in `wave-02.plan.json` take effect for owner-assigned
lane sessions. READY_TO_START releases the bounded engineering lane; it is
not implementation, sandbox/hosted acceptance or a production release.
This coordinator task starts no runtime stack.

| Lane | Assigned branch                  | Accepted earlier-wave inputs | State          |
| ---- | -------------------------------- | ---------------------------- | -------------- |
| R24  | feat/r24-money-api-integration   | R19, R22, R23                | READY_TO_START |
| R25  | feat/r25-realtime-multi-instance | R22, R23                     | READY_TO_START |
| R26  | feat/r26-application-security    | R20, R21, R23                | READY_TO_START |
| R27  | feat/r27-performance-capacity    | R20, R23                     | READY_TO_START |
| R28  | feat/r28-hosted-platform         | R20, R21, R22, R23           | READY_TO_START |

## Ownership and isolation

Handoff and immutable evidence are in `../gates/g1/PUBLICATION_VERIFICATION.md`
and its JSON companion. Verify the current branch/worktree/head before edits,
preserve unrelated changes and stashes, and use the exact frozen source.
Report any later record-only overlay explicitly. No lane consumes an unmerged
same-wave peer. Unlisted and shared runtime/config/schema/CI paths remain
coordinator-owned.

Use separate disposable databases, Redis, storage, ports and fresh browser
contexts from the manifest. Inspect fixed container/volume names before boot.
Never copy the user's environment or reuse their working database.

## R27 lineage and explicit handoff

Preserve PR #162, original head `2e8d1dba35f2a36a73d47100d8495f5379bc028c`
and merge `f52d7b0aeac8ae9e16152fb26b3bdbe21d7dadf0`. Git ancestry was verified
against the frozen source. The coordinator releases exact R27 ownership to
its owner-assigned session. Use a fresh isolated checkout of the frozen source,
compare the preserved harness and rerun baselines. A fast-forward from the
observed original branch is possible; this task moves no lane branch.
Inspect any newer head before updating it. No reset, rebase, force-push or
other-session worktree overwrite is authorized. Owner approval of budgets
remains required; old measurements are not new acceptance evidence.

## Limits and revocation

G1 covers Wave 1 engineering/disposable-service acceptance. R18 NO-GO, hosted
resource inputs, repository security-policy acceptance, commercial decisions,
live funds and payouts remain independent holds. A reviewed revocation must
reconcile gate, wave manifest and registry, preserving publication history.

## Historical R26 review

At G1 publication, Draft PR #174 held the recorded exact-file extensions and
shared-file lease. It subsequently merged; the G2 closeout above records current
execution state. R26 had integrated owner-merged #172 at
`07c8e584c684111bfc80995c7efb0144cfb6161b` without importing unmerged peer code.
The historical G1 start grant is not current Wave 2 completion or G2 acceptance.
