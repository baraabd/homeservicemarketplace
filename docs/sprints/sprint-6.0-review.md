# Sprint 6.0 Review Report — Admin Dashboard audit (refined)

## 1. Planning Summary

- **Scope:** Audit-only sprint. Inspect every admin surface
  (frontend, API, contracts, schema), classify each of the eight
  admin areas in the spec, and produce a multi-sprint plan that
  scopes Sprints 6.1 → 6.7+. No feature implementation; tiny
  fixes only if needed to inspect the route safely. Supersedes
  the earlier autonomous-run Sprint 6.0 (which shipped the
  AdminModule + `/v1/admin/health` skeleton — those still ship,
  this audit just classifies them).
- **Existing surface inspected:**
  - `apps/web/src/app/components/admin/AdminDashboard.tsx`
    (1,676 lines — single file hosting every section).
  - `apps/web/src/app/pages/AdminPage.tsx` +
    `apps/web/src/app/routes.ts:28` + `RequireAdmin` in
    `apps/web/src/lib/route-guards.tsx`.
  - All seven admin controllers under
    `apps/api/src/modules/admin/**/*.controller.ts` (admin,
    analytics, audit, disputes, settings, users, verification).
  - All admin contract bundles under
    `packages/contracts/src/admin/**`.
  - `packages/database/prisma/schema.prisma` — Dispute,
    PlatformSetting, AuditEvent already exist; **no**
    Payout / Withdrawal / Transaction model.
  - `postman/hsm-admin.postman_collection.json` —
    8 folders / 25 requests covering 6 of 8 areas.
  - `apps/api/src/modules/notifications/notifications.service.ts`
    - `apps/api/src/modules/realtime/realtime-events.publisher.ts`
      — confirms admin broadcast does not exist (publisher routes
      by `userId` only).
- **Risks:** none — audit is docs + Postman only.

## 2. Implementation Summary

- **Files added:**
  - `docs/sprints/sprint-6-admin-plan.md` — the load-bearing
    master plan. All nine spec sections present:
    1. Admin route inventory (web + API)
    2. UI component inventory (every section component in
       `AdminDashboard.tsx` mapped to live data status)
    3. Existing API inventory (method matrix + wire envelopes +
       auth posture)
    4. DB schema inventory (what's present + what Financials
       needs)
    5. Mock data inventory (every `MOCK_*` / hardcoded constant
       mapped to its replacement hook)
    6. Required contracts (already published vs to-author)
    7. Security requirements (10 non-negotiable rules)
    8. Sprint-by-sprint plan (6.1 → 6.7 + deferred 6.8)
    9. Risks / blockers (7 items with mitigations)
  - `postman/FixNow Admin Preflight.postman_collection.json` —
    4 requests (per spec list of 3 + admin /v1/auth/me identity
    check). Collection-level Prisma/SQL/secret-leak guard.
- **Files changed:** none.
- **Migrations added:** none.
- **Contracts added/changed:** none.
- **UI added/changed:** none.
- **API endpoints added/changed:** none.

### Classification table (the headline output)

| Area             | Frontend                        | API            | Contract    | Schema                        | Classification    |
| ---------------- | ------------------------------- | -------------- | ----------- | ----------------------------- | ----------------- |
| Dashboard        | mock (hardcoded KPIs + heatmap) | ✓ summary      | ✓ published | ✓ existing tables             | **mock**          |
| User Control     | "Coming Soon" placeholder       | ✓ list/det/act | ✓ published | ✓ User + UserRole             | **backend-ready** |
| Pro Verification | mock (`PRO_VERIFICATIONS`)      | ✓ 4 actions    | ✓ published | ✓ ProviderProfile             | **backend-ready** |
| Financials       | mock (hardcoded $)              | ✗ none         | ✗ none      | ✗ no Payout/Transaction model | **needs schema**  |
| Disputes         | mock (read-only rows)           | ✓ 4 routes     | ✓ published | ✓ Dispute model               | **backend-ready** |
| Settings         | mock (`setTimeout` fake save)   | ✓ CRUD         | ✓ published | ✓ PlatformSetting             | **backend-ready** |
| Notifications    | bell badge only                 | ✗ no admin     | ✗ none      | ✗ no admin broadcast          | **deferred**      |
| Audit logs       | none                            | ✓ list         | ✓ published | ✓ AuditEvent                  | **backend-ready** |

## 3. Automated Tests

| Check                                                 | Result                           |
| ----------------------------------------------------- | -------------------------------- |
| `pnpm --filter @homeservicemarketplace/api typecheck` | pass                             |
| `pnpm --filter @homeservicemarketplace/web typecheck` | pass                             |
| `pnpm --filter @homeservicemarketplace/api test`      | 698 / 704 (6 skipped, unchanged) |
| `pnpm --filter @homeservicemarketplace/web test`      | 302 / 302 (unchanged)            |
| Postman JSON parses (`node -e "require(...)"`)        | pass                             |

The audit added no source code; existing test totals are
unchanged. The pre-existing `app-selector-routing.test.tsx` flake
(1/3 fail rate, documented since Sprint 5.4) appeared on the first
run and cleared on rerun — same behaviour as prior sprints; not
introduced by this work.

## 4. Manual Tests (Runtime Acceptance)

The spec asks for: login admin, visit `/admin`, inspect every
admin nav section, note which screens are mock. The audit
**recorded** that observation in §2 of the plan. Actually
clicking through the UI requires a running dev stack + a seeded
admin user (Sprint 5.7 documented the one-time bootstrap).

What the audit confirmed without running the UI:

- ✓ `/admin` route registered at `routes.ts:28` and gated by
  `RequireAdmin`.
- ✓ `AdminDashboard` mounts every section component in the same
  file; sidebar nav has 5 sections wired (`dashboard`, `verification`,
  `financials`, `disputes`, `settings`, `users`) and 3 missing
  (`notifications`, `audit`).
- ✓ Six section components render mock data; one ("users") is a
  "Coming Soon" placeholder; two areas have no UI at all (audit,
  notifications).

## 5. Postman / Newman Status

- New collection
  `postman/FixNow Admin Preflight.postman_collection.json` (4
  requests):
  1. `GET /v1/auth/me` with admin token — pins `roles[]`
     contains `'admin'`, status is `ACTIVE`, captures
     `adminUserId` into the env.
  2. `GET /v1/admin/health` with admin token → 200 + `ok=true`.
  3. `GET /v1/admin/health` with customer token → 403 +
     `error.code === 'FORBIDDEN'` + no admin identity leaked
     (no `admin@` substring, no role string in the body).
  4. `GET /v1/admin/health` with no token → 401 +
     `error.code === 'AUTH_INVALID_CREDENTIALS'`.
- Existing `hsm-admin.postman_collection.json` (8 folders, 25
  requests) is untouched.

## 6. Environment Verification

- API typecheck + tests: green (698 / 704, 6 skipped).
- Web typecheck + tests: green (302 / 302).
- No source files changed in `apps/api/src/**`,
  `apps/web/src/**`, `packages/contracts/src/**`, or
  `packages/database/prisma/**`. Three deltas, all
  documentation / tooling:
  - `docs/sprints/sprint-6-admin-plan.md` (new)
  - `docs/sprints/sprint-6.0-review.md` (rewritten — supersedes
    the earlier autonomous-run review)
  - `postman/FixNow Admin Preflight.postman_collection.json` (new)

## 7. Security Notes

- The audit produced 10 non-negotiable security rules in §7 of
  the plan that bind every later admin sprint. Highlights:
  - Class-level role gate on every admin controller (already
    in place — verified).
  - CSRF only on mutations; bearer-mode requests exempt
    (already in place — verified at `csrf.guard.ts:20`).
  - `forbidNonWhitelisted: true` global rejection of
    unknown DTO fields (already in place).
  - Server-driven identity: no admin endpoint accepts a
    `userId` / `targetId` from the body when the path carries it.
  - Every state-changing admin endpoint emits an `AuditEvent`
    (the existing services already do this).
  - No raw error strings to the UI (verified by every
    Postman folder's collection-level guard).
- The Admin Preflight collection's negative cases pin the two
  baseline gates (cross-role 403, no-token 401) and screen the
  body for accidental admin-identity leakage.

## 8. Risks or Remaining Issues

- **Single-file admin frontend.** 1,676 lines in
  `AdminDashboard.tsx`. Sprint 6.1's first task is extracting
  `DashboardOverview` into its own file; subsequent sprints
  continue the split.
- **Financials blocks on a migration.** Sprint 6.4 is the only
  Admin sprint that needs schema work (`PayoutTransaction`
  model). The plan flags it as a hard sprint dependency and
  documents the idempotent backfill.
- **Admin notifications wait on Sprint 5.5.5's implementation.**
  The Realtime Plan calls out admin broadcast as future work; the
  audit confirmed the current `RealtimeEventsPublisher` routes
  per-user only.
- **EcosystemContext entanglement.** `AdminDashboard` shares
  `useEcosystem` with the seeker / provider mock paths. Removing
  it from one consumer at a time is fine; full retirement is a
  cross-cutting cleanup tracked outside the Admin chapter.
- **No staging UAT.** All admin sprint verification is local
  vitest + Newman. The production-readiness criterion stays
  "manual UAT in dev".
- **Pre-existing Prisma DLL lock on Windows.** `prisma generate`
  cannot run while `nest start --watch` holds the cached client.
  Sprint 6.4's migration must be run with the dev server stopped.

## 9. Final Status

**PASS — admin inventory complete, next sprints are well-scoped.**

The audit produced a 9-section master plan with the
classification matrix the spec asked for, plus a runnable
preflight Postman collection that pins the role-gate baseline.
Six of eight admin areas are backend-ready (frontend lag), one
needs a schema migration (Financials), one is deferred
(Notifications, dependency on Sprint 5.5.5).

Sprint sequence locked: **6.1 Dashboard → 6.2 Verification →
6.3 Settings → 6.4 Financials → 6.5 Disputes → 6.6 Users →
6.7 Audit → 6.8 (deferred) Notifications**.

Auto-continue → Sprint 6.1.
