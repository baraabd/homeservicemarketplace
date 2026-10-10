# R18 — Execution plan and record

Branch `release/r18-functional-completion-rc1`, worktree `../HSM-r18`, base
`develop@fabeb07`. Delivery mode: A (integration and release certification).
Product fixes go to focused prerequisite PRs, not this PR.

| Gate | Step                                                                     | State                                                                               |
| ---- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| 0    | PR #149 merged by the owner as `fabeb07`; six post-merge workflows green | done (`FUNCTIONAL_ACCEPTANCE.md`)                                                   |
| 1    | Baseline recorded; R17 acceptance reconciled (`r17/ACCEPTANCE.md`)       | done                                                                                |
| —    | Release scope frozen for owner approval                                  | `RELEASE_SCOPE.md` (awaits approval)                                                |
| —    | Product truth inventory                                                  | `PRODUCT_TRUTH_INVENTORY.md`; fixes in #151 (merged) and #152 (Draft)               |
| —    | Acceptance matrix                                                        | `ACCEPTANCE_MATRIX.md`                                                              |
| —    | Real cross-role journey + fail-closed CI gate                            | this PR; first hosted run pending                                                   |
| —    | Security                                                                 | `SECURITY_ACCEPTANCE.md`; CodeQL #2 awaits the owner                                |
| —    | Branch protection                                                        | `BRANCH_PROTECTION_EVIDENCE.md`; payload for the owner                              |
| —    | Environments, staging, backups, observability, performance               | `ENVIRONMENT_MATRIX.md` and companions: HOSTED_ENVIRONMENT_BLOCKED                  |
| —    | Runbooks                                                                 | `DEPLOYMENT_RUNBOOK.md`, `ROLLBACK_RUNBOOK.md`, `INCIDENT_RUNBOOK.md` (unrehearsed) |
| —    | Release candidate                                                        | `RELEASE_MANIFEST.json`: NOT_BUILT                                                  |
| —    | Decision                                                                 | `GO_NO_GO.md`: NO-GO, `R18_BLOCKED`                                                 |

## Not done, and why

- No merge of this PR: `R18_MERGE_APPROVED` is absent.
- No deployment, tag, registry push, DNS, branch-protection change or CodeQL
  dismissal: each needs an owner authorization or target that does not exist.
- No local run of the R18 browser journey: the host has about 0.7 GB free.

## Next owner actions, in order

1. Merge #152 once its CI is green; this branch is then refreshed by a merge
   of `develop`.
2. Decide D-2, D-3, D-8, D-13, D-19 (`BLOCKERS.md`).
3. Dispose of CodeQL #2; apply the branch-protection payload.
4. Approve `RELEASE_SCOPE.md`.
5. Supply a staging target (`infra/production/STAGING.md`); then build the
   RC once, deploy to staging, and run `HOSTED_STAGING_ACCEPTANCE.md`.
