# Sprint 6 — Admin Dashboard implementation plan

This document is the load-bearing master plan for the Admin chapter
of the project. It is produced by Sprint 6.0 (audit-only) and drives
Sprints 6.1 → 6.7+. The eight admin areas required by the spec are
classified as one of:

- **mock** — UI exists but renders hardcoded constants; no API calls.
- **backend-ready** — controller + contract + schema are in place;
  the frontend is mock or missing.
- **needs schema** — schema is missing the table or fields the
  feature requires; backend cannot ship in its current shape.
- **deferred** — out of scope for the Admin chapter; tracked as a
  future sprint.

| Area             | Classification                          |
| ---------------- | --------------------------------------- |
| Dashboard        | **mock**                                |
| User Control     | **backend-ready** (no frontend)         |
| Pro Verification | **backend-ready** (frontend uses mocks) |
| Financials       | **needs schema**                        |
| Disputes         | **backend-ready** (frontend uses mocks) |
| Settings         | **backend-ready** (frontend fakes save) |
| Notifications    | **deferred**                            |
| Audit logs       | **backend-ready** (no frontend)         |

---

## 1. Admin route inventory

### Frontend route

- `/admin` is registered at `apps/web/src/app/routes.ts` (lines
  28–31). The route is wrapped by `RequireAdmin`
  (`apps/web/src/lib/route-guards.tsx`) which checks `roles.includes('admin')`
  from the cached `/v1/auth/me` payload and redirects non-admins.
- The page entry is `apps/web/src/app/pages/AdminPage.tsx` — wraps
  `<AdminDashboard />` in `LanguageProvider` and `EcosystemProvider`
  (the latter is what supplies the mock constants today).

### Backend routes

| Mount                 | File                                                | Posture                                            |
| --------------------- | --------------------------------------------------- | -------------------------------------------------- |
| `/v1/admin`           | `apps/api/src/modules/admin/admin.controller.ts:18` | Admin-only health ping                             |
| `/v1/admin/analytics` | `admin-analytics.controller.ts:11`                  | `summary()` → `AdminAnalyticsResponse`             |
| `/v1/admin/users`     | `admin-users.controller.ts:31`                      | list, detail, suspend, restore                     |
| `/v1/admin/providers` | `admin-verification.controller.ts:34`               | list, detail, approve, reject, suspend, reactivate |
| `/v1/admin/disputes`  | `admin-disputes.controller.ts:33`                   | list, detail, open, resolve                        |
| `/v1/admin/settings`  | `admin-settings.controller.ts:29`                   | list, detail, upsert, delete                       |
| `/v1/admin/audit`     | `admin-audit.controller.ts:39`                      | list (paginated)                                   |

Every controller uses `@UseGuards(JwtAuthGuard, RolesGuard)` +
`@Roles('admin')`. Mutating endpoints also apply `CsrfGuard`.

There is **no** controller under `/v1/admin/financials/*`. There is
**no** admin-side `/v1/admin/notifications` controller either; the
existing `/v1/me/notifications` is seeker / provider-facing only.

---

## 2. UI component inventory

All admin frontend code lives in **a single 1,676-line file**
(`apps/web/src/app/components/admin/AdminDashboard.tsx`). The file
hosts every section component; there are no per-section files yet.

| Section component (in-file) | Lines     | What it renders                        | Live data?                                                        |
| --------------------------- | --------- | -------------------------------------- | ----------------------------------------------------------------- |
| `AdminDashboard` shell      | 1429–1676 | Sidebar nav + tab routing + bell badge | Mocks (badge from `useEcosystem`)                                 |
| `DashboardOverview`         | 855–1118  | KPI cards + heatmap + chart            | **Mock** (`HEAT_GRID`, `DISTRICTS`, fake count-up)                |
| `VerificationSection`       | 224–481   | Pro verification table                 | **Mock** (`PRO_VERIFICATIONS`); approve/reject mutate local state |
| `FinancialsSection`         | 482–699   | KPI tiles + transactions + bar chart   | **Mock** (`WALLET_TRANSACTIONS`, hardcoded $)                     |
| `DisputeSection`            | 700–854   | Disputes table                         | **Mock** (read-only, hardcoded rows)                              |
| `PricingSettingsSection`    | 1119–1411 | Fee sliders + Save button              | **Mock** (`setTimeout(500)` fake save)                            |
| Users tab                   | 1649–1669 | "Coming Soon" placeholder              | none                                                              |

**Missing UI surfaces:** Audit logs, Admin notifications.

The file imports `useEcosystem`, `PRO_VERIFICATIONS`, `WALLET_TRANSACTIONS`
from `apps/web/src/app/context/EcosystemContext.tsx`. None of these
are removed yet — Sprint 6.4 / 6.5 below retire them per section.

---

## 3. Existing API inventory

### Method matrix

| Resource                      | List                             | Detail                  | Mutate(s)                                         |
| ----------------------------- | -------------------------------- | ----------------------- | ------------------------------------------------- |
| `/v1/admin/users`             | GET (cursor + `q=` search)       | GET /:userId            | POST /:userId/suspend, POST /:userId/restore      |
| `/v1/admin/providers`         | GET (cursor + `status=`)         | GET /:providerProfileId | POST /:id/approve, /reject, /suspend, /reactivate |
| `/v1/admin/disputes`          | GET (cursor + `status=`)         | GET /:disputeId         | POST (open), POST /:id/resolve                    |
| `/v1/admin/settings`          | GET                              | GET /:key               | PUT /:key, DELETE /:key                           |
| `/v1/admin/audit`             | GET (cursor, `type=`, `userId=`) | —                       | —                                                 |
| `/v1/admin/analytics/summary` | GET                              | —                       | —                                                 |

### Wire shapes (response envelopes)

- List endpoints return `{ items: T[], nextCursor: string | null }`.
- Single-resource endpoints return `{ <resource>: T }` (e.g.,
  `{ user }`, `{ profile }`, `{ dispute }`, `{ setting }`).
- Analytics returns `AdminAnalyticsSummary` directly (no envelope).
- Mutation endpoints return the updated resource envelope.

### Auth posture

- Class-level `JwtAuthGuard + RolesGuard('admin')` on every admin
  controller.
- Mutating route methods also apply `CsrfGuard` (skipped for
  bearer-mode mobile clients per `apps/api/src/modules/iam/authentication/guards/csrf.guard.ts:20`).
- DTO validation runs through `forbidNonWhitelisted: true` so any
  attempt to inject a `userId` / `role` / `status` field via a
  query string is rejected at 400.

---

## 4. DB schema inventory

Read from `packages/database/prisma/schema.prisma`.

### Already present (no migration needed)

| Model                                | Used by                         | Key fields                                                                                                                     |
| ------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `User`                               | Users + Disputes + Audit        | id, email, status, roles via `UserRole` join                                                                                   |
| `UserRole`                           | Role gating                     | userId, roleId                                                                                                                 |
| `Role` / `Permission`                | RolesGuard                      | name, permissions                                                                                                              |
| `ProviderProfile`                    | Verification                    | id, userId, status (DRAFT/PENDING_REVIEW/ACTIVE/SUSPENDED/REJECTED), ratingAvg                                                 |
| `ServiceRequest` / `Bid` / `Booking` | Analytics + Disputes            | priceAmount, currency, status, timestamps                                                                                      |
| `Notification`                       | Notifications (seeker/provider) | userId, type, deepLink, readAt                                                                                                 |
| `Conversation` / `Message`           | Disputes (booking-linked chat)  | id, bookingId, body, createdAt                                                                                                 |
| `Dispute`                            | Disputes module                 | id, bookingId, openedById, status (DisputeStatus enum), reason, resolution, resolvedAt, resolvedById, timestamps + soft-delete |
| `PlatformSetting`                    | Settings module                 | key (PK), value (Json), updatedAt, updatedBy                                                                                   |
| `AuditEvent`                         | Audit module                    | id, userId, type (AuditEventType enum), metadata, ipAddress, userAgent, requestId, createdAt                                   |

### Missing — required for Financials

There is **no** `Payout`, `Withdrawal`, `Transaction`, or `Ledger`
model. Bookings carry `priceAmount` only; the platform-fee number is
computed at query time from `PROVIDER_PLATFORM_FEE_BPS` (Sprint 5.6).
A real Financials surface needs:

```prisma
model PayoutTransaction {
  id              String        @id @default(cuid())
  kind            PayoutKind    // EARNING_RESERVED, EARNING_RELEASED, WITHDRAWAL, REFUND, PLATFORM_FEE
  status          PayoutStatus  // PENDING, PROCESSING, COMPLETED, REVERSED
  bookingId       String?
  providerUserId  String?
  seekerUserId    String?
  amount          Int           // marketplace currency unit (cents-equivalent)
  currency        String        @default("USD")
  metadata        Json?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  deletedAt       DateTime?

  @@index([providerUserId, createdAt])
  @@index([bookingId])
  @@index([kind, status, createdAt])
}
```

(The exact shape is finalized in Sprint 6.4. The point of Sprint 6.0
is to flag that the work blocks on a migration.)

---

## 5. Mock data inventory

Every constant on this list is consumed _only_ by `AdminDashboard.tsx`
and lives in `apps/web/src/app/context/EcosystemContext.tsx`. They
are the surface area Sprints 6.2 → 6.5 retire.

| Mock                                                            | Consumer                                                           | Replacement                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `PRO_VERIFICATIONS` (array)                                     | `VerificationSection`                                              | `useAdminProviders()` hook → `GET /v1/admin/providers` (Sprint 6.2)                                                  |
| `WALLET_TRANSACTIONS` (array)                                   | `FinancialsSection`                                                | `useAdminFinancialsTransactions()` (Sprint 6.4 — depends on schema)                                                  |
| `HEAT_GRID` / `DISTRICTS`                                       | `DashboardOverview` heatmap                                        | Either delete (geo-heatmap is decorative) or hydrate from a future `/v1/admin/analytics/heatmap` endpoint (deferred) |
| Hardcoded KPI numbers (`14,820`, `11,100`, `3,720`, `12%`)      | `DashboardOverview`, `FinancialsSection`, `PricingSettingsSection` | `/v1/admin/analytics/summary` (Sprint 6.1), `/v1/admin/settings/:key` (Sprint 6.3)                                   |
| `setTimeout(500)` fake save in `PricingSettingsSection`         | local toast                                                        | `useUpsertSetting()` mutation (Sprint 6.3)                                                                           |
| `useEcosystem` mock disputes array (inline in `DisputeSection`) | dispute table                                                      | `useAdminDisputes()` hook (Sprint 6.5)                                                                               |
| Bell badge static count                                         | top-bar bell                                                       | TBD — admin notifications is **deferred**                                                                            |

---

## 6. Required contracts

Per area, what's already published and what we still need to author.

### Already published — `packages/contracts/src/admin/**`

- `admin/analytics` — `AdminAnalyticsSummary`, `AdminAnalyticsResponse`
- `admin/users` — `AdminUserSummary`, `ListAdminUsersQuery/Response`,
  `AdminUserMutationResponse`
- `admin/verification` — `AdminProviderSummary`,
  `ListAdminProvidersQuery/Response`,
  `AdminProviderApproveDto`, `AdminProviderRejectDto`,
  `AdminProviderSuspendDto`, `AdminProviderMutationResponse`
- `admin/disputes` — `DisputeSummary`,
  `ListAdminDisputesQuery/Response`, `OpenDisputeRequest`,
  `ResolveDisputeRequest`, `DisputeMutationResponse`,
  `DisputeStatusValues` enum
- `admin/settings` — `AdminSettingValue`,
  `ListSettingsResponse`, `UpsertSettingRequest`,
  `SettingMutationResponse`
- `admin/audit` — `ListAuditEventsResponse` + the implicit
  `AuditEventSummary` shape

### To publish in later sprints

- **Financials (Sprint 6.4):** `AdminFinancialsSummary` (totalRevenue,
  totalPayouts, netRevenue, platformFees, pendingPayouts, currency),
  `PayoutTransactionSummary`, `ListAdminFinancialsQuery/Response`.
- **Admin notifications (deferred):** `AdminNotificationSummary`,
  `ListAdminNotificationsResponse`, broadcast event envelope on the
  Socket.IO surface (per `docs/architecture/realtime-plan.md`).

---

## 7. Security requirements

These are **non-negotiable** for every admin sprint that ships UI
or new endpoints. They formalize what's already in the existing
controllers.

1. **Class-level role gate.** Every admin controller declares
   `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('admin')` at the
   class level. Per-route gates only ADD checks (`CsrfGuard`); they
   never relax the role.
2. **CSRF on mutations only.** GET-only routes do not apply
   `CsrfGuard`. Mutations (`POST` / `PUT` / `PATCH` / `DELETE`)
   always do; bearer-mode requests are exempted server-side
   (`csrf.guard.ts:20`).
3. **DTO `forbidNonWhitelisted: true`.** Already enabled globally;
   each admin DTO must declare ONLY the fields the route accepts so
   IDOR injection (`?userId=victim`, `{role: 'admin'}`) fails at 400.
4. **Server-driven identity.** No admin endpoint reads
   `userId` / `providerProfileId` / `targetId` from the body when it
   could be derived from the path. Path params are validated via
   `@Param` + the service layer's existence checks.
5. **AppError envelope only.** Mutations on absent / cross-tenant
   resources surface as `NOT_FOUND` (404) or `FORBIDDEN` (403) — never
   leak Prisma / SQL strings. The collection-level Prisma/secret-leak
   guard in every Postman folder pins this on the wire.
6. **Audit every mutation.** Every state-changing admin endpoint
   must emit an `AuditEvent` row — `(userId=admin, type=ADMIN_*,
metadata={target,reason})`. The `AdminAuditService` already
   provides the helper; all existing admin services use it.
7. **Frontend role check is decorative.** `RequireAdmin` redirects
   non-admins so they never see the UI, but the _real_ gate is the
   controller's `RolesGuard` — the API rejects every cross-role call
   independent of frontend behavior.
8. **Soft delete, never hard delete.** `Dispute`, `User`,
   `ProviderProfile` all carry `deletedAt`. Admin "delete" actions
   set the flag; the row stays for forensic / regulatory audit.
9. **No raw error strings to the UI.** When a mutation fails, the
   admin UI renders a stable copy ("Could not approve provider")
   never `error.message`.
10. **Token scope.** Admin operates with the same JWT shape as any
    other user; `roles: ['admin']` on the JWT is the only
    authorization signal. There is no "admin god mode" longer-lived
    token.

---

## 8. Sprint-by-sprint admin implementation plan

The plan covers Sprint 6.1 → Sprint 6.7. Each sprint is **shippable
on its own** — no sprint blocks on a later one. Two areas are
explicitly deferred (notifications, geo heatmap).

### Sprint 6.1 — Dashboard wired to analytics

- Hook: `useAdminAnalyticsSummary()` → `GET /v1/admin/analytics/summary`.
- Replace the count-up animations + hardcoded KPIs in
  `DashboardOverview` with real values.
- Heatmap stays decorative (the data is not in the API yet); the
  React component just shrinks to a "coming soon" tile so it doesn't
  pretend to be live.
- Tests: vitest case for KPI render + error state; the existing
  `AdminDashboard.test.tsx` is extended.
- Postman: existing `50 — Analytics` folder is sufficient; add
  one negative-case test (customer token → 403).

### Sprint 6.2 — Pro Verification frontend wiring

- Hooks: `useAdminProviders({ status })`,
  `useApproveProvider`, `useRejectProvider`, `useSuspendProvider`,
  `useReactivateProvider`. The hook tree mirrors the bookings tree.
- `VerificationSection` switches from `PRO_VERIFICATIONS` mock to
  the hook; approve/reject buttons fire mutations + invalidate the
  `admin/providers` root.
- Add a confirmation dialog on suspend / reject (irreversible from
  the operator's mental model — even though the data is reversible
  via reactivate).
- Tests: 4–5 vitest cases (list, approve happy-path, reject with
  reason, suspend with reason, error → safe copy).
- Postman: existing `30 — Verification` folder grows by 2 negatives
  (cross-role 403, no-token 401).

### Sprint 6.3 — Settings frontend wiring + first real keys

- Hooks: `useAdminSettings()`, `useUpsertSetting()`,
  `useDeleteSetting()`.
- `PricingSettingsSection` reads/writes
  `platform_fee_bps` (replaces the env-only Sprint 5.6 default
  long-term). The existing `PROVIDER_PLATFORM_FEE_BPS` env stays
  as the fallback when the setting key is absent — no breaking
  change.
- Add a settings table component (`SettingsList`) so an operator
  can edit any key the platform exposes.
- Tests: 4 vitest cases (load, save, delete, error → safe copy);
  e2e for `/v1/admin/settings/*` already covers the API.
- Postman: existing `60 — Settings` folder is sufficient.

### Sprint 6.4 — Financials schema + endpoints + UI

- **Migration:** adds the `PayoutTransaction` model in §4 above.
- Backfill: a one-shot script seeds historical
  `EARNING_RELEASED` rows from completed bookings (per provider, gross
  - computed platform fee, occurredAt = booking.updatedAt).
- New service `AdminFinancialsService` with `summary()` +
  `transactions(query)` + `processWithdrawal()` (out of scope —
  `processWithdrawal` ships disabled in this sprint).
- New controller `/v1/admin/financials/{summary,transactions}`.
- New contracts module under `packages/contracts/src/admin/financials/`.
- `FinancialsSection` is rewired against the new endpoints; the
  hardcoded `$14,820` headline disappears.
- Tests: 8–10 unit + 6 e2e + 2 vitest cases. Postman gets a new
  `45 — Financials` folder.

### Sprint 6.5 — Disputes frontend wiring + queue actions

- Hooks: `useAdminDisputes({ status })`, `useResolveDispute()`,
  `useOpenDispute()`.
- `DisputeSection` switches from in-line mock data to the hook;
  the "open dispute" call is exposed as an admin shortcut for the
  rare cases where ops files one on a customer's behalf.
- Resolution form: status (`RESOLVED_REFUND` /
  `RESOLVED_PARTIAL` / `RESOLVED_DENIED`) + free-text resolution.
- Tests: 4 vitest cases. Postman: existing `40 — Disputes` folder
  is sufficient.

### Sprint 6.6 — User Control frontend

- Hooks: `useAdminUsers({ q, status })`, `useSuspendUser()`,
  `useRestoreUser()`.
- New `UserControlSection` component (replaces the "Coming Soon"
  placeholder). Table with email, name, roles, status, last sign-in;
  per-row "Suspend" / "Restore" with confirmation.
- Search box bound to `?q=` cursor-paginated list.
- Tests: 5 vitest cases (list, search, suspend, restore, foreign
  user IDOR via URL → safe failure).
- Postman: existing `20 — Users` folder grows with one IDOR-style
  negative.

### Sprint 6.7 — Audit log viewer

- Hooks: `useAdminAuditEvents({ type, userId })`.
- New `AuditLogSection` component + sidebar nav entry.
  Table with timestamp, type, target user, metadata diff (when
  present). Filter by type + target user.
- Read-only — no admin action mutates audit events.
- Tests: 3 vitest cases. Postman: existing `70 — Audit` folder
  is sufficient.

### Deferred — Admin notifications (Sprint 6.8 or later)

- Requires the Socket.IO + Redis Adapter spike from Sprint 5.5.5
  to land first. Until then the bell badge stays static.
- New contract module + controller `/v1/admin/notifications`.
- New schema field on `Notification`: a nullable `audience` enum
  (`USER` / `ADMIN`) so a single table can serve both. (Or a
  separate `AdminNotification` table — deferred decision.)

---

## 9. Risks / blockers

1. **Single-file admin frontend.** The 1,676-line
   `AdminDashboard.tsx` will get harder to refactor each sprint.
   **Mitigation:** Sprint 6.1 introduces a `components/admin/`
   sub-directory and extracts `DashboardOverview`; subsequent
   sprints continue extracting their section components. Goal: by
   Sprint 6.7, each section is its own file.
2. **Mock-context entanglement.** `AdminDashboard` imports
   `useEcosystem`, which is also referenced by seeker / provider
   mock paths. Removing it from one consumer doesn't break the
   others, but the eventual `EcosystemContext` retirement is a
   cross-cutting cleanup deferred to a dedicated sprint.
3. **Financials backfill correctness.** The
   `EARNING_RELEASED` backfill from completed bookings (Sprint 6.4)
   is a one-shot Postgres write with no idempotency key. A re-run
   would double-credit. **Mitigation:** the migration ships with a
   `INSERT ... ON CONFLICT DO NOTHING` clause keyed on
   `(bookingId, kind)` so the script is idempotent.
4. **No staging environment for admin UAT.** Every admin sprint
   verification is local-only until a staging URL exists. **Mitigation:**
   the existing Newman runner (`pnpm postman:admin`) covers the wire
   contract; UI verification is per-sprint vitest only.
5. **Realtime fan-out depends on Sprint 5.5.5.** Admin notifications
   cannot ship until the Socket.IO + Redis Adapter implementation
   sprint lands. Tracked as a hard dependency in the plan
   (deferred section).
6. **Soft-delete vs hard-delete on admin actions.** The plan keeps
   every admin "delete" as a soft-delete. Compliance / GDPR-style
   right-to-be-forgotten is **not** in scope for the admin chapter
   and is tracked as a future, separate workstream.
7. **Pre-existing Prisma DLL lock on Windows.** `prisma generate`
   cannot run while `nest start --watch` holds the cached client.
   Sprint 6.4's migration must therefore be run with the dev server
   stopped — the existing runbook in `docs/testing/` calls this out.

---

## Change log

- 2026-05-02 — Sprint 6.0 audit; document created.
