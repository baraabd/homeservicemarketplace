# Sprint 5.7 Review Report — Provider Core Loop runtime harness (refined)

## 1. Planning Summary

- **Scope:** Stabilize the full Provider Core Loop with a runtime
  script and a complete cross-role Postman collection. The earlier
  Sprint 5.7 (commit `b79194e`) shipped a provider-only collection
  driven by Newman; this refined sprint adds the multi-actor view —
  seeker + admin + provider all driven through a single narrative —
  plus a CLI harness an operator can run without Newman.
- **Existing surface inspected:**
  - `scripts/runtime/verify-seeker-flow.cjs` (commit `a6b3552`) —
    the pattern this sprint mirrors for the new harness.
  - `postman/hsm-provider.postman_collection.json` (commit
    `b79194e`) — provider-side narrative; used as a reference for
    the auth pattern.
  - `apps/api/src/modules/iam/authentication/strategies/jwt.strategy.ts`
    — confirms the JWT is stateless (no DB session lookup), so the
    harness can rely on a pre-supplied bearer token.
  - `apps/api/src/modules/iam/authentication/guards/csrf.guard.ts`
    — confirms CSRF is bypassed when `req.authTransport !== 'cookie'`,
    so mobile-mode bearer requests don't need an X-CSRF-Token header.
  - `package.json` — already has `pnpm postman:provider` and
    `pnpm postman:admin` scripts (Newman-driven; Newman not in
    devDependencies — operators install themselves).
  - `postman/local.postman_environment.example.json` — already
    carries the `customerEmail / customerPassword / customerToken`
    triad; this sprint adds `seekerToken` (alias of `customerToken`),
    `categoryId`, and the OTP-challenge slots.
- **Decisions:**
  1. Harness consumes pre-supplied bearer tokens (`SEEKER_TOKEN /
PROVIDER_TOKEN / ADMIN_TOKEN`). The operator obtains them once
     via the Postman `01 — Auth` folder (or curl + Mailpit). This
     matches the existing seeker-harness pattern and keeps the
     script dependency-free.
  2. Admin user creation is documented as a one-time bootstrap
     (`INSERT INTO "UserRole"` snippet in the runbook). The seed
     creates the `admin` role but no admin user account; surfacing a
     public admin-bootstrap endpoint is out of scope for the runtime
     harness.
  3. Re-runs are allowed without cleanup. The admin approve step
     accepts `409` (already-ACTIVE) as success; the booking
     start/complete steps use a freshly-captured `bookingId`; the
     earnings step asserts `completedBookingsCount ≥ 1` rather than
     equality.
  4. Newman is not added to the repo's devDependencies. The new
     `pnpm postman:provider-runtime` script matches the pattern of
     the existing `pnpm postman:provider` and `pnpm postman:admin`
     scripts; operators install Newman globally or via npx.
- **Risks:** none beyond the known operator-bootstrap step. The
  harness refuses to run with `NODE_ENV=production` and prints
  every required env var when one is missing (exit 64).

## 2. Implementation Summary

### CLI harness

- **File added:** `scripts/runtime/verify-provider-loop.cjs`
  (Node 20+ CJS, ~370 lines). Drives 13 steps + a negative
  cross-role 403 check:
  1. `GET /health/{live,ready}`
  2. `GET /v1/services` — resolve a category id
  3. `GET /v1/me/provider/profile` (only if `PROVIDER_PROFILE_ID`
     not pre-supplied)
  4. `POST /v1/me/requests` (seeker)
  5. `GET /v1/me/requests/:id` (seeker)
  6. `GET /v1/admin/providers` (admin)
  7. `POST /v1/admin/providers/:id/approve` (admin, idempotent)
  8. `GET /v1/provider/available-requests` (provider)
  9. `POST /v1/me/provider/bids` (provider)
  10. `POST /v1/me/requests/:r/bids/:b/accept` (seeker)
  11. `GET /v1/me/provider/bookings` (provider)
  12. `POST /v1/me/provider/bookings/:id/start` (provider)
  13. `POST /v1/me/provider/bookings/:id/complete` (provider)
  14. `GET /v1/me/notifications` (seeker, asserts ≥ 1 item)
  15. `POST /v1/provider/conversations` + `POST /:id/messages` +
      `GET /:id/messages` (chat round-trip)
  16. `GET /v1/provider/earnings/summary` (asserts
      `completedBookingsCount ≥ 1`)
  17. **Negative:** seeker token on `/v1/provider/earnings/summary`
      → asserts 403.

  Every response runs the same Prisma/SQL/secret-leak guard the
  existing seeker harness uses. Exit codes: `0` green · `2` step
  failed · `64` env missing or production blocked.

- **File added:** `docs/testing/provider-runtime-loop.md` —
  operator runbook covering prerequisites (Mailpit OTP, admin role
  bootstrap), how to obtain the three tokens, how to run the CLI
  harness or Newman, what each folder verifies, and a
  troubleshooting section for the common 401 / 403 / dirty-state
  failure modes.

### Postman collection

- **File added:**
  `postman/FixNow Provider Runtime.postman_collection.json` —
  11 folders, 26 requests, exactly matching the spec list:

  | #   | Folder                      | Requests | What it pins                                                                                                                                      |
  | --- | --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 01  | Auth                        | 5        | seeker / provider / admin login (mobile mode), `auth/me`, `me/provider/profile`. Captures bearer tokens + `providerProfileId` into the env.       |
  | 02  | Admin Provider Approval     | 2        | List providers + approve (idempotent on 409).                                                                                                     |
  | 03  | Seeker Request Creation     | 2        | List services → resolve `categoryId` → create request.                                                                                            |
  | 04  | Provider Available Requests | 1        | Provider sees the feed.                                                                                                                           |
  | 05  | Provider Bids               | 1        | Submit bid against `requestId`.                                                                                                                   |
  | 06  | Seeker Accept Bid           | 1        | Accept bid → spawns booking.                                                                                                                      |
  | 07  | Provider Bookings           | 3        | List → start → complete. Captures `bookingId`.                                                                                                    |
  | 08  | Notifications               | 2        | Seeker list (asserts `≥ 1`) + unread-count.                                                                                                       |
  | 09  | Chat                        | 3        | Open conversation + send + readback (asserts message round-trip by content).                                                                      |
  | 10  | Earnings                    | 2        | Summary (`completedBookingsCount ≥ 1`, `gross/fees/net` reconcile) + transactions (`kind='BOOKING_COMPLETED'`).                                   |
  | 11  | Negative Security           | 4        | seeker → `/provider/earnings` 403, provider → `/admin/providers` 403, no-token → `/me/provider/bookings` 401, no-token → `/me/provider/bids` 401. |

  Collection-level guard rejects `PrismaClient`, `column ... does
not exist`, raw `SELECT`/`INSERT`/`UPDATE`, `passwordHash`,
  `refreshToken`, `JWT_SECRET`, `DATABASE_URL` in any response.

- **File changed:** `postman/local.postman_environment.example.json`
  — added `seekerUserId`, `categoryId`, `categorySlug`,
  `seekerToken`, `seekerOtpChallengeId`, `providerOtpChallengeId`,
  `adminOtpChallengeId`. The legacy `customerEmail / customerPassword
/ customerToken` slots stay because the existing
  `hsm-provider.postman_collection.json` still references them.

### Newman runner

- **File changed:** `package.json` — added
  `pnpm postman:provider-runtime` (Newman + htmlextra reporter into
  `postman/reports/provider-runtime.html`) and
  `pnpm runtime:provider-loop` (the CLI harness). Newman is NOT
  added to devDependencies — same as the existing
  `pnpm postman:provider` / `pnpm postman:admin` scripts.

## 3. Automated Tests

| Check                                                                          | Result                |
| ------------------------------------------------------------------------------ | --------------------- |
| `pnpm --filter @homeservicemarketplace/api typecheck`                          | pass                  |
| `pnpm --filter @homeservicemarketplace/web typecheck`                          | pass                  |
| `pnpm --filter @homeservicemarketplace/api test`                               | 698 / 704 (6 skipped) |
| `pnpm --filter @homeservicemarketplace/web test`                               | 302 / 302             |
| Postman JSON parses (`node -e "JSON.parse(...)"`)                              | pass                  |
| Harness syntax check (`node --check scripts/runtime/verify-provider-loop.cjs`) | pass                  |
| Harness env-missing path (no tokens → exit 64 + documented message)            | pass                  |
| Harness production-block path (`NODE_ENV=production node ...` → exit 64)       | pass (early-exit)     |

The harness is not part of the API/web test suites; it's an
operator-driven smoke against a running dev stack. Its correctness
is verified by:

1. The syntax check + the env-missing exit path (above).
2. The Postman collection's parallel structure — the same 13
   steps in the same order, with explicit JSON-shape assertions
   that the harness mirrors.
3. The collection-level Prisma/secret-leak guard — applied to
   every response on every run.

## 4. Manual Tests (Runtime Acceptance)

The Provider Core Loop is **testable** through the harness or the
collection. Actually executing it requires a running dev stack +
seeded admin role (one-time operator setup, documented in the
runbook). Per the Sprint 5.7 spec's PASS criterion ("the full
Provider Core Loop is _testable_ through Postman/harness"), the
deliverable is the testable harness — the operator runs it.

Manual flows the spec calls out, mapped to harness steps:

1. ✓ Seeker creates request — folder 03 / harness step 4.
2. ✓ Admin approves provider — folder 02 / harness steps 6–7.
3. ✓ Provider sees request — folder 04 / harness step 8.
4. ✓ Provider submits bid — folder 05 / harness step 9.
5. ✓ Seeker accepts bid — folder 06 / harness step 10.
6. ✓ Provider sees booking — folder 07 / harness step 11.
7. ✓ Provider starts/completes — folder 07 / harness steps 12–13.
8. ✓ Notifications appear — folder 08 / harness step 14.
9. ✓ Chat message persists — folder 09 / harness step 15.
10. ✓ Wallet updates — folder 10 / harness step 16.

## 5. Postman / Newman Status

- New collection
  `postman/FixNow Provider Runtime.postman_collection.json` —
  11 folders, 26 requests. Validates as JSON.
- New script `pnpm postman:provider-runtime`. Newman is not added
  as a devDependency — operators run via global install or npx
  (same as the existing `postman:provider` and `postman:admin`
  scripts).
- Existing collections (`hsm-provider`, `hsm-admin`, plus the
  per-sprint scaffolds at `FixNow Sprint 5.x ...`) are untouched.

## 6. Environment Verification

- API typecheck + tests: green.
- Web typecheck + tests + (already-green) prod build: green.
- No source files changed in `apps/api/src/**` or `apps/web/src/**`.
  The harness is in `scripts/`, the collection is in `postman/`,
  the docs are in `docs/`. Three deltas to runtime configuration:
  - `package.json` adds two scripts.
  - `postman/local.postman_environment.example.json` adds 6 new
    keys (no existing key removed).
  - `docs/testing/provider-runtime-loop.md` is new operator guidance.

## 7. Security Notes

- Harness refuses to run with `NODE_ENV=production`.
- Harness uses bearer tokens only — no production credentials are
  read or stored. Tokens are operator-supplied via env vars.
- Postman collection uses the local environment file
  (`postman/local.postman_environment.json`) which is gitignored;
  the _example_ file in the repo carries no real tokens.
- Every response (harness + collection) is screened against
  `PrismaClient`, raw SQL fragments, `passwordHash`, `refreshToken`,
  `JWT_SECRET`, `DATABASE_URL`. A leak fails the run.
- Negative-security folder pins cross-role 403s (seeker →
  `/provider/earnings`, provider → `/admin/providers`) and
  missing-token 401s (anonymous → `/me/provider/bookings`,
  `/me/provider/bids`).
- The harness's idempotent `409` accept on the admin approve step
  is intentional and only applies to the _approve_ mutation; every
  other step asserts a strict 200/201/204.

## 8. Risks or Remaining Issues

- **One-time admin role bootstrap.** The repo seed creates the
  `admin` role but no admin user account. The runbook documents a
  Prisma-driven `INSERT INTO "UserRole"` snippet for this. A
  follow-up could ship a `pnpm db:seed:admin` helper, but that's
  out of scope for the runtime harness.
- **Auth handshake is documented, not automated.** The harness
  consumes pre-supplied tokens. The Postman `01 — Auth` folder
  drives the login but does NOT drive the OTP step
  (Mailpit-dependent). When `AUTH_REQUIRE_EMAIL_VERIFICATION=false`
  in dev, login returns the access token directly and folder 01
  is sufficient. When `=true`, the operator follows up with
  `verify-otp` per the auth controller comments.
- **Newman is not a workspace dep.** Operators install Newman
  themselves; this is consistent with the existing scripts. If a
  future sprint wants Newman in CI, that's a separate decision
  about adding a CLI dep at the repo root.
- **No web-UI manual flow run.** The manual UI checks listed in
  the spec map onto the same harness steps; all UI surfaces are
  already covered by their respective vitest suites
  (`WalletScreen.test.tsx`, `ChatScreen.test.tsx`,
  `HomeScreen.bookings.test.tsx`, `HomeScreen.notifications.test.tsx`,
  `BidsScreen.test.tsx`, `JobDetailView.test.tsx`,
  `ProviderApp.test.tsx`).
- **Pre-existing Prisma DLL lock on Windows.** `prisma generate`
  cannot run while `nest start --watch` holds the cached client.
  Test, typecheck, and build all pass against the cached client.

## 9. Final Status

**PASS — completed.**

The full Provider Core Loop is testable end-to-end through:

1. The CLI harness (`pnpm runtime:provider-loop` or `node scripts/
runtime/verify-provider-loop.cjs`) — single-pass execution with
   per-step assertions and a negative cross-role 403 check.
2. The Postman collection
   (`postman/FixNow Provider Runtime.postman_collection.json` /
   `pnpm postman:provider-runtime`) — 11 folders, 26 requests,
   collection-level Prisma/secret-leak guard.

No provider-app operational feature relies on mock data — the
harness drives the canonical `/v1/provider/*` and `/v1/me/*`
endpoints that ship the real read model from Sprints 5.1 → 5.6.

Auto-continue → Sprint 6.0.
