# CR-001 — Synchronized lifecycle and acceptance publication

Owner: delegated coordinator. State: UNAPPLIED; not an authorization to start.

## Exact shared paths

- `.github/scripts/sprint-registry.mjs`
- `.github/scripts/sprint-registry.test.mjs`
- `.github/scripts/wave-gate.mjs`
- `.github/scripts/wave-gate.test.mjs`
- `docs/production-readiness/post-r18/SPRINT_REGISTRY.json`
- `docs/production-readiness/post-r18/ACTIVE_STATUS.md`
- `docs/production-readiness/post-r18/waves/wave-02.plan.json`
- `docs/production-readiness/post-r18/waves/wave-03.plan.json`
- `docs/production-readiness/post-r18/gates/g2/SOURCE_MANIFEST.json`

## Minimal semantic patch and reason

The current registry validator models only G1 start authorization. Extend it
additively to distinguish that immutable event from current Wave 2 execution and
G2 publication. Preserve G1's accepted SHA and every historical lease. Add G2 and
Wave 3 manifest pointers; reconcile R24-R27 to their actual PRs and verified
current execution states, not automatically SANDBOX_ACCEPTED. Record R28's real
delivery when it exists. Register the supplied R29 package and later full peer
packages without inventing missing scopes.

A blocked next-wave PLANNED record may have a null base only when its named gate
is blocked and every start path fails closed. An accepted source with an unmerged
acceptance record still cannot release lanes. Only a separate verified owner
merge permits READY_TO_START; bind registry and manifest to the identical full
frozen source/tree. Keep historical source and publication commits distinct.

## Required tests

Retain the existing registry/G1 negative suite. Add G2 rejection cases for a failed
or skipped required job, partial inventory, old-source evidence, missing R28,
missing/overlapping ownership, arbitrary SHA, self-referential or unmerged
publication and inconsistent registry/manifest state. Prove historical G1 remains
unchanged and test legitimate post-start lifecycle transitions. Run all governance
scripts and required final-PR CI/CodeQL with the pinned toolchain.

No database migration, package dependency, public contract or hosted change is
needed. Apply only under a new explicit serialized lease; these files are not
silently edited by this limited closeout. Roll back the lifecycle transition as a
coherent reviewed change, never by weakening a blocked-gate check.
