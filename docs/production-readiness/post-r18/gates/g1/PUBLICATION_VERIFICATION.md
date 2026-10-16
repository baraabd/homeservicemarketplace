# G1 publication verification and successor ownership

Mode A — post-merge identity reconciliation for PR #171.

This coordinator follow-up records an existing owner merge; it does not merge,
deploy, accept Wave 2 implementations, or alter runtime source. The owner's
continuation request follows the repaired PR and its merge.

## Exact single-writer lease

Branch: `coord/g1-publication-identity`.
Base: `0568739096ceeaf0cfc79034626886e258fe4328`.
The preceding acceptance-record lease expired at the owner merge of #171.
This successor lease is confined to these ten files, reserved before edits:

- `docs/production-readiness/post-r18/gates/g1/PUBLICATION_VERIFICATION.md`
- `docs/production-readiness/post-r18/gates/g1/PUBLICATION_VERIFICATION.json`
- `docs/production-readiness/post-r18/gates/g1/SOURCE_MANIFEST.json`
- `docs/production-readiness/post-r18/gates/g1/DECISION.md`
- `docs/production-readiness/post-r18/gates/g1/BLOCKERS.md`
- `docs/production-readiness/post-r18/gates/g1/ACCEPTANCE_PUBLICATION.md`
- `docs/production-readiness/post-r18/SPRINT_REGISTRY.json`
- `docs/production-readiness/post-r18/ACTIVE_STATUS.md`
- `docs/production-readiness/post-r18/waves/WAVE_02.md`
- `docs/production-readiness/post-r18/waves/wave-02.plan.json`

The lease expires when this follow-up PR merges/closes or the coordinator
records a successor handoff. Runtime, tests, CI, dependencies, schema and all
lane-owned files are outside it. Existing worktrees and stashes are preserved.

## Verified identities

| Role                            | Full identity                              |
| ------------------------------- | ------------------------------------------ |
| Frozen Wave 1 runtime source    | `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0` |
| Frozen runtime tree             | `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b` |
| Reviewed #171 head              | `578ae9359fb93a46e478b1db0ca043a0c73aca51` |
| Owner-merged acceptance record  | `0568739096ceeaf0cfc79034626886e258fe4328` |
| Reviewed and merged record tree | `ceaa111acd43e07a89e49728996933b9204bd73d` |

[PR #171](https://github.com/baraabd/homeservicemarketplace/pull/171) merged
at `2026-10-16T23:01:54Z`. The merge was observed as `develop` HEAD.
Local Git independently verified frozen-source ancestry and byte-identical
full trees for the reviewed head and merged record. Differences from the
frozen source are confined to 17 governance documents and the existing
wave-gate regression fixture. No runtime, dependency, schema or CI change
is smuggled into a new runtime certification.

The PR-head governance metadata repair passed in
[run #417](https://github.com/baraabd/homeservicemarketplace/actions/runs/38978611954).
All 29 latest PR-head checks passed, including the official GitHub Advanced
Security result with zero alert annotations. The JSON companion records
the separately observed merged-commit checks; it never substitutes old-head
results for a new execution.

## Coordinated start and branch handoff

G1-06 is closed by the actual merge and identity verification. The pre-reviewed
exact allowlists and isolated resources in `wave-02.plan.json` now take effect
for the owner's assigned lane sessions. READY_TO_START means that G1 is
satisfied; it is not IMPLEMENTED, accepted runtime evidence, a deployment,
or a command to launch all stacks.

Each lane keeps its assigned branch and frozen source SHA. A lane author must
identify its own current worktree/head, preserve unrelated work, and record its
execution base before edits. The coordinator retains shared-file ownership;
there is no additional shared-file lease in this follow-up.

R27's existing branch head
`2e8d1dba35f2a36a73d47100d8495f5379bc028c` and merge
`f52d7b0aeac8ae9e16152fb26b3bdbe21d7dadf0` are ancestors of the frozen
source. This is the explicit coordinator handoff to the owner's existing R27
lane session: preserve that lineage and all pre-G1 measurements, use a fresh
isolated checkout of the frozen source, and rerun the baselines. A safe
fast-forward remains possible from the observed remote head; this task does
not move the branch, reset/rebase it, overwrite another worktree, or force-push.
Any newer head must be inspected before updating it. Budgets still need the
previously required owner approval.

## Verification and limitations

Existing repository governance and negative-control tests validate the records.
Exact executed commands, counts, source/tree identity and final-head CI are
reported in the review PR, which stays Draft while required checks are pending.
No application runtime test or new performance measurement is claimed locally
for this records-only follow-up.

The original source evidence remains bound to `40cdac5c...`; historical
publication documents remain dated evidence. Hosted resources, security-policy
acceptance, commercial decisions, live rails and payouts retain their holds.
No message to another person, account grant, spending or deployment occurs.

Rollback: a reviewed revert of these ten records restores their prior status
without changing runtime source or erasing the historical merge. If publication
is revoked, coordinate a BLOCKED successor across the gate, manifest and registry.
