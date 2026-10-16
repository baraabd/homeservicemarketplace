# G1 acceptance-publication ownership

Mode A: integration and bug-fix coordination. Authority: the owner's ongoing
delegation to resolve G1, prepare review PRs without merge/deployment, and resume
R26 after the gate is accepted. This continues G1-06 after owner-merged PR #169.

Writer: the current delegated G1 coordinator. Branch:
`coord/g1-acceptance-publication`. Starting source:
`40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`; tree:
`109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
The live repository had no open PRs when this lease was reserved. Peer branches,
worktrees and stashes are untouched. No R26 implementation starts under this lease.

Exact files reserved before editing:

- `.github/scripts/wave-gate.test.mjs`
- `docs/production-readiness/post-r18/SPRINT_REGISTRY.json`
- `docs/production-readiness/post-r18/ACTIVE_STATUS.md`
- `docs/production-readiness/post-r18/waves/wave-02.plan.json`
- `docs/production-readiness/post-r18/waves/WAVE_02.md`
- `docs/production-readiness/post-r18/gates/g1/ACCEPTANCE_OWNERSHIP.md`
- `docs/production-readiness/post-r18/gates/g1/ACCEPTANCE_PUBLICATION.md`
- `docs/production-readiness/post-r18/gates/g1/ACCEPTANCE_EVIDENCE.json`
- `docs/production-readiness/post-r18/gates/g1/SOURCE_MANIFEST.json`
- `docs/production-readiness/post-r18/gates/g1/DECISION.md`
- `docs/production-readiness/post-r18/gates/g1/BLOCKERS.md`
- `docs/production-readiness/post-r18/gates/g1/REQUIREMENTS.md`
- `docs/production-readiness/post-r18/gates/g1/CHANGE_REQUESTS.md`
- `docs/production-readiness/post-r18/gates/g1/INTEGRATION_EVIDENCE.md`
- `docs/production-readiness/post-r18/gates/g1/MERGE_MATRIX.md`
- `docs/production-readiness/post-r18/gates/g1/ROLLBACK.md`

Scope: inspect post-merge execution and artifact provenance, propose the G1
acceptance record, reconcile the active registry, retain publication holds,
and make governance regression fixtures independent of the live gate's state.
Existing negative assertions and publication checks remain mandatory. No
application, schema, dependency, workflow or runtime behavior is changed.

The frozen runtime source and the later acceptance-record commit are different
identities. A PR proposing ACCEPTED is not a merged publication. Until owner
review/merge is observed and its actual commit is recorded, all Wave 2 lanes
remain held. No guessed or self-referential commit identity is permitted.

This lease ends when this PR closes or the coordinator records a handoff.
It does not grant merge, auto-merge, deployment, live funds, permissions or spend.
