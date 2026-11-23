# R37 — Executed preflight checks and acceptance limits

**Executable implementation NOT_STARTED. G3 and hosted acceptance are blocked.**

Inspection source: `c9de08d07b12871db8801fb9662b14de83a2c391`;
tree: `67136183b8a81de9773c2c6a3831441c320729c0`.
The approved G3 execution base is absent. Final documentation SHA/tree and
remote checks belong in the PR metadata and must match the published head.

## Actual local checks

Commands below use task-local Node **24.21.0** and pnpm **10.32.1**. No runtime,
package pin, test, assertion, hook, timeout or security budget was changed.

| Command                                                                                                            | Exit | Actual result                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/runtime/toolchain.cjs`                                                                               | 0    | Exact Node and repository declarations match.                                                                                                     |
| `pnpm install --frozen-lockfile --store-dir /workspace/scratch/b53a92fe1d51/r37-pnpm-store --reporter=append-only` | 0    | All six workspace projects; unchanged lockfile; normal preinstall/Husky and contracts TypeScript build succeeded.                                 |
| `node --test .github/scripts/*.test.mjs`                                                                           | 0    | 500 passed; 0 failed, cancelled, skipped or todo, using authorized subprocess execution. These are governance regressions, not R37 runtime tests. |
| `node .github/scripts/g2-record.mjs --check`                                                                       | 0    | G2 record consistent; no new remote acceptance inferred.                                                                                          |
| `node .github/scripts/g3-record.mjs --check`                                                                       | 0    | G3 BLOCKED / Wave 4 BLOCKED record consistent.                                                                                                    |
| `node .github/scripts/g3-record.mjs --ready R37`                                                                   | 1    | Actual blocker: `FAIL R37 is not authorized to start`. This is not a successful readiness check.                                                  |
| `node .github/scripts/sprint-registry.mjs`                                                                         | 0    | Registry consistency only.                                                                                                                        |
| `node .github/scripts/production-governance.mjs`                                                                   | 0    | Governance files valid; remote branch protection not authenticated.                                                                               |
| `node .github/scripts/release-baseline.mjs`                                                                        | 0    | Source-backed baseline registry valid; no sprint acceptance inferred.                                                                             |
| `node scripts/production/platform/validate-plan.cjs --check`                                                       | 0    | CONFIGURATION_ONLY, HOSTED_ENVIRONMENT_BLOCKED, authorizationVerified=false, targetInputsComplete=false.                                          |
| `pnpm security:audit`                                                                                              | 0    | Full dependency tree: info/low/moderate/high/critical all 0. This is not the open repository-alert or image inventory.                            |

Formatting, document/path validation, normal commit hooks and exact final-tree
secret scanning are recorded in the published PR. No duplicate test counts are
created by repeating a gate check on the final documentation commit.

## Failed attempts and retained warnings

The first installation selected the host's Node 24.22.1 because the downloaded
task-local binary lacked its executable bit. The unchanged preinstall correctly
rejected it with exit 1. Setting the executable bit on that verified task-local
binary restored the repository pin; the complete frozen installation then
succeeded. No machine-wide tooling or repository file was modified for this.

The sandbox initially rejected CLI child processes with `spawnSync ... EPERM`.
Two `node --test` attempts exited 1 (9 file wrappers passed, 4 failed; these are
not case counts). A diagnostic direct G3 test run reported 34/35 cases passing
and one subprocess permission failure. The unchanged full suite was then run
through the permitted execution escalation and passed all 500 cases. This is
an environment correction, not a test exclusion or lower assertion.

Frozen install retains existing ignored-build-script warnings for
`@parcel/watcher@2.6.0` and `unrs-resolver@1.12.2`; no package build approval was
changed. Sanitized command records and log digests are in
[preflight.json](evidence/preflight.json).

## Not executed and not accepted

Application lint/typecheck/unit/build beyond the normal contracts install hook,
real PostgreSQL/Redis/storage/scanner acceptance, real Stripe/manual financial
acceptance, R37 harness tests, hosted scans/load/fault injection, two hosted
replicas, browser/AR/EN/RTL/mobile/keyboard/private-preview scenarios, screenshot
review, real on-call receipt and deployed-source/image matching: **NOT RUN**.
No target network test was made. No application is deployed by this work.

GitHub final-PR CI and official CodeQL must be checked against the actual final
head; their results are reported in the PR, not copied from PR #198. Green
documentation checks cannot accept G3/R37 or remove policy/external holds.
Current repository-wide CodeQL/Dependabot/secret-alert inventory requires an
authorized source; historical counts or a successful new scan cannot replace it.
Final hosted image scans, including unfixed High/Critical findings, remain absent.

The PR remains Draft while required implementation and real hosted evidence are
missing. Missing/pending/failed/cancelled/skipped evidence is never counted as
passed. No runtime or schema rollback is needed for the documentation itself.
