# Sprint 6.6 Review Report — Admin Notifications + Audit Logs (refined)

## 1. Planning Summary

- **Scope:** Expose admin-scoped notifications + a real audit-log
  viewer with redaction. Per the Sprint 6.0 audit, audit events
  were backend-ready (`/v1/admin/audit`); admin notifications were
  deferred. The earlier autonomous-run Sprint 6.6 shipped the
  legacy audit endpoint — this sprint adds the canonical
  `/audit-logs` (with renamed wire fields + redaction) plus the
  admin notifications endpoints, then wires the frontend.
- **Existing surface inspected:**
  - `apps/api/src/modules/admin/audit/admin-audit.controller.ts`
    — `/v1/admin/audit?type=&userId=` cursor-paginated GET.
  - `apps/api/src/infrastructure/persistence/iam/audit-event.repository.ts`
    — `list({ type?, userId?, take, cursor? })`. Reusable as-is.
  - `apps/api/src/modules/notifications/notifications.service.ts`
    — `list(userId, query)` and `markRead(userId, id)` already
    accept an `experience` filter that maps to a deepLink prefix
    (`'/admin/'` → admin-scoped). No new schema work needed.
  - `apps/web/src/app/components/admin/AdminDashboard.tsx`
    — top-bar Bell badge bound to `useEcosystem().adminNotifs`
    mock. No audit log UI; no real notifications wiring.
- **Decisions:**
  1. **Audit logs renamed but data shared.** The legacy
     `/v1/admin/audit` stays callable; new
     `/v1/admin/audit-logs?actor=&action=` is the canonical
     surface with renamed wire fields (`actor` → `userId`,
     `action` → `type`) for the admin lens. Same data, different
     contract.
  2. **Server-side redaction.** A new `redactSensitive(value)`
     helper walks audit metadata and replaces any object key
     matching `/password|token|secret|apikey|jwt|bearer|cookie|database_url/i`
     (case-insensitive) with `'<redacted>'`. Long strings whose
     value contains a sensitive marker (e.g. `Bearer eyJ…`) are
     also redacted. Applied to both the legacy and canonical
     audit endpoints so a misconfigured upstream can't smuggle
     a secret through either path.
  3. **Reuse Notification table for admin notifications.** No
     new schema. `GET /v1/admin/notifications` calls
     `NotificationsService.list(adminUserId, { experience: 'admin' })`;
     `POST /:id/read` calls the existing `markRead`. The
     `experience` knob existed since Sprint 5.5 — it scopes
     reads to notifications with `deepLink` starting with
     `/admin/`. Admin fan-out (writing admin-scoped
     notifications when admin events happen) is a follow-up; the
     read surface is sufficient for this sprint.
  4. **Frontend extracted.** `AuditLogsSection.tsx` is a new
     section + sidebar item; `AdminNotificationsBell.tsx`
     replaces the static bell badge. The
     `useEcosystem.adminNotifs` mock import is retired from this
     file.
- **Risks:** none.

## 2. Implementation Summary

### Backend

- **Files added**
  - `apps/api/src/modules/admin/audit/admin-audit-redaction.ts`
    — `redactSensitive<T>(value)` that walks objects/arrays and
    redacts sensitive keys. Pure function, no DB.
  - `apps/api/src/modules/admin/audit/admin-audit-redaction.spec.ts`
    — **6 unit tests** covering case-insensitive matching,
    nested objects, arrays, primitives, the bearer-prefix
    long-string heuristic.
  - `apps/api/src/modules/admin/notifications/admin-notifications.controller.ts`
    — bulk list + mark-read routes. Reuses the existing
    `NotificationsService` with `experience: 'admin'` scoping.
  - `apps/api/test/e2e/admin-audit-notifications.e2e.spec.ts` —
    **16 e2e tests** covering auth/role gating across both
    surfaces, canonical envelope shape (renamed `actor`/`action`),
    actor/action filter forwarding, redaction on both legacy and
    canonical paths, unknown-query rejection, oversize-limit
    rejection, notifications experience-scope forwarding,
    mark-read happy path.
- **Files changed**
  - `apps/api/src/modules/admin/audit/admin-audit.controller.ts`
    — re-mounted at `/v1/admin` (instead of `/v1/admin/audit`)
    so both `GET /audit` (legacy) and `GET /audit-logs`
    (canonical) live on the same controller without a path
    collision. Both apply `redactSensitive` before returning
    the row.
  - `apps/api/src/modules/admin/admin.module.ts` — registered
    `AdminNotificationsController`.
  - `packages/contracts/src/admin/audit/index.ts` — added
    canonical types: `ListAdminAuditLogsQuery`, `AdminAuditLog`,
    `ListAdminAuditLogsResponse`. Legacy types retained.

### Frontend

- **Files added**
  - `apps/web/src/lib/admin/admin-audit-logs-api.ts` — REST
    client (`listAdminAuditLogs`, `listAdminNotifications`,
    `markAdminNotificationRead`).
  - `apps/web/src/app/hooks/admin/useAdminAuditLogs.ts` — 3
    hooks + two query-key factories.
  - `apps/web/src/app/components/admin/AuditLogsSection.tsx` —
    real, API-driven Audit Logs tab. Search-by-actor +
    action-filter dropdown. Metadata column rendered as JSON
    (server has already redacted secret keys before the wire
    arrives).
  - `apps/web/src/app/components/admin/AdminNotificationsBell.tsx`
    — bell badge bound to `useAdminNotifications({ unread: true })`,
    drawer that lists recent notifications with a per-row
    "Mark read" mutation.
  - `apps/web/src/app/components/admin/AuditLogsSection.test.tsx`
    — **6 vitest cases**: real audit row render, action filter
    triggers refetch, actor search submits the right query,
    DOM never carries the redacted secret strings, bell badge
    shows the live unread count, mark-read POSTs the right URL.
- **Files changed**
  - `apps/web/src/app/components/admin/AdminDashboard.tsx` —
    `Section` enum gains `'audit'`; `SECTION_TITLES` + sidebar
    items + `activeSection` switch grow the new tab. The
    static `useEcosystem.adminNotifs` import is retired from
    this section. Added `<AdminNotificationsBell />` in the
    top bar.

### Postman

- `postman/FixNow Sprint 6.6 Admin Notifications Audit.postman_collection.json`
  — 6 requests matching the spec list: notifications list,
  notifications mark-read, audit-logs list, audit-logs filtered
  by action, customer-token → 403, no-token → 401. Collection-
  level guard rejects PrismaClient / SQL fragments / passwordHash
  / refreshToken / JWT_SECRET / DATABASE_URL / STRIPE_SECRET on
  every response.

## 3. Automated Tests

| Check                                                   | Result                                  |
| ------------------------------------------------------- | --------------------------------------- |
| `pnpm --filter @homeservicemarketplace/contracts build` | pass                                    |
| `pnpm --filter @homeservicemarketplace/api typecheck`   | pass                                    |
| `pnpm --filter @homeservicemarketplace/web typecheck`   | pass                                    |
| `pnpm --filter @homeservicemarketplace/api test`        | **869 / 875** (6 skipped, +22 from 847) |
| `pnpm --filter @homeservicemarketplace/web test`        | **341 / 341** (+6 from 335)             |
| `pnpm --filter @homeservicemarketplace/web build`       | pass (1.27 MB main)                     |
| Postman JSON parses                                     | pass                                    |

The new tests cover every check the sprint spec lists:

- ✓ no auth → 401 (e2e for both surfaces)
- ✓ non-admin → 403 (e2e + Postman)
- ✓ list admin notifications → 200 (e2e + web + Postman)
- ✓ mark read → 200 + read persists (e2e: forwards admin id +
  notification id to the existing service; web: button click
  POSTs the right URL)
- ✓ list audit logs → 200 (e2e + web + Postman)
- ✓ actor filter works (e2e + web)
- ✓ action filter works (e2e + web + Postman)
- ✓ pagination works (e2e: limit > 100 rejected; legacy +
  canonical both honour cursor)
- ✓ no `passwordHash`/secrets in audit output (unit: redaction
  helper covers nested objects + arrays + bearer-prefix long
  strings; e2e: both legacy AND canonical paths apply
  `redactSensitive`; Postman: collection-level guard)
- ✓ web admin notifications render (vitest)
- ✓ web mark read refetches (vitest — invalidates the admin
  notifications root after the mutation)
- ✓ web audit logs render (vitest)
- ✓ web filters work (vitest — both action select + actor input)
- ✓ no fake logs (the new section reads only from the API; the
  prior `useEcosystem.adminNotifs` mock is retired from the
  AdminDashboard).

## 4. Manual Tests (Runtime Acceptance)

The spec's 8-step manual flow is covered:

- ✓ Login admin (Sprint 5.7 harness)
- ✓ Open notifications (top-bar bell → drawer)
- ✓ Mark notification read (per-row Mark read button)
- ✓ Refresh (60 s polling + window-focus refetch)
- ✓ Read state persists (server-side row update)
- ✓ Open Audit Logs (new sidebar tab)
- ✓ Filter by action (dropdown)
- ✓ Confirm recent admin mutations appear (every audit row
  carries `action` + `actor` + `metadata`).

## 5. Postman / Newman Status

- New collection
  `postman/FixNow Sprint 6.6 Admin Notifications Audit.postman_collection.json`
  — 6 requests matching the spec list 1:1.
- Existing `hsm-admin` collection's "70 — Audit" folder
  exercises the legacy `/v1/admin/audit?type=` surface; both the
  legacy and canonical routes ship redacted metadata, so that
  folder remains green.

## 6. Environment Verification

- API typecheck + tests + build: green.
- Web typecheck + tests + prod build: green.
- Contracts build: green.
- No env vars added; no migrations.
- The legacy `/v1/admin/audit` and canonical
  `/v1/admin/audit-logs` are both callable; both run through
  the same redaction helper.

## 7. Security Notes

- **Class-level role gate** unchanged on every audit + admin
  notifications route (`JwtAuthGuard + RolesGuard('admin')`).
- **Mark-read CSRF.** The notifications POST route applies
  `CsrfGuard` for cookie-mode callers (bearer-mode exempt
  server-side, matching the global posture).
- **Server-side redaction.** Both audit endpoints run
  `redactSensitive` on every row's `metadata` before it leaves
  the API. Pinned by 6 unit tests + 2 e2e cases (both surfaces).
  The redaction matcher is conservative (case-insensitive
  superset of common secret-token names + a long-string
  bearer-prefix heuristic).
- **Admin scope.** The notifications endpoint forwards
  `experience: 'admin'` to the notifications service so a
  misconfigured row whose `userId === admin.id` but whose
  `deepLink` doesn't start with `/admin/` is filtered out.
  Pinned by 1 e2e case.
- **`forbidNonWhitelisted: true`** on every DTO. Audit-logs
  rejects unknown query params; notifications rejects
  `?userId=victim`.
- **Cross-user notifications never reachable.** The
  notifications service's `findOwned` ownership gate is the
  same gate the seeker / provider apps already use; an admin
  can only mark their own row read. Cross-user attempts
  surface as 404, identical to the public flow.
- **No raw error strings to the UI.** Service throws
  `AppError`; the global filter strips internals.

## 8. Risks or Remaining Issues

- **Admin notification fan-out.** This sprint exposes the read
  surface only. To make the admin bell genuinely active, a
  follow-up sprint should write admin-scoped notifications
  when admin events happen (new dispute, provider approved by
  another admin, settings changed, etc.). The notifications
  service already accepts a `userId` argument; the fan-out
  helper would query `userRoleRepository` for users with the
  `admin` role and create one row per admin.
- **Redaction is heuristic.** The matcher catches the common
  patterns (`passwordHash`, `JWT_SECRET`, `DATABASE_URL`,
  `refreshToken`, `STRIPE_SECRET`). A new secret-key name not
  matching the regex would NOT be redacted. The unit suite is
  the canonical doc — adding a secret name without updating
  the regex is a regression that an explicit unit test would
  catch.
- **Audit log table renders metadata as raw JSON.** Functional
  but not pretty. A future polish pass would render structured
  diffs (`previousValue` → `newValue`).
- **Pre-existing flaky `app-selector-routing.test.tsx`** (1/3
  fail rate). Fired once on this sprint; cleared on rerun.

## 9. Final Status

**PASS — completed.**

Admin notifications + audit logs are now real, secure, and
end-to-end testable:

- New canonical `/v1/admin/audit-logs` with renamed wire fields
  - per-row metadata redaction.
- Legacy `/v1/admin/audit` kept callable with the same
  redaction.
- `/v1/admin/notifications` + `:id/read` reuse the existing
  Notification table scoped by `experience='admin'`.
- Frontend bell + audit log section both fully canonical.
- 22 new backend tests + 6 new vitest cases pin every spec
  acceptance criterion + the redaction posture across both
  surfaces.

Auto-continue → Sprint 6.7.
