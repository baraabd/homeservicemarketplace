# R36 preflight evidence ownership

Status: **PREFLIGHT ONLY; R36 IMPLEMENTATION NOT AUTHORIZED TO START.**

The owner's request authorizes inspection and preparation of the G3 blockers
before R36. Delivery mode A applies. Session `r36-d86d02f90f5c` is the sole
writer of the following documentation, under that narrow coordinator scope:

- `docs/production-readiness/r36/OWNERSHIP.md`
- `docs/production-readiness/r36/IMPLEMENTATION.md`
- `docs/production-readiness/r36/ACCEPTANCE.md`
- `docs/production-readiness/r36/RISKS.md`
- `docs/production-readiness/r36/ROLLBACK.md`
- `docs/production-readiness/r36/evidence/preflight.json`
- `docs/production-readiness/r36/shared-change-requests/CR-001-integration.md`

This exact documentation allowlist is recorded before the other edits. It
does not activate the conditional runtime/infrastructure lease in
`../post-r18/waves/wave-04.plan.json`, assign a frozen Wave 4 base, or accept G3.
It expires on closure of this preflight PR or explicit reassignment.

The task-owned clone is `/workspace/scratch/d86d02f90f5c/hsm-r36`, branch
`test/r36-backup-restore-recovery`. Before edits, its tracked worktree and
stash were empty and its observed source was
`5ff2b7e6a46b4e42114184fac89928372f4c8d4c`, tree
`54e00d4e9eaa7bd81146f01b69dfa9b396eab45c`. This is an inspection base,
**not an approved G3 execution base**.

An existing, separate coordinator session owns the G3 record and shared
wave-status documentation. This session reads those files but does not edit
them or import that session's unmerged source. PR #188 also received a
concurrent corrective commit during inspection; this session does not overwrite
its branch or claim authorship of that correction.

No CI, schema/migration, package manifest/lockfile, runtime module, staging
launcher, registry, peer lane, external account, deployment or live-money
write lease is granted here. The request in `shared-change-requests/` is for
the coordinator's later serialized integration, not an applied runtime patch.
