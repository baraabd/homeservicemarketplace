# G3 coordinator inspection ownership

Session: `g3-b3dda4f7b9ef`; sole writer: `/root`.
Authority: the owner's current request to execute G3 before R34, with explicit
no-merge/no-deploy restrictions. Delivery mode: A, integration inspection and
correction of stale coordination records. This is a gate PR, not R34 execution.

Worktree: `/workspace/scratch/b3dda4f7b9ef/hsm-r34`.
Branch: `coord/g3-evidence-b3dda4f7`.
Actual inspected/branch-start source:
`5ff2b7e6a46b4e42114184fac89928372f4c8d4c`.
Tree: `54e00d4e9eaa7bd81146f01b69dfa9b396eab45c`.
The worktree was a new task-owned clone, clean after checkout, with no stash.
No peer worktree, branch, unmerged implementation or shared runtime was used.

## Exact approved write allowlist

The owner-delegated coordinator records this documentation-only lease before
the other edits. No runtime, CI, contract, schema or dependency lease is granted.

- `docs/production-readiness/post-r18/gates/g3/OWNERSHIP.md`
- `docs/production-readiness/post-r18/gates/g3/IMPLEMENTATION.md`
- `docs/production-readiness/post-r18/gates/g3/ACCEPTANCE.md`
- `docs/production-readiness/post-r18/gates/g3/RISKS.md`
- `docs/production-readiness/post-r18/gates/g3/ROLLBACK.md`
- `docs/production-readiness/post-r18/gates/g3/evidence/preflight.json`
- `docs/production-readiness/post-r18/gates/g3/shared-change-requests/CR-001-financial-integration.md`
- `docs/production-readiness/post-r18/ACTIVE_STATUS.md`
- `docs/production-readiness/post-r18/waves/WAVE_04.md`

The last two shared documentation paths are leased solely to correct observed
merge facts and link the G3 findings. Existing frozen identities, assignments,
registry states, acceptance requirements and operational restrictions are retained.
The lease ends when this gate PR closes or the coordinator explicitly hands it
off. No other writer is assigned by this task.

## R34 ownership remains conditional

The exact 24-file R34 proposal already exists in `waves/wave-04.plan.json`.
It has no frozen source or assigned session. No R34 source, test or evidence
file is authored in this gate PR. Its proposed branch is not created from an
unaccepted candidate. Future implementation requires the unchanged G3 start
contract and a recorded session assignment, then uses its own worktree.

## Concurrent coordinator handoff

Before publication, remote inspection discovered coordinator PR #189 at
`30b8de80aee6d1b7212298634b171cae4f2b371a`, created by another session on
`coord/g3-wave4-start-gate`. It owns REQUIREMENTS.md and SOURCE_MANIFEST.json.
Those two paths were restored to the branch-start bytes in this worktree and
removed from this final nine-file lease. No peer branch was imported or changed.
This supplemental evidence PR uses a distinct task-owned branch and leaves #189
as the canonical gate-review PR. The final changed paths are disjoint from its
four paths at observation. Merge neither PR as G3 acceptance.
