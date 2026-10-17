# R27 shared change requests — current G1 continuation

Runtime and shared changes require the exact leases in `../G1_HANDOFF.json`;
R27 owns its measurement harness and evidence. On PR #173, CR-R27-01/02/03/05/08
are implemented within their recorded leases, and CR-R27-07/09 supply the
isolated CI/browser harness. Their G1 baseline/candidate measurements are in
`../../../performance/post-r18/FINDINGS.md`. Use the source, run and artifact
identities in `../ACCEPTANCE.md` to distinguish current evidence from history.

CR-R27-04 (private HTTP cache policy) and CR-R27-06 (completed-booking index)
remain proposals for their named owners. `CR-001-integration.md` specifies the
remaining budget decisions, populated-provider query review, financial fixture
and index work, and security/integration checks. No schema, migration, global
HTTP middleware, central registry or performance threshold is changed by that
request.

## Historical proposal inventory

The table below records the original pre-G1 proposals and evidence state. It
does not describe the current applied state of the leased R27 repairs. The
original patch copies are retained for audit; current application source and
`G1_HANDOFF.json` determine the implemented files and allowed scope.

| CR        | Target owner / path                                                              | Kind                    | Evidence state                                                     |
| --------- | -------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| CR-R27-01 | `apps/web/src/app/components/admin/AdminRouteContent.tsx`                        | lazy boundary           | bytes measured before/after (overlay build); timing hosted-pending |
| CR-R27-02 | `apps/web/src/app/components/profile/SavedAddressesPage.tsx`                     | lazy boundary           | bytes measured before/after (overlay build); timing hosted-pending |
| CR-R27-03 | `apps/api/src/infrastructure/mongo/**`, `apps/api/src/app.module.ts`             | conditional module load | boot CPU profile only; after-state not measured                    |
| CR-R27-04 | `apps/api/src/main.ts` (global middleware)                                       | cache headers (privacy) | headers measured on 17 reads; after-state not measured             |
| CR-R27-05 | `apps/api/src/infrastructure/persistence/requests/service-request.repository.ts` | query shape             | plan + DB time measured at 43k bids; after-state not measured      |
| CR-R27-06 | `packages/database/prisma/schema.prisma` + new migration (migration lane)        | index                   | plan measured; after-state not measured                            |
| CR-R27-07 | `.github/workflows/*` (CI)                                                       | run harness unit tests  | tests pass locally                                                 |
| CR-R27-08 | `apps/api/src/modules/admin/users/admin-users.service.ts` + repositories         | N+1 removal             | 52 statements for 15 rows measured; after not measured             |

Each directory holds a `README.md` with the reason, the exact patch (or the
patch outline when the change belongs to a lane with its own design
authority), tests to add, and rollback. The two web CRs also hold the full
proposed file used by `bundle-report.mjs --overlay`, so the byte effect can
be re-measured at integration without editing the tree.
