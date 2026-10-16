# G1 coordinator ownership

Authority: the repository owner's supplied G1 execution prompt, 2026-10-16.
Mode A: integration and bug-fix. Writer: this G1 coordinator session.
The live GitHub inventory had no open PRs at inspection; the coordination
branch did not exist remotely. Existing lane worktrees remain untouched.
This lease ends when this coordination PR closes or a successor coordinator
explicitly takes over. No lease permits merge, deployment or production grants.

Exact source/test scope (recorded before implementation):

- `apps/api/src/modules/provider/verification/media/evidence-read.controller.ts`
- `apps/api/src/modules/provider/verification/media/evidence-read.controller.spec.ts` (new)
- `apps/api/test/integration/r20-storage/r20-mediated-read-s3.integration.spec.ts`
- `.github/scripts/sprint-registry.mjs`
- `.github/scripts/sprint-registry.test.mjs`
- `.github/scripts/wave-gate.mjs` (new)
- `.github/scripts/wave-gate.test.mjs` (new)

Exact coordination records:

- `docs/production-readiness/post-r18/SPRINT_REGISTRY.json`
- `docs/production-readiness/post-r18/ACTIVE_STATUS.md`
- `docs/production-readiness/post-r18/waves/WAVE_02.md`
- `docs/production-readiness/post-r18/waves/wave-02.plan.json`
- `docs/production-readiness/post-r18/gates/g1/OWNERSHIP.md`
- `docs/production-readiness/post-r18/gates/g1/DECISION.md`
- `docs/production-readiness/post-r18/gates/g1/SOURCE_MANIFEST.json`
- `docs/production-readiness/post-r18/gates/g1/MERGE_MATRIX.md`
- `docs/production-readiness/post-r18/gates/g1/INTEGRATION_EVIDENCE.md`
- `docs/production-readiness/post-r18/gates/g1/BLOCKERS.md`
- `docs/production-readiness/post-r18/gates/g1/ROLLBACK.md`
- `docs/production-readiness/post-r18/gates/g1/CHANGE_REQUESTS.md`
- `docs/production-readiness/post-r18/gates/g1/PROMPT_PROVENANCE.md`
- `docs/production-readiness/post-r18/gates/g1/REMOTE_EVIDENCE.json`
- `docs/production-readiness/post-r18/gates/g1/REQUIREMENTS.md`
- `docs/production-readiness/post-r18/gates/g1/prompts/R19-R28.md`

The source repair is CR-R20-01 only: propagate the already-authoritative
size to the restricted storage port and set document response headers only
after the stream opens. No schema, migrations, dependencies, commercial
policy, permissions, live rails or Wave 2 implementation are changed.
All other shared runtime files remain reserved for a serialized follow-up.

Historical R19/R21 schema writers are recorded as a process violation with
merged-content verification, not retroactively granted simultaneous leases.
Wave 2 ownership is conditional preparation; it is not a start authorization.
