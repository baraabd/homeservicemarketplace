# Sprint 5.1.4 Review Report — Minimal Provider Approval Gate

## 1. Planning Summary

- **Scope:** Confirm the marketplace approval gate (`ProviderActiveGuard`) and the
  underlying `ProviderProfile.status` state machine ship as a complete, testable
  unit before the marketplace write surfaces (5.3 submit-bid, 5.4 bookings) come
  online. Add Postman scaffolding (collection skeleton + environment template)
  so the negative path is rehearsable from day one.
- **Existing files inspected:**
  - `apps/api/src/modules/provider/guards/provider-active.guard.ts`
  - `apps/api/src/modules/provider/guards/provider-active.guard.spec.ts`
  - `apps/api/src/modules/provider/provider.module.ts`
  - `apps/api/src/modules/iam/authorization/guards/roles.guard.ts`
  - `packages/database/prisma/schema.prisma` (`ProviderProfileStatus` enum)
  - `docs/postman/hsm-local.postman_environment.json`
  - `docs/postman/hsm-seeker.postman_collection.json`
- **Dependencies found:** Sprint 5.1.2 already shipped `ProviderActiveGuard`,
  the `ProviderProfileStatus` enum (`DRAFT | PENDING_REVIEW | ACTIVE | SUSPENDED | REJECTED`),
  the migration that adds `status` with `DRAFT` default and a `_status_idx` index,
  and exported the guard from `ProviderModule`. The unit test suite covers all
  five status branches plus the missing-profile and unauthenticated edges.
- **Risks found:**
  - Mounting the gate on the existing read endpoints (`GET /v1/me/provider/profile`)
    would lock DRAFT / PENDING_REVIEW providers out of their own onboarding UI —
    deliberate non-decision: the gate stays off the read paths until 5.3 ships
    the write surfaces. Documented in the collection skeleton's folder 11 note.
  - The local upgrade flow stamps `ACTIVE` (per `ProviderService.UPGRADE_DEFAULT_STATUS`).
    Production tightens this to `PENDING_REVIEW` once the admin moderation surface
    lands in 6.2 — no other call-site touches the column. Captured in
    Sprint 6.2's plan (no action this sprint).

## 2. Implementation Summary

- **Files added:**
  - `postman/local.postman_environment.example.json` — global environment template
    matching the placeholders mandated by the autonomous-sprint global instructions
    (`apiUrl`, `adminEmail`, `providerEmail`, `customerEmail`, all token / id keys).
  - `postman/hsm-provider.postman_collection.json` — provider-side collection
    skeleton with folders `10 Profile (5.1)` (5 requests with positive + forbidden-field
    negative) and `11 Approval Gate (5.1.4)` (no-token + cross-role-token negatives).
- **Files changed:** none.
- **Migrations added:** none.
- **Contracts added/changed:** none.
- **UI added/changed:** none.
- **API endpoints added/changed:** none. The gate is wired _into_ future routes,
  not added as a new endpoint.

## 3. Automated Tests

| Check                                                                                  | Result                                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `prisma validate`                                                                      | pass (verified in 5.1.3)                                                              |
| `prisma generate`                                                                      | n/a (Windows DLL lock from running dev processes; cached client current)              |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                  | pass (verified in 5.1.3)                                                              |
| `pnpm --filter @homeservicemarketplace/web typecheck`                                  | pass (verified in 5.1.3)                                                              |
| `pnpm --filter @homeservicemarketplace/api test -- --testPathPattern=provider-active`  | pass — 8 tests pass (every status branch + missing profile + unauth + envelope shape) |
| `pnpm --filter @homeservicemarketplace/web test`                                       | pass (verified in 5.1.3)                                                              |
| `VITE_API_URL=https://api.example.com pnpm --filter @homeservicemarketplace/web build` | pass (verified in 5.1.3)                                                              |

## 4. Postman Tests

- Collection created/updated: `postman/hsm-provider.postman_collection.json` (new).
- Environment example created/updated: `postman/local.postman_environment.example.json` (new).
- Requests added:
  - `POST /v1/me/provider/upgrade` — captures `providerProfileId` into the env.
  - `GET  /v1/me/provider/profile`
  - `PATCH /v1/me/provider/profile` (positive)
  - `PATCH /v1/me/provider/profile` (negative — forbidden fields `status`, `userId`, `verified`)
  - `PATCH /v1/me/provider/availability`
  - `GET /v1/me/provider/profile` (no token — must 401/403/404)
  - `GET /v1/me/provider/profile` (customer token — must 403)
- Positive tests: status code + JSON envelope + key fields echoed back.
- Negative tests: status code + Prisma/secret-leak guard at collection level.
- Newman run result: not yet integrated into CI; deferred to Sprint 5.7 where the
  full provider end-to-end flow ships and a `pnpm postman:provider` Newman script
  becomes meaningful.

## 5. Manual Checks

- Scenario: `ProviderActiveGuard` blocks every non-`ACTIVE` status.
  Expected: 403 with `{ code: 'FORBIDDEN' }` body for `DRAFT`, `PENDING_REVIEW`,
  `SUSPENDED`, `REJECTED`, missing profile, and unauthenticated.
  Actual: 8/8 unit cases pass.
  Result: pass.
- Scenario: gate is exported and importable by future modules.
  Expected: `ProviderActiveGuard` listed in `ProviderModule.exports`.
  Actual: confirmed at `apps/api/src/modules/provider/provider.module.ts:23`.
  Result: pass.
- Scenario: gate composition rule documented for upcoming sprints.
  Expected: a single, explicit recipe for "how to lock a route to active providers".
  Actual: documented in the Sprint 5.1.4 collection's folder 11 description and in
  the guard source comment. Recipe is `@UseGuards(JwtAuthGuard, RolesGuard, ProviderActiveGuard)`
  combined with `@Roles('provider')`.
  Result: pass.

## 6. Fixes Applied

None. The gate, status field, and tests were already in place from Sprint 5.1.2;
this sprint adds the Postman scaffolding only.

## 7. Remaining Issues

- The actual _mounting_ of the gate happens in Sprints 5.3 (submit-bid) and
  5.4 (booking transitions). Folder 11 of the provider collection currently
  exercises the guard against routes that _don't yet exist_; that is by
  design — the negatives become real once those routes ship.

No remaining blockers.

## 8. Sprint Decision

**PASS** — Continue automatically.
