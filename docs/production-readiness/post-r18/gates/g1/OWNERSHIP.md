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

## CI remediation follow-up — 2026-10-16

Authority: the repository owner's request to repair PR #168 / CI run #489
for later owner merge. Mode A; successor coordinator for this bounded repair.
Starting head: `8c730d9a73099d64b6d3fe6175da2601ee3efc35`.

Exact additional scope, recorded before changing the historical baseline:

- `.gitleaksignore`: only the two individually reviewed historical prose
  fingerprints from commit `9c5b3f36e2bd37558a2d0c7ef5873f5e6484ce0e`.
- `docs/security/gitleaks-historical-baseline.md`: provenance, classification,
  scanner reproduction and negative controls for those two findings.
- `docs/production-readiness/post-r18/gates/g1/OWNERSHIP.md`: this scope record.
- `docs/production-readiness/post-r18/gates/g1/INTEGRATION_EVIDENCE.md`:
  bounded CI remediation evidence, separate from G1 acceptance.

The current request authorizes the scoped fix; this is not retroactive approval
of the earlier failed head. Existing source changes, scanner rules/ranges,
workflows, dependencies and gate decisions are preserved. Publish a normal
fast-forward commit; no force-push, history rewrite, merge or deployment.
This scope neither closes G1-01 through G1-06 nor authorizes Wave 2 or G2.
