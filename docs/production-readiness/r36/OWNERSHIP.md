# R36 preflight evidence ownership

Status: **DOCUMENTATION PREFLIGHT ONLY; R36 IMPLEMENTATION NOT AUTHORIZED TO START.**

## Current assignment — 2026-10-25

The current owner request is to implement R36 for later review and merge. Its
G3 start barrier is still closed. Under the continuing coordinator authority
to prepare reviewable blockers, this session records a new, bounded
documentation assignment before editing the files below. It does not reuse
the expired assignment from merged PR #190.

Delivery mode A applies. Session `r36-eb22d30bac36` is the sole writer of:

- `docs/production-readiness/r36/OWNERSHIP.md`
- `docs/production-readiness/r36/IMPLEMENTATION.md`
- `docs/production-readiness/r36/ACCEPTANCE.md`
- `docs/production-readiness/r36/RISKS.md`
- `docs/production-readiness/r36/ROLLBACK.md`
- `docs/production-readiness/r36/evidence/preflight-2026-10-25.json`
- `docs/production-readiness/r36/shared-change-requests/CR-001-integration.md`

Independent gate and recovery reviewers have read-only assignments. All seven
files remain under one writer. This exact assignment expires when this
follow-up PR closes or the coordinator explicitly reassigns it.

The task-owned checkout is `/workspace/scratch/eb22d30bac36/hsm-r36`, branch
`test/r36-backup-restore-recovery`. It was clean with an empty stash at existing
remote head `77076f0f6e8ee0054bb323fd784346780218164d`. That head is an ancestor
of the observed owner-merged develop source, so the same isolated branch was
fast-forwarded without a merge commit or rebase to:

- inspection base/source: `c9de08d07b12871db8801fb9662b14de83a2c391`;
- inspection tree: `67136183b8a81de9773c2c6a3831441c320729c0`.

This is **not an approved frozen G3 execution base**. No other session's
worktree, stash, branch or unmerged product source was used.

## Preserved boundaries

The previous documentation assignment to `r36-d86d02f90f5c` expired when PR
#190 merged on 2026-10-24. Its historical `evidence/preflight.json` and
`PR_REPAIR_2026-10-24.md` remain unchanged. New observations are recorded
separately and do not relabel old test results as current execution.

This assignment does not activate the conditional runtime/infrastructure
lease in `../post-r18/waves/wave-04.plan.json`, accept G3, assign a Wave 4
runtime writer or provide a frozen base. G3 acceptance/publication records and
central wave/status registries remain with their existing coordinator owner.

No CI, schema/migration, manifest/lockfile, runtime module, staging launcher,
peer lane, external account, resource, deployment or live-money write lease
is granted here. The exact shared change request is review material for the
coordinator's serialized integration, not an applied shared-file patch.
