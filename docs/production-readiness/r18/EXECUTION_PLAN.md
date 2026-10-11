# R18 — Execution plan and record

Branch `release/r18-functional-completion-rc1`, historical base
`develop@fabeb07`, updated with `develop@ab7e473` (#152). Delivery mode: A
(integration and release certification). This PR includes the focused
active-offer repair reproduced by its real-service journey.

| Gate | Step                                                                     | State                                                                                        |
| ---- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 0    | PR #149 merged by the owner as `fabeb07`; six post-merge workflows green | done (`FUNCTIONAL_ACCEPTANCE.md`)                                                            |
| 1    | Baseline recorded; R17 acceptance reconciled (`r17/ACCEPTANCE.md`)       | done                                                                                         |
| —    | Release scope frozen for owner approval                                  | `RELEASE_SCOPE.md` (awaits approval)                                                         |
| —    | Product truth inventory                                                  | `PRODUCT_TRUTH_INVENTORY.md`; #151 and #152 merged; #152 integrated as `ab7e473`             |
| —    | Acceptance matrix                                                        | `ACCEPTANCE_MATRIX.md`                                                                       |
| —    | Real cross-role journey + fail-closed CI gate                            | repair and historical failures in `FUNCTIONAL_ACCEPTANCE.md`; current-head result on PR #153 |
| —    | Security                                                                 | `SECURITY_ACCEPTANCE.md`; CodeQL #2 awaits the owner                                         |
| —    | Branch protection                                                        | `BRANCH_PROTECTION_EVIDENCE.md`; payload for the owner                                       |
| —    | Environments, staging, backups, observability, performance               | `ENVIRONMENT_MATRIX.md` and companions: HOSTED_ENVIRONMENT_BLOCKED                           |
| —    | Runbooks                                                                 | `DEPLOYMENT_RUNBOOK.md`, `ROLLBACK_RUNBOOK.md`, `INCIDENT_RUNBOOK.md` (unrehearsed)          |
| —    | Release candidate                                                        | `RELEASE_MANIFEST.json`: NOT_BUILT                                                           |
| —    | Decision                                                                 | `GO_NO_GO.md`: NO-GO, `R18_BLOCKED`                                                          |

## Not done, and why

- No merge of this PR: the owner requested repair so they can merge it after
  its required current-head checks pass.
- No deployment, tag, registry push, DNS, branch-protection change or CodeQL
  dismissal: each needs an owner authorization or target that does not exist.
- The original local browser attempt was memory-blocked. The repair
  workspace has no Docker runtime; hosted CI supplies the complete
  browser/API/PostgreSQL journey, with local static and governance checks.

## Next owner actions, in order

1. Review PR #153 after its required current-head CI checks pass; #152 is
   already merged and integrated. Merge remains the owner's action.
2. Decide D-2, D-3, D-8, D-13, D-19 (`BLOCKERS.md`).
3. Dispose of CodeQL #2; apply the branch-protection payload.
4. Approve `RELEASE_SCOPE.md`.
5. Supply a staging target (`infra/production/STAGING.md`); then build the
   RC once, deploy to staging, and run `HOSTED_STAGING_ACCEPTANCE.md`.
