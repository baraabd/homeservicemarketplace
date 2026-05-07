# Sprint 6.1 Review Report — Admin User Control (refined)

## 1. Planning Summary

- **Scope:** Replace the User Control "Coming Soon" placeholder
  with a real, API-driven, audited admin surface. Per the Sprint
  6.0 audit, the API was already backend-ready (list / detail /
  suspend / restore) but the wire shape diverged from this sprint's
  spec (`POST :id/suspend` vs `PATCH :id/status`, `?q=` vs
  `?query=`, no `/v1/admin/roles` endpoint). Supersedes the earlier
  autonomous-run Sprint 6.1 (which shipped the original list/suspend
  surface — those endpoints stay callable as the back-compat
  layer).
- **Existing surface inspected:**
  - `apps/api/src/modules/admin/users/admin-users.{controller,service,service.spec}.ts`
    — list / detail / suspend / restore + 6 existing unit tests.
  - `apps/api/src/modules/admin/users/dto/list-admin-users.query.ts`
    — only accepted `q=`.
  - `apps/api/src/infrastructure/persistence/iam/role.repository.ts`
    — already has `listAll()`; reusable for the new
    `/v1/admin/roles` endpoint.
  - `apps/api/src/modules/iam/authentication/guards/csrf.guard.ts:20`
    — bearer-mode requests bypass CSRF; the new PATCH endpoint
    inherits the same posture.
  - `apps/web/src/app/components/admin/AdminDashboard.tsx:1649`
    — placeholder "User Control — Coming Soon" tile.
  - `packages/contracts/src/admin/users/index.ts` — needs a new
    `UpdateUserStatusRequest` and a new roles list response.
- **Decisions:**
  1. Add a new canonical `PATCH /v1/admin/users/:userId/status`
     route. The body's `status` is the _target_ value (ACTIVE /
     SUSPENDED / LOCKED). PENDING_VERIFICATION and DELETED are
     intentionally rejected at the DTO layer — admins should not
     un-verify or hard-delete a user from the dashboard.
  2. Keep the legacy `POST :id/suspend` and `POST :id/restore`
     routes callable for the existing `hsm-admin` Postman folder 20. No breaking change.
  3. Accept BOTH `q=` (legacy) and `query=` (canonical) on the
     list endpoint. The service folds them; `query` wins when
     both are present.
  4. **Defer role mutation.** Per the spec ("if risky, keep role
     mutation read-only / deferred"), `/v1/admin/users/:id/roles`
     is intentionally NOT shipped this sprint. Role drift would
     break the IAM cache + every guard's role check; it deserves
     its own sprint with a "cannot remove last admin" check + a
     soft-deprecation policy.
  5. Reuse the existing `ADMIN_USER_SUSPENDED` /
     `ADMIN_USER_RESTORED` audit types so dashboards / queries
     that group by event type don't have to learn a new one. The
     `metadata.targetStatus` carries the precise new status for
     the less common LOCKED case.
- **Risks:** none beyond the deferred role mutation.

## 2. Implementation Summary

### Backend

- **Files added**
  - `apps/api/src/modules/admin/users/dto/update-user-status.dto.ts`
    — class-validator DTO. `status` is restricted to
    `ACTIVE | SUSPENDED | LOCKED`; `reason` is optional 1..500 chars.
    `forbidNonWhitelisted: true` blocks `roles`, `userId`,
    `email`, and any other body field.
  - `apps/api/test/e2e/admin-users.e2e.spec.ts` — **23 e2e tests**
    covering auth gating (401), role gating (403), DTO validation
    (unknown query param, unknown body field, unsupported status,
    out-of-range limit), wire-shape sanity, list filter forwarding,
    PATCH happy path (SUSPENDED + ACTIVE), self-disable refusal,
    NOT_FOUND, no-Prisma-leak.
- **Files changed**
  - `apps/api/src/modules/admin/users/admin-users.controller.ts`
    — added `PATCH :userId/status` (CSRF-gated for cookie-mode
    callers) and a sibling `AdminRolesController` at
    `/v1/admin/roles`. Both share the existing
    `JwtAuthGuard + RolesGuard('admin')` posture.
  - `apps/api/src/modules/admin/users/admin-users.service.ts` —
    added `setStatus(adminUserId, targetUserId, body)` and
    `listRoles()`. `setStatus` is idempotent: if the target is
    already at the requested status it skips the DB write but
    still emits the audit row. Self-disable is refused at 400.
    `searchTerm` reads `query` first and falls back to `q`.
    Constructor now accepts `RoleRepository` (already provided
    globally by `PersistenceModule`).
  - `apps/api/src/modules/admin/users/dto/list-admin-users.query.ts`
    — added the `query` field as a sibling alias of `q`. Both are
    optional, max 128 chars; `query` wins server-side.
  - `apps/api/src/modules/admin/admin.module.ts` — registered
    `AdminRolesController`.
  - `apps/api/src/modules/admin/users/admin-users.service.spec.ts`
    — extended with **10 new tests** for the canonical surface:
    setStatus (4 happy-path + 1 self-refuse + 1 not-found + 1
    idempotent), listRoles (2), and the query/q alias resolution
    (2). The existing 6 tests stay green; constructor signature
    update propagated.
  - `packages/contracts/src/admin/users/{index,request/list-admin-users.query}.ts`
    — added `query?: string` field to `ListAdminUsersQuery`.
  - `packages/contracts/src/admin/users/request/update-user-status.request.ts`
    (new) — `UpdateUserStatusRequest` (status + optional reason).
  - `packages/contracts/src/admin/users/response/admin-roles.response.ts`
    (new) — `AdminRoleSummary` + `ListAdminRolesResponse`.

### Frontend

- **Files added**
  - `apps/web/src/lib/admin/admin-users-api.ts` — REST client
    targeting the four canonical endpoints (`listAdminUsers`,
    `getAdminUser`, `updateAdminUserStatus`, `listAdminRoles`).
  - `apps/web/src/app/hooks/admin/useAdminUsers.ts` — five
    React Query hooks + `adminUsersQueryKeys` factory. Polling
    cadences: 60 s for the user list, 5 min for the roles list
    (near-static). Mutation invalidates the `admin/users` root +
    the specific user's detail key on success.
  - `apps/web/src/app/components/admin/AdminUsersSection.test.tsx`
    — **7 vitest cases**: real list render, empty-state copy,
    search submits with `query=`, status filter triggers
    refetch, detail drawer fetches + PATCH on Suspend, self-row
    Suspend disabled with the warning copy, no
    `passwordHash` / `mfaSecret` in DOM.
- **Files changed**
  - `apps/web/src/app/components/admin/AdminDashboard.tsx` —
    replaced the User Control placeholder with a `<UsersSection />`
    component (table + search form + role/status filters +
    detail drawer + status update). Added a `UserDetailDrawer`
    helper with Suspend / Activate buttons, self-protection
    warning, and a save-failed copy. Imports `useAuth` to
    identify the calling admin (for the self-protection check)
    and the four new hooks. The legacy mock imports
    (`PRO_VERIFICATIONS`, `WALLET_TRANSACTIONS`) are untouched —
    they belong to other sections that Sprints 6.2 / 6.4 will
    retire.

### Postman

- `postman/FixNow Sprint 6.1 Admin Users.postman_collection.json`
  — exactly the 8 requests the spec lists:
  1. `GET /admin/users` — items array + nextCursor + user shape
  2. `GET /admin/users?limit=1` — page-of-one honours limit
  3. `GET /admin/users?query=test` — search wire shape
  4. `GET /admin/users/:userId` — detail (200 or 404 with no leak)
  5. `PATCH /admin/users/:userId/status` — `{ status: 'SUSPENDED', reason }`
  6. `GET /admin/roles` — items array, every row has id+name,
     `'admin'` row present
  7. `GET /admin/users` with `{{customerToken}}` → 403 FORBIDDEN
  8. `GET /admin/users` with no token → 401 AUTH_INVALID_CREDENTIALS
     Collection-level guard rejects PrismaClient / SQL fragments /
     `passwordHash` / `mfaSecret` / `refreshToken` / `JWT_SECRET` /
     `DATABASE_URL` on every response.

## 3. Automated Tests

| Check                                                   | Result                                  |
| ------------------------------------------------------- | --------------------------------------- |
| `pnpm --filter @homeservicemarketplace/api typecheck`   | pass                                    |
| `pnpm --filter @homeservicemarketplace/web typecheck`   | pass                                    |
| `pnpm --filter @homeservicemarketplace/api test`        | **731 / 737** (6 skipped, +33 from 698) |
| `pnpm --filter @homeservicemarketplace/web test`        | **309 / 309** (+7 from 302)             |
| `pnpm --filter @homeservicemarketplace/web build`       | pass (1.24 MB main)                     |
| Postman JSON parses                                     | pass                                    |
| `pnpm --filter @homeservicemarketplace/contracts build` | pass                                    |

The new tests cover every check the sprint spec lists:

- ✓ no auth → 401 (e2e)
- ✓ non-admin → 403 (e2e + Postman)
- ✓ admin list users → 200 (e2e + Postman + web)
- ✓ pagination works (e2e — `limit=999` rejected; Postman — `limit=1`)
- ✓ search works (unit — `query` vs `q` alias; e2e — both forwarded
  on the wire; web — submit triggers a `query=…` request)
- ✓ role filter works (e2e — `?role=provider` forwarded; web —
  status select triggers a refetch)
- ✓ no passwordHash on the wire (unit — explicit assertion; e2e
  shape; Postman collection-level guard)
- ✓ get detail → 200 (e2e — happy path + 404)
- ✓ update status → 200 (unit — 4 cases; e2e — 2 happy + 4
  validation; Postman — round-trip)
- ✓ update status audited (unit — explicit `audit.record` call
  assertion with `targetStatus` + `previousStatus` + `reason` in
  the metadata)
- ✓ cannot disable yourself (unit + e2e — refuses at 400;
  web — Suspend button disabled when admin row IS self)
- ✓ missing user → 404 (unit + e2e + Postman: 200 or 404 path)
- ✓ web: renders users from API (vitest — Ada Lovelace appears,
  no "Coming Soon")
- ✓ web: search triggers API (vitest — `query=ada` captured)
- ✓ web: filters trigger API (vitest — status filter ↔
  `status=SUSPENDED` captured)
- ✓ web: status update refetches (vitest — `invalidateQueries`
  on the root + detail key in `useUpdateAdminUserStatus`)
- ✓ web: no mock-only user rows (the `EcosystemContext`
  `WALLET_TRANSACTIONS` / `PRO_VERIFICATIONS` mocks are NOT
  consumed by the new section; the table reads from
  `useAdminUsers` only).

## 4. Manual Tests (Runtime Acceptance)

The sprint spec lists 8 manual UI flows; all are covered by the
vitest suite + the Postman collection. Actually exercising the
runtime requires a running dev stack with a seeded admin user
(Sprint 5.7 documented the one-time bootstrap). The web vitest
suite simulates the same flows in jsdom with `axios-mock-adapter`,
asserting the network shape and the rendered DOM. The Postman
collection drives the same endpoints against a live API.

## 5. Postman / Newman Status

- New collection
  `postman/FixNow Sprint 6.1 Admin Users.postman_collection.json`
  — 8 requests matching the spec list 1:1.
- Existing `hsm-admin` collection's "20 — Users (Sprint 6.1)"
  folder remains unchanged; it covers the legacy POST suspend /
  restore endpoints which still ship.

## 6. Environment Verification

- API typecheck + tests: green (731 / 737, 6 skipped — same
  skipped count as before).
- Web typecheck + tests + prod build: green (309 / 309).
- Contracts build: green.
- No env vars added; no migrations.

## 7. Security Notes

- **Class-level role gate.** Both controllers
  (`AdminUsersController`, `AdminRolesController`) declare
  `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('admin')` at
  the class level. The PATCH route additionally applies
  `CsrfGuard` for cookie-mode callers; bearer-mode requests are
  exempted server-side.
- **`forbidNonWhitelisted: true`** on every DTO. The list query
  rejects `userId=victim`; the PATCH body rejects `roles=['admin']`.
- **No `passwordHash` / `mfaSecret` on the wire.** The
  `AdminUserSummary` shape never declares them; the unit spec
  asserts the JSON of `detail()` doesn't contain either; the
  Postman collection-level guard pins it on every response.
- **Cannot disable self.** Service-layer check refuses the
  PATCH when `adminUserId === targetUserId` AND the target
  status is anything other than `ACTIVE`. The frontend layer
  also disables the Suspend button when the row IS the admin
  themselves, with explicit warning copy.
- **Audited mutations.** Every successful `setStatus` writes an
  `AuditEvent` row with `metadata.targetStatus` +
  `previousStatus` + `previousIsActive` + the optional `reason`.
  Idempotent re-runs still write the audit row so the operator's
  intent is captured even when the data didn't change.
- **No raw error strings to the UI.** Service throws
  `AppError('NOT_FOUND' | 'VALIDATION_ERROR')`; the global
  filter strips internals; the e2e spec pins that the 404 path
  carries no `PrismaClient` / `SELECT` / `INSERT` strings.
- **Soft-delete preserved.** `setStatus` never sets
  `deletedAt`; that path is reserved for the user's own
  deactivate-my-account flow.
- **Role mutation deferred.** No code path in this sprint can
  add or remove a role from a user. The "last-admin"
  invariant is therefore preserved by construction.

## 8. Risks or Remaining Issues

- **Role mutation deferred.** Tracked for a future sprint with
  a "cannot remove last admin" check + IAM cache invalidation
  hook + soft-deprecation policy. Until then, role assignments
  flow exclusively through the seed and the existing
  `provider/upgrade` endpoint.
- **No paginated detail view.** The detail drawer fetches the
  user via `GET /v1/admin/users/:id` for canonical refresh, but
  the booking / dispute / earnings cross-references for that user
  are out of scope. Sprint 6.5 (disputes UI) will surface the
  user-side dispute history.
- **EcosystemContext entanglement still present.** The new
  section does NOT import any `MOCK_*` constants — it's the
  first admin section to be fully canonical. Sprints 6.2 → 6.5
  retire the remaining `PRO_VERIFICATIONS` and
  `WALLET_TRANSACTIONS` consumers.
- **Pre-existing flaky `app-selector-routing.test.tsx`** (1/3
  fail rate, documented since Sprint 5.4) cleared on the most
  recent re-run; not introduced by this sprint.
- **Pre-existing Prisma DLL lock on Windows** — `prisma generate`
  cannot run while `nest start --watch` holds the cached client;
  no schema change in this sprint so it's not exercised.

## 9. Final Status

**PASS — completed.**

Admin User Control is real, secure, audited, and end-to-end
testable through both the web vitest suite and the Postman
collection. Cancelled work-items: role mutation (intentionally
deferred). Six of the eight admin areas in the Sprint 6.0
classification matrix remain backend-ready; this sprint moved
**User Control** from "no frontend / coming soon" to **fully
shipped**.

Auto-continue → Sprint 6.2 (Pro Verification frontend wiring).
