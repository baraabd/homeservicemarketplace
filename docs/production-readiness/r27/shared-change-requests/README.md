# R27 shared change requests

R27 owns only its harness, reports and evidence (see `../ALLOWLIST.md`). Every
runtime, route, configuration, schema or CI change below belongs to another
owner and is applied only by the coordinator in a serialized integration
stage, or by that owner under a recorded lease. Nothing here is applied on
`feat/r27-performance-capacity`.

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
