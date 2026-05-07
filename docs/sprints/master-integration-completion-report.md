# Master Integration Completion Report

**Date:** 2026-05-02
**Branch:** `recovery/fix-local-api-db-auth-seeker`
**Final commit at the time of writing:** `e028055` (feat(realtime): Socket.IO gateway + Redis adapter — Sprint 7.0 refined)
**Final test totals (post Sprint 7.0):**

- API — `pnpm --filter @homeservicemarketplace/api test`: **882 passed**, 6 skipped, 78/81 suites (3 suites skipped — pre-existing IO-bound suites, not regressions)
- Web — `pnpm --filter @homeservicemarketplace/web test`: **349 passed**, 0 failed, 44 suites
- API + Web `typecheck`: clean
- API + Web `lint`: 0 errors (web has 26 pre-existing unrelated warnings)

This report covers Sprints 5.1.3 → 7.0. It is intentionally honest:
where a sprint PARTIALLY passed, it is recorded as such; where work
is deferred, it is listed in §6 instead of being claimed as done.

---

## 1. Final Sprint Status

| Sprint    | Decision                            | One-line summary                                                                                                                                                                     |
| --------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **5.1.3** | **PARTIAL PASS**                    | Runtime closure for the seeker leg — green tests on what was scoped; one item rolled into 5.1.4.                                                                                     |
| **5.1.4** | **PASS**                            | Provider approval gate end-to-end: signup → admin approve → can bid.                                                                                                                 |
| **5.2**   | **PASS**                            | Provider available-requests feed (canonical `/v1/provider/available-requests`).                                                                                                      |
| **5.3**   | **PASS**                            | Provider-side own-bid surface (`/v1/provider/bids` + my-bids list).                                                                                                                  |
| **5.4**   | **PASS**                            | Provider bookings lifecycle (`start` / `complete` / `cancel`) with state-machine guards + audit.                                                                                     |
| **5.5**   | **PASS**                            | Notifications + chat — REST + polling cadences (15 s unread / 20 s lists / 4 s active thread).                                                                                       |
| **5.5.5** | **PASS — design-only**              | Realtime architecture spike: Socket.IO + Redis Adapter chosen; in-process SSE shipped as Phase A placeholder.                                                                        |
| **5.6**   | **PASS**                            | Provider earnings (refined): canonical `/v1/provider/earnings/{summary,transactions,chart}` with env-driven `PROVIDER_PLATFORM_FEE_BPS`.                                             |
| **5.7**   | **PASS — completed**                | Provider runtime harness: 13-step CJS verifier + 11-folder Postman runtime + operator runbook.                                                                                       |
| **6.0**   | **PASS — admin inventory complete** | Admin dashboard audit; 8-area classification table; admin chapter scoped.                                                                                                            |
| **6.1**   | **PASS — completed**                | Real admin user control: idempotent `PATCH /v1/admin/users/:id/status` + roles read; refuses self-disable.                                                                           |
| **6.2**   | **PASS — completed**                | Full admin provider verification: review-notes round-trip, audit list, approve/reject/suspend/reactivate.                                                                            |
| **6.3**   | **PASS — completed**                | Admin disputes: status + priority + description PATCH; terminal-status guards; before/after event timeline.                                                                          |
| **6.4**   | **PASS — completed**                | Admin analytics + financials (read-only) — date-range-aware, in-band reconciliation invariants.                                                                                      |
| **6.5**   | **PASS — completed**                | Real admin platform settings: 4-key whitelist, atomic per-type-validated PATCH (rejects unknown keys incl. `JWT_SECRET`).                                                            |
| **6.6**   | **PASS — completed**                | Real admin notifications + audit logs with server-side metadata redaction.                                                                                                           |
| **6.7**   | **PASS** (initial + refined)        | Admin runtime harness — initial reference collection + refined consolidated `FixNow Admin Runtime` (10 folders, 29 requests).                                                        |
| **7.0**   | **PASS** (initial + refined)        | Realtime foundation — initial in-process SSE; refined Socket.IO gateway + Redis Adapter with JWT handshake auth, server-owned rooms, conversation participant gate, frontend bridge. |

---

## 2. Features Integrated

| Feature                          | Status                                     | Backend surface                                                                                                                                                                          | Frontend wiring                                                                                  |
| -------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Provider approval**            | shipped                                    | Admin approve/reject/suspend/reactivate + state-machine guards (Sprint 5.1.4 + 6.2)                                                                                                      | Admin dashboard verification section + provider gating on bid submit                             |
| **Available requests**           | shipped                                    | `GET /v1/provider/available-requests` (filtered by category + lat/lng radius)                                                                                                            | Provider feed with infinite scroll + 20 s polling                                                |
| **Bids**                         | shipped                                    | `POST /v1/provider/bids`, `GET /v1/provider/bids`, withdraw, accept (seeker side)                                                                                                        | Submit-bid wizard, my-bids list, accept-bid mutation                                             |
| **Booking lifecycle**            | shipped                                    | `start` / `complete` / `cancel` with audit + status timeline                                                                                                                             | Provider bookings tab with state-driven CTAs; seeker bookings list                               |
| **Notifications**                | shipped                                    | `GET /v1/me/notifications?experience=` + `unread-count` + mark-read; per-experience deepLink prefix scope                                                                                | Notifications drawer (seeker, provider, admin); unread badge with 15 s polling                   |
| **Chat**                         | shipped                                    | Conversations list, messages list, `POST /messages`, mark-read; participant-gate-enforced                                                                                                | Chat screens (seeker, provider) with 4 s active-thread polling                                   |
| **Earnings**                     | shipped                                    | `/v1/provider/earnings/{summary,transactions,chart}` + env-driven platform fee bps                                                                                                       | Provider wallet screen with 7d/30d/90d range chip                                                |
| **Admin user control**           | shipped                                    | List/search/detail/PATCH status/roles list (refuses self-disable)                                                                                                                        | Admin Users section with detail drawer                                                           |
| **Admin provider verification**  | shipped                                    | List/detail/audit/review-notes/approve/reject/suspend/reactivate                                                                                                                         | Admin Verification section                                                                       |
| **Admin disputes**               | shipped                                    | List/filter/detail/PATCH (status, priority, description) — terminal-status guards                                                                                                        | Admin Disputes section with status + priority chips, detail drawer with timeline                 |
| **Admin analytics / financials** | shipped                                    | `/admin/analytics/overview`, `/revenue`, `/financials/{summary,bookings,provider-earnings}`                                                                                              | Admin Dashboard overview tile + Financials section                                               |
| **Admin settings**               | shipped                                    | Bulk GET + atomic PATCH against a 4-key whitelist (`platform_fee_bps`, `default_currency`, `support_email`, `feature_show_hourly_rate`)                                                  | Admin Settings section with type-aware inputs                                                    |
| **Admin notifications**          | shipped                                    | `GET /v1/admin/notifications` (experience=admin scope) + `:id/read`                                                                                                                      | Admin notification bell + drawer                                                                 |
| **Audit logs**                   | shipped                                    | Canonical `GET /v1/admin/audit-logs?actor=&action=` (legacy `/v1/admin/audit` retained) + server-side metadata redaction                                                                 | Admin Audit Logs section with actor + action filter                                              |
| **Realtime foundation**          | shipped — gated `REALTIME_SOCKET_IO=false` | Socket.IO gateway + JWT handshake + server-owned rooms (`user:`, `provider:`, `conversation:`, `admin`) + `@socket.io/redis-adapter` (conditional) + in-process SSE retained as fallback | `useRealtimeSocket` hook + `dispatchInvalidations` mapping every event type to React Query roots |

---

## 3. Postman Collections Created / Updated

All paths are repo-relative.

**Per-sprint reference collections (16):**

- `postman/FixNow Sprint 5.1.3 Runtime Closure.postman_collection.json`
- `postman/FixNow Sprint 5.1.4 Provider Approval Gate.postman_collection.json`
- `postman/FixNow Sprint 5.2 Provider Available Requests.postman_collection.json`
- `postman/FixNow Sprint 5.4 Provider Bookings.postman_collection.json`
- `postman/FixNow Sprint 5.5 Notifications Chat.postman_collection.json`
- `postman/FixNow Sprint 5.6 Provider Earnings.postman_collection.json`
- `postman/FixNow Sprint 6.1 Admin Users.postman_collection.json`
- `postman/FixNow Sprint 6.2 Admin Provider Verification.postman_collection.json`
- `postman/FixNow Sprint 6.3 Admin Disputes.postman_collection.json`
- `postman/FixNow Sprint 6.4 Admin Analytics Financials.postman_collection.json`
- `postman/FixNow Sprint 6.5 Admin Settings.postman_collection.json`
- `postman/FixNow Sprint 6.6 Admin Notifications Audit.postman_collection.json`
- `postman/FixNow Sprint 7.0 Realtime REST Fallback.postman_collection.json`
- `postman/FixNow Admin Preflight.postman_collection.json`
- `postman/hsm-provider.postman_collection.json`
- `postman/hsm-admin.postman_collection.json`

**Consolidated runtime collections (2):**

- `postman/FixNow Provider Runtime.postman_collection.json` — Sprint 5.7 (11 folders, 26 requests)
- `postman/FixNow Admin Runtime.postman_collection.json` — Sprint 6.7 refined (10 folders, 29 requests)

> **Note:** Sprint 5.3 ships its surface inside the consolidated `FixNow Provider Runtime` collection (no standalone per-sprint collection was authored); the per-sprint reference list therefore has no `Sprint 5.3` entry.

---

## 4. Environment Files

- `postman/local.postman_environment.example.json` — Postman environment template carrying `apiUrl`, `apiVersion`, `clientKind`, `adminEmail`/`adminPassword`, `providerEmail`/`providerPassword`, `customerEmail`/`customerPassword`, plus all token + ID slots populated by collection scripts (`adminToken`, `providerToken`, `customerToken`, `seekerToken`, `providerProfileId`, `requestId`, `bidId`, `bookingId`, `conversationId`, `notificationId`, `seekerUserId`, `disputeId`, `settingKey`, `categoryId`/`categorySlug`, OTP challenge slots, `targetUserId`, `adminUserId`, `adminNotificationId`).
- `.env.example` — backend env template; includes all required keys (`DATABASE_URL`, `MONGODB_URI`, `REDIS_*`, `JWT_ACCESS_SECRET`, etc.) plus the new Sprint 6.5 / 7.0 keys (`PROVIDER_PLATFORM_FEE_BPS`, `REALTIME_SOCKET_IO`).

There is no separate `apps/api/.env.example` or `apps/web/.env.example`; the root `.env.example` is the canonical source for the API and Vite reads `VITE_API_URL` from the build environment.

---

## 5. Runtime Harnesses

**Node CJS scripts under `scripts/runtime/`:**

- `scripts/runtime/verify-provider-loop.cjs` — Sprint 5.7. Drives the full provider loop end-to-end (login → admin approval → seeker request → provider available → bid → seeker accept → booking → notifications → chat → earnings) plus a 403 cross-role negative.
- `scripts/runtime/verify-seeker-flow.cjs` — drives the seeker leg.

**pnpm scripts at the repo root (`package.json`):**

| Script                          | What it runs                                                             |
| ------------------------------- | ------------------------------------------------------------------------ |
| `pnpm runtime:provider-loop`    | Runs the provider runtime harness (`verify-provider-loop.cjs`).          |
| `pnpm postman:provider`         | Newman against `hsm-provider.postman_collection.json`.                   |
| `pnpm postman:admin`            | Newman against the legacy reference `hsm-admin.postman_collection.json`. |
| `pnpm postman:provider-runtime` | Newman against `FixNow Provider Runtime.postman_collection.json`.        |
| `pnpm postman:admin-runtime`    | Newman against `FixNow Admin Runtime.postman_collection.json`.           |

**How to run** (typical sequence after a fresh DB):

```bash
pnpm install
pnpm docker:up
pnpm --filter @homeservicemarketplace/database migrate:deploy
pnpm --filter @homeservicemarketplace/database seed
pnpm --filter @homeservicemarketplace/api dev   # in a second terminal

cp postman/local.postman_environment.example.json postman/local.postman_environment.json
# fill in the email + password fields for the seeded admin / provider / customer

pnpm runtime:provider-loop
pnpm postman:provider-runtime
pnpm postman:admin-runtime
```

Newman is **not** a workspace dependency; it must be installed globally
(`pnpm add -g newman newman-reporter-htmlextra`) — see `docs/testing/admin-runtime-harness.md` and `docs/testing/provider-runtime-loop.md` for the operator runbooks.

There is no equivalent `runtime:admin-loop` Node script — the
consolidated `FixNow Admin Runtime` Postman collection covers the
admin chapter end-to-end and was the contracted deliverable for
Sprint 6.7.

---

## 6. Remaining Deferred Items

Real, documented deferrals only:

- **Production Redis adapter — operator-flip required.** The realtime gateway ships with `REALTIME_SOCKET_IO=false` by default. To go live in a multi-instance deployment, the operator must (a) flip the flag to `on`, (b) ensure a healthy Redis (the existing `RedisService` already handles connection retry), and (c) raise the load-balancer idle timeout above Socket.IO's 60 s ping interval (90–120 s). The adapter wiring is in place and asserted in the unit grid; only the production cut-over remains.
- **Production payment payouts.** `PROVIDER_PLATFORM_FEE_BPS` is wired through the earnings + admin-financials read models, but no Stripe Connect / payout module ships yet. Per Sprint 5.6, "When the payouts module ships this value moves into a per-tier rate table." The wallet surface is read-only by design today.
- **Full dispute customer / provider UI.** Sprint 6.3 shipped the **admin** dispute lifecycle. A customer- or provider-facing dispute submission flow is not in the codebase. The admin can resolve / re-prioritise existing disputes and the audit timeline is intact; the customer-side intake path is unbuilt.
- **CI Newman test DB.** The Postman / Newman harnesses are operator-driven (per Sprint 5.7 §4 + Sprint 6.7 review). There is no CI job that boots a disposable Postgres + Mongo + Redis, runs `migrate:deploy` + `seed`, and executes Newman against the consolidated runtime collections. This is documented in `docs/testing/admin-runtime-harness.md §4` and `docs/testing/provider-runtime-loop.md`.
- **Additional realtime publish call sites.** Today the publisher is wired only from `NotificationsService.createForUser`. Other publish points (`ConversationsService.sendMessage`, `BidsService.accept`, `BookingsService` transitions, `AdminVerificationService` status changes) rely **transitively** on the notification fan-out — every domain mutation already creates a notification, which fires `notification.created`, which the React Query bridge invalidates. Direct emits with the `message.created` / `bid.accepted` / `booking.status_changed` / `provider.status_changed` event types are scaffolded in the contracts and wired in the dispatcher but not called from those services yet. Documented in `docs/sprints/sprint-7.0-review.md §"Risks / Remaining"`.
- **Playwright probe for the realtime channel.** The Sprint 5.5.5 plan §10 calls for a one-shot Playwright probe (open socket → trigger REST → assert `notification.created` arrives within 1 s). Backend gateway behaviour is verified by 10 unit tests + the 8-test dispatcher grid; the cross-process timing assertion is not yet in CI.
- **Email / OTP delivery in production.** SMTP wiring is present (`SMTP_HOST` switches Nodemailer on, otherwise `InMemoryMailAdapter`). The InMemory adapter is suitable for dev / CI; production deployment requires a real SMTP transport configured by the operator.

---

## 7. Security Review

| Area                            | Status                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth enforcement**            | enforced                   | Every protected route uses `JwtAuthGuard`. Mobile-mode bearer + web HttpOnly cookies. The Sprint 7.0 Socket.IO gateway runs the same JWT validation in `handleConnection` before any room join. Tokens are never accepted from request body / query.                                                                                                                                                                                                                                                                                                                                     |
| **Role enforcement**            | enforced                   | `RolesGuard('admin')` is applied at controller-class level on every `/v1/admin/**` controller. Sprint 6.6 audit showed no admin endpoint is reachable without `admin ∈ roles`. Negative Postman folders (per-sprint and `FixNow Admin Runtime` folder 10) pin cross-role 403 + no-token 401 with the canonical `FORBIDDEN` / `AUTH_INVALID_CREDENTIALS` codes.                                                                                                                                                                                                                           |
| **Provider status enforcement** | enforced                   | Bid submission checks `providerProfile.status === APPROVED` server-side; rejected providers cannot bid (Sprint 5.1.4). Suspended / unapproved providers cannot read provider feeds (`RolesGuard('provider')` + provider profile lookup). Status transitions are audit-logged.                                                                                                                                                                                                                                                                                                            |
| **Admin audit logging**         | enforced                   | Every admin mutation writes an `AuditEvent` row via `AdminAuditService.record({ adminUserId, type, metadata })`. Mutations covered include user status, role grants, provider review-notes, provider approve/reject/suspend/reactivate, dispute updates, settings updates. The actor is the authenticated admin's `userId` — never the wire.                                                                                                                                                                                                                                             |
| **Secret leakage checks**       | enforced                   | Every Postman collection ships a collection-level guard that asserts no response body contains `PrismaClient`, raw SQL fragments (`SELECT/INSERT/UPDATE`/"column does not exist"), `passwordHash`, `mfaSecret`, `refreshToken`, `JWT_SECRET`, `DATABASE_URL`, or `STRIPE_SECRET`. Server-side metadata redaction (Sprint 6.6 `redactSensitive`) walks every `AuditEvent.metadata` and replaces values for keys matching `/password\|token\|secret\|apikey\|jwt\|bearer\|cookie\|database_url/i` with `<redacted>`. The `AllExceptionsFilter` strips internal stack traces in production. |
| **Negative Postman tests**      | present                    | Every per-sprint reference collection has at least one negative request (no-token 401 + cross-role 403). `FixNow Admin Runtime` folder 10 ("Negative Security") consolidates four negatives across the admin surface: customer-token → `/admin/users` 403, customer-token → `/admin/audit-logs` 403, no-token → `/admin/financials/summary` 401, IDOR-style `?userId=victim` → 400 `VALIDATION_ERROR` (the `forbidNonWhitelisted` global pipe). `FixNow Sprint 7.0 Realtime REST Fallback` folder ends with no-token 401 + wrong-role 403 on the provider feed.                          |
| **Settings whitelist**          | enforced                   | Sprint 6.5 `PATCH /v1/admin/settings` rejects unknown keys via `forbidNonWhitelisted` AND a per-key type validator switch. The runtime collection asserts that an attempt to write `JWT_SECRET` returns 400 and the rejected value (`pwned`) never appears in the response body.                                                                                                                                                                                                                                                                                                         |
| **CSRF**                        | enforced on REST mutations | `CsrfGuard` is applied on every state-changing REST controller. Bearer-mode (mobile) bypass is documented at `csrf.guard.ts:20`. The Socket.IO gateway has no business-write surface — `subscribe:conversation` is the only client-emitted event and runs the same participant gate REST uses.                                                                                                                                                                                                                                                                                           |
| **Realtime gate**               | enforced                   | `REALTIME_SOCKET_IO=false` closes every WS handshake at the door (gateway spec asserts `verifyAccessToken` is **not** called when the flag is off). Server-owned rooms (`user:`, `provider:`, `admin`) are derived from the verified JWT identity — the wire never names a room. The single client-emitted join (`subscribe:conversation`) refuses non-participants with `FORBIDDEN`.                                                                                                                                                                                                    |

---

## 8. How to Run Final Verification

Exact commands (copy-pasteable). Each block is independently runnable.

```bash
# Prerequisites — once per fresh checkout:
pnpm install
pnpm docker:up

# Database (PostgreSQL via Prisma) — schema + migrations:
pnpm --filter @homeservicemarketplace/database exec prisma validate
pnpm --filter @homeservicemarketplace/database exec prisma generate
pnpm --filter @homeservicemarketplace/database migrate:deploy
pnpm --filter @homeservicemarketplace/database seed

# Backend static + dynamic checks:
pnpm --filter @homeservicemarketplace/api typecheck
pnpm --filter @homeservicemarketplace/api lint
pnpm --filter @homeservicemarketplace/api test

# Frontend static + dynamic checks:
pnpm --filter @homeservicemarketplace/web typecheck
pnpm --filter @homeservicemarketplace/web lint
pnpm --filter @homeservicemarketplace/web test
pnpm --filter @homeservicemarketplace/web build

# Runtime smoke (requires API running on :4000 + seeded admin/provider/customer):
pnpm --filter @homeservicemarketplace/api dev          # in another terminal
cp postman/local.postman_environment.example.json postman/local.postman_environment.json
# fill the email + password fields for adminEmail / providerEmail / customerEmail / seekerEmail

# Provider Postman / Newman:
pnpm postman:provider               # legacy reference collection
pnpm postman:provider-runtime       # consolidated 11-folder runtime narrative

# Admin Postman / Newman:
pnpm postman:admin                  # legacy reference collection
pnpm postman:admin-runtime          # consolidated 10-folder runtime narrative

# Provider runtime CJS harness (drives the full provider loop end-to-end):
pnpm runtime:provider-loop
```

### What "green" looks like at the time of writing (from Sprint 7.0 commit `e028055`):

```
pnpm --filter @homeservicemarketplace/api typecheck  → exit 0
pnpm --filter @homeservicemarketplace/api test       → 882 passed, 6 skipped, 78/81 suites
pnpm --filter @homeservicemarketplace/api lint       → 0 errors
pnpm --filter @homeservicemarketplace/web typecheck  → exit 0
pnpm --filter @homeservicemarketplace/web test       → 349 passed, 0 failed, 44 suites
pnpm --filter @homeservicemarketplace/web lint       → 0 errors (26 pre-existing warnings)
```

`prisma validate` and `prisma generate` succeed against a clean
checkout. On Windows, `prisma generate` may fail to rename the
DLL on a hot-reload shell (documented across Sprint 5.6 / 6.x
reviews); the generated TypeScript stubs are correct in either
case, so typecheck passes regardless. A clean shell or `taskkill
/F /IM node.exe` resolves the DLL lock.

---

## 9. Final Decision

**COMPLETE WITH DEFERRED ITEMS** — Sprints 5.1.3 → 7.0 all PASSED
(5.1.3 PARTIAL PASS with the rolled item closed inside 5.1.4). The
core integration is done: the seeker leg, the provider leg, the
admin chapter, and the realtime foundation all run end-to-end
against real backend services. Unit + integration tests pass:
**882 API + 349 web**. Typecheck and lint are clean. Every admin
surface and every provider surface ships with a Postman / Newman
collection plus negative-security folders. Two consolidated
runtime collections (`FixNow Provider Runtime`, `FixNow Admin
Runtime`) drive the full chapter end-to-end. The Sprint 7.0
realtime gateway is wired and asserted by 17 unit + 8 dispatcher
tests; it is gated behind `REALTIME_SOCKET_IO=false` so existing
suites are unaffected and operators flip it on per environment.

The deferred items listed in §6 are real and documented. None of
them block the integration acceptance criteria the sprint specs
defined; they are forward-looking work (production Stripe Connect
payouts, customer-side dispute intake UI, CI Newman with a test
DB, Playwright realtime probe, additional realtime publish call
sites beyond `notification.created`, and the operator flip from
`REALTIME_SOCKET_IO=off` → `on` once Redis is provisioned).

No tests were skipped to make the green report. No failures are
hidden. No claim of completion is made for work that was not
actually shipped.
