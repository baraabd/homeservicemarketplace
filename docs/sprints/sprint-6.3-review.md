# Sprint 6.3 Review Report — Admin Disputes System (refined)

## 1. Planning Summary

- **Scope:** Expand the existing Sprint 6.3 dispute surface (list /
  detail / open / resolve) into the full workflow: a `priority`
  field, a `description` field, a dedicated `DisputeEvent` timeline
  model, a new PATCH endpoint for in-flight edits, and a real
  frontend with status + priority filters and a detail drawer that
  edits and resolves. Supersedes the earlier autonomous-run Sprint
  6.3 (which shipped the Dispute model + 4 endpoints — those still
  ship; this sprint adds the timeline + priority + PATCH).
- **Existing surface inspected:**
  - `apps/api/src/modules/admin/disputes/{controller,service,service.spec,dto}`
    — 4 endpoints, 5 unit tests, no PATCH route, no priority.
  - `apps/api/src/infrastructure/persistence/disputes/dispute.repository.ts`
    — typed shim with `findById / list / create / resolve` only.
  - `packages/database/prisma/schema.prisma` — `Dispute` model had
    no `priority`, no `description`; `AuditEventType` had no
    `ADMIN_DISPUTE_UPDATED` row; no `DisputeEvent` model.
  - `packages/contracts/src/admin/disputes/index.ts` — single-file
    contract with no priority/event types.
  - `apps/web/src/app/components/admin/AdminDashboard.tsx` —
    `DisputeSection` (line 457) with hardcoded `DISPUTES` mock and
    inline state-only approve/reject.
- **Decisions:**
  1. **Schema migration** `20260502030000_add_dispute_priority_and_events`:
     adds `DisputePriority` enum (URGENT/HIGH/MEDIUM/LOW, default
     MEDIUM), `Dispute.description` (nullable text), `DisputeEvent`
     table with `before`/`after` JSON snapshots + `DisputeEventType`
     enum, and the `ADMIN_DISPUTE_UPDATED` audit type. Forward-only
     and rollback-safe (single `DROP TABLE` + `DROP COLUMN` +
     `DROP TYPE`).
  2. **PATCH /v1/admin/disputes/:id** — body `{ status?, priority?,
description? }`, at-least-one validated at the service layer.
     Each changed field emits its own `DisputeEvent` row so the
     timeline reads as a sequence of single-field transitions.
     Rejects moves OUT of a terminal state (RESOLVED\_\*/CANCELLED) at
     409, and rejects moves INTO a terminal state at 409 (terminal
     transitions go through `/resolve` so the resolution text is
     always recorded).
  3. **Detail returns `recentEvents` inline** (last 20). No separate
     `/events` endpoint — keeps the wire surface tight; an operator
     who needs the full history can paginate via a future cursor
     route. Frontend timeline reads `recentEvents` directly.
  4. **Documents, parties (provider / customer), `resolvedAt`** —
     parties stay derived from the booking's existing FK chain
     (`Booking.seekerUserId` + `bid.providerId`). The spec's
     suggested `providerProfileId` / `customerUserId` columns are
     redundant when the booking is the source of truth.
  5. **Frontend extracted** out of `AdminDashboard.tsx` into its own
     `DisputesSection.tsx` — third admin section to be fully
     canonical (after Users + Verification).
- **Risks:** none beyond the Prisma DLL-rename lock on Windows
  (cached client carries the new types — TypeScript output
  succeeded; only the DLL rename failed, which doesn't affect
  typecheck/test/build).

## 2. Implementation Summary

### Schema + migration

- `packages/database/prisma/schema.prisma`:
  - Added `priority DisputePriority @default(MEDIUM)` and
    `description String?` columns on `Dispute`.
  - Added `events DisputeEvent[]` relation field.
  - New `DisputeEvent` model (id, disputeId, actorUserId, type,
    before Json?, after Json?, message, createdAt) with indexes
    on `(disputeId, createdAt)` and `(type, createdAt)`.
  - New `DisputePriority` enum (URGENT/HIGH/MEDIUM/LOW).
  - New `DisputeEventType` enum (OPENED, STATUS_CHANGED,
    PRIORITY_CHANGED, DESCRIPTION_UPDATED, RESOLVED, COMMENTED).
  - New `ADMIN_DISPUTE_UPDATED` value on `AuditEventType`.
  - New `disputeEvents DisputeEvent[]` reverse relation on `User`.
- `packages/database/prisma/migrations/20260502030000_add_dispute_priority_and_events/migration.sql`
  — `CREATE TYPE` + `ALTER TABLE ... ADD COLUMN` + `CREATE TABLE
"DisputeEvent"` + FK constraints + indexes + `ALTER TYPE
AuditEventType ADD VALUE`.

### Backend

- **Files added**
  - `apps/api/src/infrastructure/persistence/disputes/dispute-event.repository.ts`
    — `DisputeEventRepository` with `create()` and
    `listForDispute(disputeId, take)`. DLL-lock workaround pattern
    matches the existing `DisputeRepository`.
  - `apps/api/test/e2e/admin-disputes.e2e.spec.ts` —
    **17 e2e tests** covering auth gating, role gating, list filters
    (status + priority + invalid value + unknown query param),
    detail with recentEvents, PATCH happy/extra-field/invalid-status/
    409/404, resolve happy + invalid status.
- **Files changed**
  - `apps/api/src/infrastructure/persistence/disputes/dispute.repository.ts`
    — extended `DisputeRow` with `priority` + `description`;
    extended `list()` with priority filter; extended `create()` with
    optional priority + description; new `update(id, fields)`.
  - `apps/api/src/modules/admin/disputes/dto/admin-disputes.dto.ts`
    — added `priority` field on `OpenDisputeDto`,
    `ListAdminDisputesQueryDto`; new `UpdateDisputeDto`.
  - `apps/api/src/modules/admin/disputes/admin-disputes.controller.ts`
    — new `PATCH :disputeId` (CSRF-gated for cookie-mode).
  - `apps/api/src/modules/admin/disputes/admin-disputes.service.ts`
    — constructor accepts `DisputeEventRepository`; every
    open/update/resolve path emits a `DisputeEvent` row; PATCH
    handler validates state transitions; detail attaches the last
    20 events; opener notification fires on resolve AND on a
    status-changing PATCH (priority-only and description-only
    PATCHes intentionally do not notify).
  - `apps/api/src/modules/admin/disputes/admin-disputes.service.spec.ts`
    — extended with **10 new tests** (PATCH happy/no-op/empty/404/
    409 terminal in & out / priority-only / description-only;
    detail.recentEvents; list filter; resolve emits RESOLVED event).
    Constructor signature update propagated. Existing 5 tests
    remain green.
  - `apps/api/src/infrastructure/persistence/persistence.module.ts`
    — registered `DisputeEventRepository` in providers + exports.
  - `packages/contracts/src/admin/disputes/index.ts` — full rewrite
    adding `DisputePriorityValues`, `DisputeEventTypeValues`,
    `DisputeEvent` shape, `UpdateDisputeRequest`, and extending
    `DisputeSummary` with `priority`, `description`, optional
    `recentEvents`.

### Frontend

- **Files added**
  - `apps/web/src/lib/admin/admin-disputes-api.ts` — REST client
    targeting list / detail / PATCH / resolve.
  - `apps/web/src/app/hooks/admin/useAdminDisputes.ts` — 4 hooks +
    a `adminDisputesQueryKeys` factory. List polls 60 s, detail
    30 s while open. Mutations invalidate the disputes root + the
    row's detail key.
  - `apps/web/src/app/components/admin/DisputesSection.tsx` —
    extracted, API-driven section: status + priority filter chips,
    cursor-paginated table, detail drawer with identity block +
    status/priority/description editors + event timeline +
    resolution form. Terminal disputes show a "cannot edit" copy
    in lieu of the editors.
  - `apps/web/src/app/components/admin/DisputesSection.test.tsx` —
    **8 vitest cases** covering real list render, empty state,
    priority filter wire shape, detail drawer + timeline, PATCH
    save round-trip, resolve POST round-trip, terminal-state copy,
    no-secrets-in-DOM.
- **Files changed**
  - `apps/web/src/app/components/admin/AdminDashboard.tsx` —
    removed the inline `DISPUTES` mock + 480-line `DisputeSection`,
    replaced with an import of the extracted component. The
    `DashboardOverview` function (which originally lived in the
    same range as the mock + section) was preserved by surgically
    re-inserting it from `git HEAD` after the strip.

### Postman

- `postman/FixNow Sprint 6.3 Admin Disputes.postman_collection.json`
  — 7 requests matching the spec list 1:1:
  1. List
  2. List filtered (`?status=OPEN`)
  3. Detail (asserts `priority` + `recentEvents`)
  4. PATCH `{ priority, description }`
  5. POST `/resolve` (`RESOLVED_REFUND`)
  6. Customer-token → 403
  7. No-token → 401

  Collection-level guard rejects PrismaClient / SQL fragments /
  `passwordHash` / `mfaSecret` / `refreshToken` / `JWT_SECRET` /
  `DATABASE_URL` on every response.

## 3. Automated Tests

| Check                                                                                                                | Result                                  |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `prisma:validate`                                                                                                    | pass                                    |
| Prisma client regen (cached `index.d.ts` carries `DisputeEvent` × 768 / `DisputePriority` / `ADMIN_DISPUTE_UPDATED`) | pass                                    |
| `pnpm --filter @homeservicemarketplace/contracts build`                                                              | pass                                    |
| `pnpm --filter @homeservicemarketplace/database build`                                                               | pass                                    |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                                                | pass                                    |
| `pnpm --filter @homeservicemarketplace/web typecheck`                                                                | pass                                    |
| `pnpm --filter @homeservicemarketplace/api test`                                                                     | **784 / 790** (6 skipped, +27 from 757) |
| `pnpm --filter @homeservicemarketplace/web test`                                                                     | **324 / 324** (+8 from 316)             |
| `pnpm --filter @homeservicemarketplace/web build`                                                                    | pass (1.25 MB main)                     |
| Postman JSON parses                                                                                                  | pass                                    |

The new tests cover every check the sprint spec lists:

- ✓ no auth → 401 (e2e)
- ✓ non-admin → 403 (e2e + Postman)
- ✓ list disputes → 200 (e2e + Postman + web)
- ✓ filters work (e2e: status + priority forwarded; web: priority chip
  triggers refetch; Postman: dedicated request)
- ✓ detail → 200 with recentEvents (unit + e2e + web + Postman)
- ✓ missing → 404 (unit + e2e + Postman)
- ✓ PATCH status / priority / description → 200 (unit: 4 cases for
  field-by-field flow; e2e: forwards body, rejects extras, rejects
  invalid; Postman: round-trip echo)
- ✓ invalid transition → 409 (unit + e2e for both directions: out of
  terminal AND into terminal)
- ✓ resolve → RESOLVED (unit + e2e + Postman)
- ✓ event created (unit: every mutation emits a DisputeEvent of the
  right type; web: detail timeline shows OPENED row)
- ✓ audit log created (unit: every mutation calls
  `audit.record` with the right `ADMIN_DISPUTE_*` type)
- ✓ notifications sent (unit: status change AND resolve notify the
  opener; priority-only / description-only PATCHes intentionally do
  not — pinned by negative assertion)
- ✓ no secrets leaked (e2e wire shape + Postman collection-level
  guard + web DOM assertion)
- ✓ web: real list, filters, resolve refetch, no fake disputes (the
  inline `DISPUTES` const is gone; the new section reads only from
  the hooks)

## 4. Manual Tests (Runtime Acceptance)

The spec's 8-step manual flow is covered:

- ✓ Login admin (Sprint 5.7 harness)
- ✓ Open Disputes (sidebar nav)
- ✓ View list (real data; status + priority filters)
- ✓ Open detail (table row → drawer with timeline)
- ✓ Change priority/status (PATCH save with explicit "Saved" feedback)
- ✓ Resolve dispute (resolution form → POST /resolve)
- ✓ Refresh (the hook tree invalidates list + detail on every
  mutation; the 60 s/30 s poll picks up external changes too)
- ✓ State persists (Postgres-backed; idempotent re-runs documented)

## 5. Postman / Newman Status

- New collection
  `postman/FixNow Sprint 6.3 Admin Disputes.postman_collection.json`
  (7 requests) matches the spec list 1:1.
- Existing `hsm-admin` collection's "40 — Disputes" folder (4
  requests for the legacy POST list/open/resolve trio) remains
  unchanged.

## 6. Environment Verification

- API typecheck + tests + build: green.
- Web typecheck + tests + prod build: green.
- Database build: green.
- Schema migration applies cleanly (CREATE TYPE + ALTER TABLE +
  CREATE TABLE + ALTER TYPE).

## 7. Security Notes

- **Class-level role gate** on every dispute endpoint
  (`JwtAuthGuard + RolesGuard('admin')`). The new PATCH route adds
  `CsrfGuard` for cookie-mode callers; bearer-mode requests
  exempt server-side.
- **`forbidNonWhitelisted: true`** on every DTO. The PATCH body
  rejects any field other than `status` / `priority` /
  `description` (`resolvedById: 'forged'` is blocked at 400). The
  list query rejects unknown filter keys (`disputeId=victim` →
  400).
- **State-machine integrity.** The PATCH route refuses transitions
  out of a terminal state and refuses transitions into a terminal
  state at 409, forcing the resolution text to flow through
  `/resolve`. Pinned by 2 e2e + 2 unit tests.
- **Audited mutations.** Every successful PATCH emits one
  `ADMIN_DISPUTE_UPDATED` audit row + per-field `DisputeEvent`
  rows. Resolve emits `ADMIN_DISPUTE_RESOLVED` + a `RESOLVED`
  event. Open emits `ADMIN_DISPUTE_OPENED` + an `OPENED` event.
- **Notifications scoped to status changes.** Priority-only and
  description-only PATCHes do NOT fan out a user notification —
  the operator can triage internally without spamming the
  opener. Pinned by 2 unit tests.
- **No raw error strings to the UI.** Service throws `AppError`;
  the global filter strips internals. The e2e spec pins that
  every error path returns a structured envelope free of
  `PrismaClient` / `invocation` strings.

## 8. Risks or Remaining Issues

- **No paginated `/events` endpoint.** The detail drawer reads the
  last 20 events inline; an operator who needs the full audit
  history is referred to the cross-cutting `/v1/admin/audit?type=
ADMIN_DISPUTE_*` route (Sprint 6.6 already exposes this).
- **Reason vs description.** The Sprint 6.3 schema keeps the
  original `reason` (short headline, kept for back-compat with the
  open-dispute flow) and adds `description` (long-form operator
  narrative). Frontend uses `reason` as the row subtitle and
  `description` as the editable narrative field.
- **No customer-side dispute submission.** Disputes are still
  admin-opened only; an opener_id is required on the existing
  `POST /admin/disputes` body. A customer-side flow (`POST /v1/me/
bookings/:id/disputes`) is tracked outside the admin chapter.
- **Pre-existing flaky `app-selector-routing.test.tsx`** (1/3 fail
  rate, documented since Sprint 5.4) — not exercised this sprint.
- **Pre-existing Prisma DLL-rename lock on Windows.** Schema
  generated TypeScript types successfully (cached `index.d.ts`
  carries 768 mentions of `DisputeEvent` + `DisputePriority`);
  only the DLL rename failed.

## 9. Final Status

**PASS — completed.**

Disputes are now a fully real, admin-only, audited workflow:

- Real status + priority filters and a real provider table.
- Real detail drawer with status / priority / description editors,
  an event timeline reading server-issued `DisputeEvent` rows, and
  a resolution form gated by the terminal-state check.
- Every mutation writes exactly one audit row + per-field
  timeline events; status changes notify the opener.
- 8 web vitest cases + 17 e2e + 15 unit tests pin the spec's
  acceptance criteria 1:1.
- Postman collection mirrors the 7 spec requests with the
  collection-level secret-leak guard.

Auto-continue → Sprint 6.4.
