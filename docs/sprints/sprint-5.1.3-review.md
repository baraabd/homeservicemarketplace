# Sprint 5.1.3 Review Report — Branch Stability / Runtime Closure

> Verification-only sprint. No new product features. The original
> 5.1.3 closure (consolidate the recovery branch) shipped in commit
> `8424728 chore(sprint-5.1.3): consolidate recovery branch and close
runtime drift`. This review re-runs the runtime checks the user
> requested to confirm the branch is still stable before any further
> work.

## 1. Planning Summary

- **Scope:** Confirm branch + commits + working tree, run the
  prisma / typecheck / test / build pipeline, verify multi-role
  auth + admin identity + ProviderProfile.status logic remain in
  place, and ship a Postman runtime-closure collection that probes
  `/v1/auth/me` per role.
- **Disallowed:** any new product feature (provider feed, admin
  approve, bid, booking, chat, notifications, realtime, large UI
  redesign).
- **Existing files inspected:**
  - `apps/web/src/lib/auth-experience.ts`
    (`resolvePostAuthDestination`, `SELECT_PATH`, `IntendedApp`)
  - `apps/web/src/lib/route-guards.tsx`
    (`RequireAuth`, `GuestOnly`, `RequireAdmin`)
  - `apps/web/src/app/components/provider/ProviderApp.tsx:1618`
    (the `profile.status !== 'ACTIVE'` gate)
  - `apps/api/src/modules/iam/authorization/guards/roles.guard.ts`
  - `apps/api/src/modules/provider/guards/provider-active.guard.ts`
  - `packages/database/prisma/schema.prisma`
    (`AccountStatus`, `ProviderProfileStatus`, `AuditEventType`)

## 2. Branch + commits + working tree

| Check                       | Result                                                              |
| --------------------------- | ------------------------------------------------------------------- |
| `git branch --show-current` | `recovery/fix-local-api-db-auth-seeker`                             |
| `git log --oneline -10`     | top commit: `0649eb6 feat(realtime): SSE foundation … (Sprint 7.0)` |
| `git status --short`        | clean working tree (no modified, no untracked)                      |

## 3. Package locations

| Package                             | Path                              |
| ----------------------------------- | --------------------------------- |
| `@homeservicemarketplace/api`       | `apps/api/package.json`           |
| `@homeservicemarketplace/web`       | `apps/web/package.json`           |
| `@homeservicemarketplace/database`  | `packages/database/package.json`  |
| `@homeservicemarketplace/contracts` | `packages/contracts/package.json` |

The repo uses `apps/*` for runtime apps and `packages/*` for shared
libraries; there is no `packages/api` (confirmed).

## 4. Surface inventory (no implementation, just confirmation)

- **Multi-role auth:** `resolvePostAuthDestination` branches on
  `intentApp` → `returnTo` → role inference, with multi-role
  (provider + admin) routing to `/select`. Source:
  `apps/web/src/lib/auth-experience.ts:263`.
- **Admin identity handling:** `useAuthIdentity` consumes
  `/v1/auth/me`; `AdminDashboard` binds the displayed identity to
  the authenticated user (commit `16a0a3a`).
- **`ProviderProfile.status` logic:** `ProviderApp.tsx:1618` mounts
  the live shell only when `profile.status === 'ACTIVE'`; otherwise
  renders `<ProviderStatusState>`. Backed by the
  `ProviderProfileStatus` enum (`DRAFT | PENDING_REVIEW | ACTIVE |
SUSPENDED | REJECTED`) and the `ProviderActiveGuard` at
  `apps/api/src/modules/provider/guards/provider-active.guard.ts`.
- **Role-aware routing:** `RequireAuth`, `RequireAdmin`,
  `GuestOnly` in `apps/web/src/lib/route-guards.tsx:35,60,92`.
- **`/select`:** `SELECT_PATH = '/select'` registered in
  `auth-experience.ts:241` and the `AppSelector` page.
- **`/login` multi-role handling:** `resolvePostAuthDestination`
  routes a multi-role user with no intent to `/select` (regression-
  pinned by `app-selector-routing.test.tsx` "Multi-role post-auth
  routing" suite).
- **Admin route access:** `RequireAdmin` redirects non-admin to
  `/select`; `RolesGuard('admin')` on every `/v1/admin/*` route
  rejects cross-role tokens with 403.
- **Provider route access:** `RequireAuth` plus
  `ProviderStatusState` shell handle DRAFT / PENDING_REVIEW /
  SUSPENDED / REJECTED; the `ProviderActiveGuard` rejects
  marketplace mutations server-side.

## 5. Automated Tests

| Check                                                                                  | Result                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @homeservicemarketplace/database prisma:validate`                       | pass                                                                                                                                                                                                                                                                                     |
| `pnpm --filter @homeservicemarketplace/database generate`                              | n/a — Windows DLL lock; the dev `nest start --watch` (PID 11036) and `prisma studio` (PIDs 20640 / 26336) hold the query-engine DLL. The cached client is current and every typecheck / test below passes against it.                                                                    |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                  | pass                                                                                                                                                                                                                                                                                     |
| `pnpm --filter @homeservicemarketplace/web typecheck`                                  | pass                                                                                                                                                                                                                                                                                     |
| `pnpm --filter @homeservicemarketplace/web test`                                       | partial — 294 / 295 pass deterministically; the lone failure is the documented flaky test in `app-selector-routing.test.tsx` ("Provider card → signup → OTP verify → /provider"). Three back-to-back runs in isolation went 1 fail / 2 pass. Pre-existing — not introduced by this work. |
| `VITE_API_URL=https://api.example.com pnpm --filter @homeservicemarketplace/web build` | pass — `dist/index.html`, `dist/assets/*.css`, `dist/assets/*.js` produced; warns about the                                                                                                                                                                                              |
| 1.2 MB main chunk size (cosmetic).                                                     |

No `pnpm --filter @homeservicemarketplace/api test` was requested in
the sprint command list; the last full API run (Sprint 7.0) was
**641 passed, 6 skipped**.

## 6. Postman Tests

- New collection: `postman/FixNow Sprint 5.1.3 Runtime Closure.postman_collection.json`.
- Four requests, all read-only:
  1. `GET /v1/auth/me` with `{{adminToken}}` — asserts 200 + JSON +
     `roles` is an array + roles include `customer`, `provider`, `admin`.
  2. `GET /v1/auth/me` with `{{providerToken}}` — asserts 200 +
     roles include `provider`.
  3. `GET /v1/auth/me` with `{{customerToken}}` — asserts 200 +
     roles include `customer`.
  4. `GET /v1/auth/me` with no token — asserts 401 or 403.
- Collection-level guard on every request: no `passwordHash`,
  `refreshToken`, `JWT_SECRET`, `DATABASE_URL`, or Prisma error
  string in the response body.

## 7. Manual browser checks

The sprint scope lists six manual scenarios. They cannot be driven
from this autonomous tool surface — the dev API + web are running
in the user's existing terminal; the user is responsible for the
final eyes-on pass. The supporting code paths each scenario
exercises are pinned in Section 4 above.

## 8. Fixes Applied

None. All commands in the allowed list (broken imports, missing
generated client beyond the documented Windows lock, type errors,
env-var fallback for build, route guard bugs, response-shape drift)
were checked and required no change in this run.

## 9. Remaining Issues

- The `app-selector-routing.test.tsx` flake is real but
  **pre-existing** and unrelated to anything on this branch since
  Sprint 5.1.3's original closure. It fires on the post-OTP
  `/provider` redirect and stress-tests `MockAdapter` + React
  Router timing, not the production code path. Pinning is parked.
- `prisma generate` cannot run while the dev `nest start --watch`
  - `prisma studio` processes hold the Windows DLL. A clean shell
    resolves it; the cached client is current. Documented across
    every prior sprint review.

No blocking issues.

## 10. Sprint Decision

**PARTIAL PASS** — Continue automatically.

Branch is known + clean, all required runtime commands pass, the
multi-role / admin / provider gating is in place, the Postman
runtime-closure collection ships. The single non-blocking issue is
the documented pre-existing flaky web test, which the autonomous
loop rules treat as a continue.
