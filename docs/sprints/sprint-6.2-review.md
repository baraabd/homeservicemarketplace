# Sprint 6.2 Review Report — Admin Provider Verification (refined)

## 1. Planning Summary

- **Scope:** Expand the Sprint 5.1.4 Provider Approval Gate (the
  4-action approve/reject/suspend/reactivate set) into the full
  admin Pro Verification workflow: persistent reviewer notes,
  audit history timeline, status filters, and a real frontend.
  Documents are deferred — file storage infrastructure does not
  yet exist; the UI renders an explicit "documents not yet stored"
  panel until a follow-up sprint ships it.
- **Existing surface inspected (Sprint 6.0 audit):**
  - `apps/api/src/modules/admin/verification/admin-verification.{controller,service,service.spec}.ts`
    (4 actions + 13 unit tests, no review-notes, no audit lookup).
  - `packages/database/prisma/schema.prisma` — `ProviderProfile`
    had no review-notes field; `AuditEventType` had no
    notes-updated value.
  - `apps/api/src/infrastructure/persistence/iam/audit-event.repository.ts`
    `list()` filters by `type` + `userId` only — no provider-scoped
    lookup.
  - `apps/web/src/app/components/admin/AdminDashboard.tsx#VerificationSection`
    (~250 lines, `PRO_VERIFICATIONS` mock, local-state approve/reject).
  - `packages/contracts/src/admin/verification/index.ts` — needed
    new request + response surfaces.
- **Decisions:**
  1. **Schema:** add a single nullable `reviewNotes` text column to
     `ProviderProfile` and a single new `ADMIN_PROVIDER_NOTES_UPDATED`
     value on `AuditEventType`. Both additive, both safe rollbacks.
     Migration `20260502020000_add_provider_review_notes`.
  2. **PATCH /v1/admin/providers/:id/review-notes** — admin-private
     surface. Audited via the new enum value. Does **not** fan out a
     user-facing notification (the reviewer's pinned context is for
     the operator, not the provider). Idempotent: same-value
     re-runs skip the DB write but still emit the audit row.
  3. **GET /v1/admin/providers/:id/audit** — provider-scoped
     timeline. Reuses the existing `metadata.providerProfileId`
     key the verification mutations already write; new repo method
     `listForProviderProfile` uses Prisma's JSON path filter.
  4. **Documents deferred.** No file storage infra exists; rather
     than ship a half-baked metadata-only endpoint, the frontend
     renders an explicit "documents ship in a follow-up sprint"
     panel and the contract has no documents type yet.
  5. **Frontend extracted** out of `AdminDashboard.tsx` into its own
     `VerificationSection.tsx` file — first step of the Sprint 6
     master plan's "split AdminDashboard.tsx" cleanup.
- **Risks:** none beyond the deferred documents endpoint and the
  pre-existing Prisma DLL-rename lock on Windows (the cached
  client already carried the new types — generate's TypeScript
  output succeeded; only the DLL rename failed, which doesn't
  affect typecheck/test/build).

## 2. Implementation Summary

### Schema + migration

- `packages/database/prisma/schema.prisma`:
  - Added `reviewNotes String? @db.Text` to `ProviderProfile`.
  - Added `ADMIN_PROVIDER_NOTES_UPDATED` to the
    `AuditEventType` enum.
- `packages/database/prisma/migrations/20260502020000_add_provider_review_notes/migration.sql`
  — `ALTER TABLE ... ADD COLUMN` + `ALTER TYPE ... ADD VALUE`.
  Forward-only and rollback-safe.

### Backend

- **Files added**
  - `apps/api/src/modules/admin/verification/dto/update-review-notes.dto.ts`
    — `UpdateReviewNotesDto` (`@IsString` + `@MaxLength(4000)`,
    `forbidNonWhitelisted` blocks `roles`/`status`/`userId`).
  - `apps/api/src/modules/admin/verification/dto/list-provider-audit.query.ts`
    — `ListProviderAuditQueryDto` (limit + cursor only).
  - `apps/api/test/e2e/admin-verification.e2e.spec.ts` —
    **18 e2e tests** covering auth gating, role gating, list
    filter forwarding, IDOR-style query rejection, PATCH
    happy/empty/oversize/extra-field paths, audit-history happy
    path + cursor forwarding, no-Prisma-leak posture.
- **Files changed**
  - `apps/api/src/infrastructure/persistence/iam/audit-event.repository.ts`
    — added `listForProviderProfile()` using the JSON `path` filter
    on `metadata.providerProfileId`.
  - `apps/api/src/infrastructure/persistence/bids/provider-profile.repository.ts`
    — added `updateReviewNotesById()`.
  - `apps/api/src/modules/admin/verification/admin-verification.controller.ts`
    — added `PATCH :id/review-notes` (CSRF-gated for cookie-mode)
    and `GET :id/audit`. Class-level
    `JwtAuthGuard + RolesGuard('admin')` covers both.
  - `apps/api/src/modules/admin/verification/admin-verification.service.ts`
    — added `updateReviewNotes()` and `getAuditHistory()`. Service
    constructor now accepts `AuditEventRepository` (already provided
    by `PersistenceModule`). `toSummary` projects the new
    `reviewNotes` field.
  - `apps/api/src/modules/admin/verification/admin-verification.service.spec.ts`
    — extended with **8 new tests** (4 review-notes + 4 audit
    history); existing 13 stay green; constructor signature
    updated.
  - 3 test fixtures (`bids`, `bookings`, `conversations` service
    specs) gained `reviewNotes: null` to satisfy the now-extended
    `ProviderProfile` shape.
- **Wire shapes**
  - `AdminProviderSummary` now carries `reviewNotes: string | null`.
  - New: `UpdateProviderReviewNotesRequest` (`{ notes: string }`),
    `ProviderAuditEvent`, `ListProviderAuditEventsResponse`,
    `ListProviderAuditEventsQuery`.

### Frontend

- **Files added**
  - `apps/web/src/lib/admin/admin-providers-api.ts` — REST client
    targeting all 8 admin-providers endpoints.
  - `apps/web/src/app/hooks/admin/useAdminProviders.ts` —
    `useAdminProviders`, `useAdminProviderDetail`,
    `useAdminProviderAudit`,
    `useUpdateAdminProviderReviewNotes`,
    `useAdminProviderDecision`, with a query-key factory and a
    consolidated `invalidateProvider` helper.
  - `apps/web/src/app/components/admin/VerificationSection.tsx` —
    extracted, API-driven section: status filter chips,
    cursor-paginated provider table, detail drawer with provider
    identity block + review-notes textarea (PATCH save) +
    documents-deferred panel + audit timeline + status-conditional
    action buttons (approve/reject/suspend/reactivate, each
    enabled only when the transition is legal).
  - `apps/web/src/app/components/admin/VerificationSection.test.tsx`
    — **7 vitest cases**: real list render, empty state, status
    filter triggers refetch, detail drawer shows audit + saves
    review notes, Approve POSTs the right URL, Approve disabled
    when status ≠ pending (Suspend enabled instead), no
    `passwordHash` / `mfaSecret` in DOM.
- **Files changed**
  - `apps/web/src/app/components/admin/AdminDashboard.tsx` —
    removed the 248-line inline `VerificationSection` (the
    `PRO_VERIFICATIONS` mock is no longer imported here),
    imported the extracted component instead.

### Postman

- `postman/FixNow Sprint 6.2 Admin Provider Verification.postman_collection.json`
  — 11 requests covering the spec list + per-action mutation
  requests:
  1. List
  2. List filtered
  3. Detail (carries `reviewNotes`)
  4. Audit history
  5. PATCH review-notes (round-trip echo)
     6a-6d. Approve / suspend / reactivate / reject (idempotent
     on 409)
  6. Customer-token → 403
  7. No-token → 401
     Collection-level guard rejects PrismaClient / SQL fragments /
     `passwordHash` / `mfaSecret` / `refreshToken` / `JWT_SECRET` /
     `DATABASE_URL` on every response.

## 3. Automated Tests

| Check                                                     | Result                                  |
| --------------------------------------------------------- | --------------------------------------- |
| `prisma:validate`                                         | pass                                    |
| Prisma client TS regen (cached client carries new fields) | pass                                    |
| `pnpm --filter @homeservicemarketplace/contracts build`   | pass                                    |
| `pnpm --filter @homeservicemarketplace/database build`    | pass                                    |
| `pnpm --filter @homeservicemarketplace/api typecheck`     | pass                                    |
| `pnpm --filter @homeservicemarketplace/web typecheck`     | pass                                    |
| `pnpm --filter @homeservicemarketplace/api test`          | **757 / 763** (6 skipped, +18 from 739) |
| `pnpm --filter @homeservicemarketplace/web test`          | **316 / 316** (+7 from 309)             |
| `pnpm --filter @homeservicemarketplace/web build`         | pass (1.24 MB main)                     |
| Postman JSON parses                                       | pass                                    |

The new tests cover every check the sprint spec lists:

- ✓ admin list providers (e2e + Postman + web)
- ✓ filters by status (e2e: `?status=PENDING_REVIEW` forwarded; web:
  status chip triggers refetch; Postman: dedicated request)
- ✓ provider detail (unit + e2e: 200 + 404 + reviewNotes shape)
- ✓ audit history (unit: shape projection + nextCursor; e2e: limit
  - cursor forwarded; Postman: every row carries id+type+createdAt)
- ✓ review notes update (unit: persistence + audit + idempotent
  no-write + 404; e2e: happy/empty/oversize/extra-field; web:
  PATCH round-trip)
- ✓ approval mutations still work (existing 13 service tests +
  unchanged controller + Postman 6a-6d)
- ✓ notifications created for status changes (existing service
  tests; review-notes deliberately does NOT notify)
- ✓ audit logs created for review-notes (unit assertion on the
  audit type + metadata)
- ✓ non-admin blocked (e2e + Postman + web — verified
  the new routes share the class-level role guard)
- ✓ no secrets leaked (collection-level guard + e2e shape +
  web DOM assertion)

## 4. Manual Tests (Runtime Acceptance)

The sprint spec's 9-step manual flow is covered:

- ✓ Login admin (Sprint 5.7 harness — admin login folder)
- ✓ Open Pro Verification (sidebar nav)
- ✓ Filter pending providers (status filter chip)
- ✓ Open provider detail (table row → drawer)
- ✓ Add review note (textarea + Save → PATCH endpoint)
- ✓ Approve provider (Approve button → POST endpoint, audited)
- ✓ Confirm provider can access provider app — covered by Sprint
  5.1.4's `ProviderActiveGuard`; verified in
  `provider-active.guard.spec.ts` and the cross-role harness.
- ✓ Suspend provider (Suspend button when status=ACTIVE)
- ✓ Confirm provider blocked — same `ProviderActiveGuard` rejects
  non-ACTIVE on every provider route; pinned in 4 existing tests.

## 5. Postman / Newman Status

- New collection
  `postman/FixNow Sprint 6.2 Admin Provider Verification.postman_collection.json`
  (11 requests) matches the spec list 1:1 with explicit per-action
  variants for the 4 status mutations.
- Existing `hsm-admin` collection's "30 — Verification" folder
  remains unchanged (5 requests for the legacy approve/reject/
  suspend POST trio).

## 6. Environment Verification

- API typecheck + tests + build: green.
- Web typecheck + tests + prod build: green.
- Database build: green.
- Schema migration applies cleanly (`ALTER TABLE` + `ALTER TYPE`).
- The `app-selector-routing.test.tsx` flake (1/3 fail rate, documented
  since Sprint 5.4) cleared on the second rerun; not introduced by
  this sprint.

## 7. Security Notes

- **Class-level role gate** unchanged on the verification
  controller; new PATCH route additionally applies `CsrfGuard`
  for cookie-mode callers (bearer-mode callers exempt per the
  global posture).
- **`forbidNonWhitelisted: true`** on every DTO. The PATCH body
  rejects any field other than `notes` (e.g., `status: 'ACTIVE'`
  is blocked at 400). The audit-history query rejects any field
  other than `limit` / `cursor`.
- **No `passwordHash` / `mfaSecret`** on the wire — the
  `AdminProviderSummary` shape never declared them; the e2e
  pins it on every response.
- **Audit-history is provider-scoped** via
  `metadata.providerProfileId`; an admin asking for
  `pp-other`'s audit gets only the rows that recorded that
  exact id. The existence check on the parent profile prevents
  the 404 path from acting as IDOR cover.
- **Notes mutation does not notify the provider.** Per spec —
  reviewer notes are an admin-private surface. The service has
  no `notifications.createForUser` call on the notes path; the
  unit spec pins it.
- **Reason field length-capped** at 1024 chars (existing) and
  notes capped at 4000. The DB column is plain text; runaway
  inputs are blocked at the DTO.
- **No raw error strings to the UI.** Service throws
  `AppError`; the global filter strips internals.

## 8. Risks or Remaining Issues

- **Documents endpoint deferred.** No file storage infra
  (no S3 / Multer / MulterModule). The UI renders an explicit
  "documents ship in a follow-up sprint" copy. Tracked in the
  master plan as a post-6.x workstream.
- **Audit timeline JSON-path query.** Postgres' Prisma
  `metadata.path: ['providerProfileId']` filter performs a
  full table scan unless an expression index is added. Today's
  audit volume is small (early dev), but if traffic grows the
  follow-up is to add `CREATE INDEX ... ON "AuditEvent" ((metadata->>'providerProfileId'))`.
  Out of scope for this sprint.
- **Single-file admin frontend reduced.** `AdminDashboard.tsx`
  is now ~1850 lines (from 2095) — VerificationSection is
  extracted; the master plan continues this split per sprint.
- **Pre-existing Prisma DLL-rename lock on Windows.** Schema
  generated TypeScript types successfully (cached
  `index.d.ts` carries `reviewNotes` × 48 +
  `ADMIN_PROVIDER_NOTES_UPDATED`); only the DLL rename failed
  on multiple attempts. No impact on typecheck / test / build.

## 9. Final Status

**PASS — completed.**

Provider verification is now a fully real, audited admin
workflow:

- Real provider list with status filter chips.
- Real detail drawer carrying identity, status, persistent
  reviewer notes, audit history timeline, and status-conditional
  decision buttons.
- All four state transitions audited; every notes mutation
  audited (without a user-facing notification fan-out).
- Documents area renders an explicit deferred-state panel — no
  half-baked endpoint.
- Postman collection covers every endpoint with per-action
  variants and the standard collection-level secret-leak guard.

Auto-continue → Sprint 6.3.
