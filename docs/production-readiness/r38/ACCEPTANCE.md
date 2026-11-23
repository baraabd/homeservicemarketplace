# R38 — Preflight verification, not release acceptance

Decision: **NO-GO for starting R38 or certifying a release** under the current
G3 record. This is a preflight conclusion, not a completed Phase B evaluation.
Implementation remains **NOT_STARTED**. Source and scope are recorded in
[IMPLEMENTATION.md](IMPLEMENTATION.md) and [OWNERSHIP.md](OWNERSHIP.md).

## Executed local checks

Commands ran from the dedicated worktree using task-local Node **24.21.0**.
The official Node archive checksum was verified; the machine-wide runtime was
not changed. Existing tests and assertions were unchanged.

| Command                                          | Exit | Observed result                                                                                                                        |
| ------------------------------------------------ | ---: | -------------------------------------------------------------------------------------------------------------------------------------- |
| `node scripts/runtime/toolchain.cjs`             |    0 | Exact runtime and repository declarations pass.                                                                                        |
| `node .github/scripts/g3-record.mjs --check`     |    0 | Consistent records; G3, Wave 4 and the R38 final join remain BLOCKED.                                                                  |
| `node .github/scripts/g3-record.mjs --ready R38` |    1 | `FAIL R38 is not authorized to start`; expected refusal, not a passing readiness check.                                                |
| `node .github/scripts/production-governance.mjs` |    0 | Repository governance files pass; this does not verify GitHub protection.                                                              |
| `node .github/scripts/release-baseline.mjs`      |    0 | Existing source-backed baseline is consistent; sprint completion is not implied.                                                       |
| `node --test .github/scripts/*.test.mjs`         |    0 | **500 passed, 0 failed, 0 skipped, 0 cancelled, 0 todo** across 13 files. Existing governance tests, not new R38 implementation tests. |

The initial restricted-environment test run failed at four file wrappers out
of 13. A focused diagnostic showed unavailable child-process stdout/stderr.
The identical full command on the same source and pinned runtime, using the
approved execution environment, passed all 500 cases. No test, timeout,
assertion, gate or dependency was changed to obtain that result. The earlier
execution failure is retained in the machine-readable observation.

Scoped document formatting, JSON/reference/allowlist validation, diff review
and secret scanning are recorded in the final PR's verification section after
execution. Final PR CI and official CodeQL are verified separately against the
published documentation head; local tests cannot predict their result.

## Evidence boundaries

| Evidence category                                               | State and reason                                                                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| R38 collector/validator/rollout source                          | NOT_STARTED: accepted G3 and the implementation assignment are missing.                                                                         |
| Frozen workspace install; application lint/typecheck/build/unit | NOT_RUN / NOT_APPLICABLE to this documentation-only change. No dependencies or application source changed. Required once implementation starts. |
| PostgreSQL/Redis/storage integration                            | NOT_RUN. No services or fixture environment allocated. Source migration inventory is not database evidence.                                     |
| Stripe/manual financial acceptance                              | NOT_RUN by this task. Approved policy/operator inputs and authorized external evidence remain G3 prerequisites.                                 |
| Browser/AR/EN/RTL/mobile/keyboard                               | NOT_RUN; no UI changed and no screenshot inspected or claimed.                                                                                  |
| Hosted staging rehearsal                                        | NOT_RUN; no independently authorized target/configuration/evidence set supplied.                                                                |
| Final R34–R37 join                                              | INTEGRATION_PENDING; no frozen combined release candidate exists in the inspected record.                                                       |
| R16/R18 and live-money authorization                            | POLICY_BLOCKED; separate decisions and approvals remain required.                                                                               |
| Merge/deployment/live activation                                | NOT_PERFORMED.                                                                                                                                  |

The preflight fingerprint includes only reviewed non-secret source identifiers,
runtime/tool versions and gate states. There is no effective hosted runtime
fingerprint because no runtime was deployed or inspected. Git blob identities
bind the observed gate/plan/registry to the documentation parent. Final
documentation commit/tree and remote run IDs belong in PR metadata, avoiding
self-referential hashes and repeated commits merely to record their own IDs.

## Exit criteria still outstanding

First complete the seven unchanged G3 evidence categories on the actual
candidate, publish accepted G3 through the owner-reviewed merge, independently
verify that publication and assign the full frozen source plus exact R38 writer.
Then implement and test Phase A. Final release acceptance additionally requires
the joined Wave 4 evidence, approved scope and actual target-specific rehearsal.
This evidence-only PR must remain Draft while its requested R38 implementation
and required acceptance evidence are missing.
