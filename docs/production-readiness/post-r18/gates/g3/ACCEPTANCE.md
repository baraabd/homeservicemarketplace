# G3 acceptance inspection

**G3 BLOCKED; R34 NOT_STARTED.** No SANDBOX_ACCEPTED, HOSTED_ACCEPTED or
RELEASE_ACCEPTED claim is made. The repository's consistency validator accepting
this blocked record is not acceptance of the financial implementation.

Inspected source: `5ff2b7e6a46b4e42114184fac89928372f4c8d4c`.
Inspected tree: `54e00d4e9eaa7bd81146f01b69dfa9b396eab45c`.
The documentation PR's final SHA/tree are recorded in its body after commit.
Machine-readable remote observations, source file digests and non-secret runtime
fingerprint are in [evidence/preflight.json](evidence/preflight.json).

## Merge and remote check verification

GitHub reported owner merges for R30 #184, R31 #186, R32 #187 and R33 #185.
Local `git merge-base --is-ancestor <merge-SHA> HEAD` succeeded for all four
and the G2 publication. The R33 reviewed-head versus merged-source tree diff
was empty. No R29 branch or implementation PR was found, and the current source
contains neither its adapter nor its evidence directory.

The latest returned context for each `(check name, app)` on the final PR heads
was successful: #183 **38/38**, #184 **39/39**, and #185/#186/#187 **40/40**
each. Superseded governance runs include cancellations and are retained by ID
in the snapshot; they are not presented as successful executions. These are
historical PR-head observations, not the merged candidate's final verdict.

At the initial merged-source observation, 28 of 32 returned checks were successful
and four were running. A subsequent read showed 31 successful and one running.
The completed CI gate/R18 aggregate, exact-source R27 unchanged-budget acceptance
and official `github-advanced-security` CodeQL were not present in that inventory.
The successful `Analyze JavaScript/TypeScript` workflow does not replace the
separately required official CodeQL check. A newer final-PR inventory must be
verified before claiming any merge readiness.

The following counts were read from actual GitHub job logs on the inspected
merged source. They overlap and must not be summed:

| Run / job                            | Observation                                                              | Limit                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| CI `40015902423`, API `120628702267` | 5,272 passed; 1,856 skipped; 0 failed                                    | Default API profile; service skips are not passes                          |
| Same run, web `120628408718`         | 2,670 tests in 220 files passed                                          | Web unit verification                                                      |
| Same run, integration `120630277436` | 7,030 passed; 98 skipped; 0 failed; separate SQL-projection run 3 passed | Real PostgreSQL/Redis; not an independent Stripe settlement test           |
| Same run, R30 `120630277488`         | Service suite 16/16; browser harness 1/1; no failures/skips              | Manual operator simulation; retains explicit component test participants   |
| Same run, R31 `120630277643`         | 4/4 journeys; 20/20 screenshots reported                                 | Captures were not visually inspected by this task                          |
| Same run, Admin/R33 `120630277282`   | Admin 15 passed; R33 3 passed; seven wire documents checked              | Wire reports truthfully say reconciliation UNAVAILABLE; not R34 acceptance |

## Local commands and results

Commands ran in this task-owned worktree with Node **24.21.0**, pnpm
**10.32.1**, Prisma **6.12.0**. Node was checked against the official archive
SHA-256; pnpm against the SHA-512 pin in package.json. PATH changes were local
to each invocation. No global NVM change or shared node_modules was used.

| Exact command                                             | Result                                                                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                          | Exit 0, six workspace projects, 1,166 locked packages; normal preinstall/prepare hooks executed; lockfile unchanged |
| `pnpm --filter @homeservicemarketplace/database generate` | Exit 0, Prisma 6.12.0; isolated generated output and native engine smoke                                            |
| `pnpm --filter @homeservicemarketplace/api typecheck`     | Exit 0, including normal database/contracts builds                                                                  |
| `pnpm --filter @homeservicemarketplace/api lint`          | Exit 0                                                                                                              |
| `pnpm --filter @homeservicemarketplace/api build`         | Exit 0, including normal database/contracts builds                                                                  |
| `node --test scripts/security/secret-scan-tree.test.cjs`  | Exit 0, 7 passed, 0 failed/skipped; scanner-policy regression only                                                  |
| Selected Jest command below                               | Exit 0, 5 suites, **154 passed, 0 failed, 0 skipped**                                                               |
| `node --test .github/scripts/*.test.mjs`                  | Exit 0, **480 passed, 0 failed, 0 skipped/cancelled** on the final supplemental evidence tree                       |
| `node .github/scripts/g3-record.mjs --check`              | Exit 0; consistent BLOCKED record only                                                                              |
| `node .github/scripts/g3-record.mjs --ready R34`          | Exit **1**, expected: `R34 is not authorized to start`                                                              |
| `node .github/scripts/g2-record.mjs --check`              | Exit 0; existing accepted G2 source preserved                                                                       |
| `node .github/scripts/sprint-registry.mjs`                | Exit 0; registry consistency, not sprint acceptance                                                                 |
| `node .github/scripts/production-governance.mjs`          | Exit 0; local repository files only, not GitHub protection                                                          |
| `git diff --exit-code -- pnpm-lock.yaml package.json`     | Exit 0; pins and lockfile unchanged                                                                                 |

Selected Jest command (executed, no new assertions or test skips introduced):

```bash
pnpm --filter @homeservicemarketplace/api exec jest --runTestsByPath \
  src/modules/money/money.module.spec.ts \
  src/modules/money/adapters/manual/manual-rail.config.spec.ts \
  src/modules/money/refunds/refund-eligibility.policy.spec.ts \
  src/modules/money/subscriptions/subscription-activation.participant.spec.ts \
  src/modules/money/reporting/financial-report.service.spec.ts \
  --json --outputFile=/workspace/scratch/b3dda4f7b9ef/g3-money-tests.json
```

These existing tests substantiate the inspected module boundaries and fail-closed
defaults; they use unit doubles and do not establish returned funds or actual
combined financial acceptance. No application source was changed by this task.

## Failures, warnings and unrun checks

The initial diagnostic governance run also passed 480 tests on the host's Node
24.19.0, but it is not the pinned result above. Task-local archive extraction
first exited 2 because this single-UID host cannot assign the archive's UID;
re-extraction with `--no-same-owner` succeeded without changing code or checks.
Frozen install retained existing ignored-build-script warnings for
`@parcel/watcher` and `unrs-resolver`; no approval/configuration was bypassed.
Jest retained its existing ts-jest isolatedModules deprecation warning.
The first Gitleaks download did not follow the release redirect and produced an
empty file; checksum validation rejected it before extraction or execution.
The corrected download followed redirects and matched the unchanged repository
8.24.3 SHA-256 pin.

No local PostgreSQL, Redis, Docker, ClamAV or provider runtime was provisioned;
the host lacks the service executables and no external account was allocated.
The generation/typecheck invocation used a deliberately non-listening loopback
compile-only DSN; no database was contacted or user's .env copied. Local real
service/browser/security-container and external settlement tests were NOT_RUN.
The remote jobs above are separately attributed observations.

No new UI exists, and no screenshot was inspected in this task. AR/EN/RTL/mobile,
keyboard and finance-exception resolution are not claimed as R34 acceptance.
Matched payments, unmatched payments and unresolved exception severity counts
are **NOT_MEASURED**, not zero. Independent statements are missing, so a clean
reconciliation verdict would be false.

Formatting: `pnpm exec prettier --check docs/production-readiness/post-r18/gates/g3 docs/production-readiness/post-r18/ACTIVE_STATUS.md docs/production-readiness/post-r18/waves/WAVE_04.md` and `git diff --check` passed. Final normal-hook commit and exact tracked-tree secret scan results are recorded in the PR body. No source code was changed, so no new product tests were added.

The first committed-tree Gitleaks scan exited 1 with three generic-key findings
on the API log SHA-256 dictionary entries. These were recomputed log digests,
not credentials. The evidence now stores filename and SHA-256 in separate
fields. No scanner rule or ignore entry was changed. The corrected committed
tree must pass the same pinned scan; its result is recorded in the PR.

## Remaining acceptance and publication

The seven categories in REQUIREMENTS.md remain mandatory. Close the R29 and
refund-policy/consequence blockers, execute the actual combined application,
verify source-bound artifacts and all final checks, then prepare technical G3
acceptance. A separately owner-reviewed, merged and verified publication and
exact R34 session assignment are still required. This Draft PR changes no start
barrier or operational permission and does not authorize merge/deployment.

## Concurrent publication and transport boundary

GitHub inspection found existing Draft coordinator PR #189 while this task was
preparing publication. Its branch and four changed paths were left untouched.
This final supplemental diff has nine disjoint paths and preserves the original
canonical manifest. A separate normal local commit records that adjustment; no
force-push, rebase or peer source import occurs.

The direct Git push attempt exited 128 because no Git HTTPS username was
available. Publication uses the connected GitHub Git-data/PR tools with the
exact locally hook-checked and scanned tree. Remote commit identity is recorded
in the PR; the identical Git tree binds the locally verified file contents.
