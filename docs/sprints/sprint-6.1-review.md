# Sprint 6.1 Review Report — Admin User Control

## 1. Planning Summary

- **Scope:** Admin can list / search / suspend / restore users.
  Soft-delete is NOT exposed (reserved for the user themselves via
  the deactivate-my-account flow). Every mutation writes an
  AuditEvent attributed to the calling admin.
- **Existing files inspected:** UserRepository, schema.prisma
  AuditEventType enum, AdminAuditService.
- **Risks found:** the `AuditEventType` enum needed new values; the
  Prisma client could not be regenerated in this environment because
  the dev `nest start --watch` process holds a Windows lock on the
  query-engine DLL. Mitigated with `as AuditEventType` casts in code
  - a forward-only migration that the next clean dev start picks up.

## 2. Implementation Summary

- **Migration added:** `20260502000000_add_admin_audit_event_types/migration.sql`
  — `ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ADMIN_USER_SUSPENDED'`
  - 7 sibling values for the upcoming admin sprints.
- **Schema added:** new enum values in `schema.prisma`.
- **Files added:**
  - `packages/contracts/src/admin/users/{request,response,index}.ts`:
    `AdminUserStatus`, `ListAdminUsersQuery`, `AdminUserSummary`,
    `ListAdminUsersResponse`, `AdminUserMutationResponse`.
  - `apps/api/src/modules/admin/users/dto/list-admin-users.query.ts`
  - `apps/api/src/modules/admin/users/admin-users.controller.ts`
  - `apps/api/src/modules/admin/users/admin-users.service.ts`
  - `apps/api/src/modules/admin/users/admin-users.service.spec.ts`
- **Files changed:**
  - `apps/api/src/infrastructure/persistence/iam/user.repository.ts`
    — `searchForAdmin` (case-insensitive `q`, status + role filters,
    cursor pagination).
  - `apps/api/src/modules/admin/admin.module.ts` — register
    AdminUsersController + AdminUsersService.
  - `packages/contracts/src/admin/index.ts` — re-export users barrel.
  - `postman/hsm-admin.postman_collection.json` — folder
    `20 — Users (Sprint 6.1)` with list / search / detail /
    suspend / restore.
- **API endpoints added:**
  - `GET  /v1/admin/users?q&status&role&limit&cursor`
  - `GET  /v1/admin/users/:userId`
  - `POST /v1/admin/users/:userId/suspend` — refuses self-suspend
    (400 VALIDATION_ERROR) and writes `ADMIN_USER_SUSPENDED` audit row.
  - `POST /v1/admin/users/:userId/restore` — writes
    `ADMIN_USER_RESTORED` audit row.

  All read + write paths guarded by JwtAuthGuard + RolesGuard('admin');
  mutations also require CsrfGuard.

## 3. Automated Tests

| Check                                                   | Result                         |
| ------------------------------------------------------- | ------------------------------ |
| `prisma validate`                                       | pass                           |
| `pnpm --filter @homeservicemarketplace/contracts build` | pass                           |
| `pnpm --filter @homeservicemarketplace/api typecheck`   | pass                           |
| `pnpm --filter @homeservicemarketplace/api test`        | pass — 624 (+6 new), 6 skipped |

Six new unit tests in `admin-users.service.spec.ts` cover: list,
detail-not-found, suspend writes audit, refuses self-suspend,
restore writes audit, and "summary excludes passwordHash + mfaSecret"
security projection.

## 4. Postman Tests

- New folder `20 — Users (Sprint 6.1)` (5 requests): list, search,
  detail, suspend, restore. Captures `userId` from the list output
  for the follow-on tests.

## 7. Remaining Issues

- The Prisma client in this dev environment can't be regenerated
  while the long-running `nest start --watch` process holds the DLL.
  The migration applies cleanly on a fresh dev shell; the casts in
  code prevent compile errors until the regenerate runs.

No blocking issues.

## 8. Sprint Decision

**PASS** — Continue automatically.
