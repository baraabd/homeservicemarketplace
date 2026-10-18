# G1 acceptance publication ownership

Mode A — verification and publication of the merged Wave 1 source.

The owner delegated closure of all G1 blockers, fixes/tests and a review PR,
without merge or deployment, on 2026-10-16. This successor coordination work
prepares G1-06 after the owner merged remediation PR #169. The preceding
remediation lease expired at that owner merge. Remote inspection found no open
PR or acceptance branch before reserving this branch. One writer: this
acceptance-publication session. No runtime lane is reassigned here.

- Branch: `coord/g1-wave2-acceptance`.
- Source/base: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.
- Source tree: `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
- Scope: verify actual post-merge artifacts, publish an evidence-backed G1
  decision, retain all independent release limitations and hold Wave 2 until
  the owner merges the acceptance record and its identity is verified.
- Expiry: this PR closes, the owner merges it, or an explicit handoff.
- Publication: review PR only. No merge, deployment, live activation or grants.

## Exact files reserved before edits

- `.github/scripts/wave-gate.test.mjs` — separate synthetic blocked fixtures
  from the live record so both blocked and accepted publication states remain
  tested without weakening any validator or assertion.
- `docs/production-readiness/post-r18/SPRINT_REGISTRY.json`
- `docs/production-readiness/post-r18/ACTIVE_STATUS.md`
- `docs/production-readiness/post-r18/waves/WAVE_02.md`
- `docs/production-readiness/post-r18/waves/wave-02.plan.json`
- `docs/production-readiness/post-r18/gates/g1/ACCEPTANCE_OWNERSHIP.md`
- `docs/production-readiness/post-r18/gates/g1/ACCEPTANCE_EVIDENCE.md`
- `docs/production-readiness/post-r18/gates/g1/ACCEPTANCE_EVIDENCE.json`
- `docs/production-readiness/post-r18/gates/g1/DECISION.md`
- `docs/production-readiness/post-r18/gates/g1/SOURCE_MANIFEST.json`
- `docs/production-readiness/post-r18/gates/g1/BLOCKERS.md`
- `docs/production-readiness/post-r18/gates/g1/MERGE_MATRIX.md`
- `docs/production-readiness/post-r18/gates/g1/REQUIREMENTS.md`
- `docs/production-readiness/post-r18/gates/g1/CHANGE_REQUESTS.md`
- `docs/production-readiness/post-r18/gates/g1/INTEGRATION_EVIDENCE.md`

Historical findings remain dated evidence. The new acceptance evidence will
state which source gaps the remediation closes and which facts remain outside
G1. No source, schema, migration, dependency, CI workflow or R27 implementation
is changed. R27 remains assigned to `feat/r27-performance-capacity` and needs
its documented handoff after G1 publication.

Rollback: revert this publication's records/test-fixture change through review;
retain remediation source and migration. No runtime or data rollback applies.
