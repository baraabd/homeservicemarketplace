# Sprint 01 Remediation — Authorization, Session Security, Account Lifecycles, Realtime, Production Build, and Browser Verification

- **Baseline commit:** `8c931f709a7c65d0c9fc93b174b4a8d385869cae` (`origin/develop`)
- **Final commit:** `f9f8fdbeb2a07133f94f481cc938e9a7a8c14cc0`
- **Branch:** `fix/sprint-01-remediation-authz-session-realtime`
- **Node / pnpm:** v20.18.1 / 10.32.1
- **Working tree at start:** clean, identical to `origin/develop`

---

## 1. Verdict

> **FAIL — NOT SAFE TO MERGE**

Every defect named in the brief (D-1, D-2, D-4, D-7, D-8), the three account
axes, the Admin and Provider lifecycles, the browser suite, and the CI gates are
implemented and verified with reproducible evidence. **Three blockers prevent a
PASS**, listed in §12. Two are process/scope items rather than code defects, but
the verdict rules do not admit partial credit, and none of them should be waved
through.

---

## 2. Root causes

### D-1 — registration rate limiting

`POST /v1/auth/register` carried `@Throttle({ limit: 500, ttl: 3_600_000 })`.
Two independent problems:

1. 500 registrations per hour is not a rate limit.
2. `ThrottlerModule.forRoot` used the default **in-memory** storage, so each API
   replica kept its own counter. The real budget was `500 × replicas`, and an
   attacker only had to let the load balancer spread their requests.

Express `trust proxy` was never configured, so `req.ip` behaviour behind a proxy
was undefined, and the throttle identity was the IP alone — cycling email
addresses from one source, or one address from many sources, was unbounded on
the other axis.

### D-2 — access-token revocation

`JwtStrategy.validate()` called `assertInGoodStanding(payload.sub)`, which asked
only "is this USER allowed to hold a session?", answered from a per-user Redis
cache. It never looked at the `Session` row the token was minted for:

| Action               | Refresh token | Access token (before)            |
| -------------------- | ------------- | -------------------------------- |
| logout (one session) | revoked       | **worked until `exp`**           |
| logout-all           | revoked       | **worked until `exp`**           |
| password reset       | revoked       | **worked until `exp`**           |
| refresh rotation     | rotated       | **old token worked until `exp`** |
| admin suspend / lock | revoked       | blocked (standing changed)       |

The cache was also keyed by **user**, but the thing being revoked is a
**session** — it could not express "device A is logged out, device B is still
signed in" even in principle. ADR 0001 explicitly accepted the self-service rows
as residual; that acceptance was the defect.

### D-4 — realtime authorization

The Socket.IO handshake did a stateless `verifyAccessToken(token)` and nothing
more:

- a revoked session or suspended user could still open a **new** socket, because
  nothing consulted the `Session` row — REST and realtime disagreed about whether
  a credential was alive;
- `admin` room membership came from the JWT `roles` claim, so a revoked admin
  stayed in the admin broadcast room until their token expired;
- `provider:{id}` was joined whenever a `ProviderProfile` row **existed**,
  regardless of status, so DRAFT / PENDING_REVIEW / SUSPENDED / REJECTED
  providers received marketplace fan-out that `ProviderActiveGuard` refused them
  on REST;
- nothing disconnected an already-connected socket after any mutation. There is
  no per-message re-auth, so a socket authenticated once and received events
  forever.

`RealtimeSocketAdapter` reported "running single-instance" as a warning, so a
deployment could silently lose cross-instance eviction entirely.

### D-7 — `express` not a direct dependency

`apps/api/src/main.ts` imports `express` directly (`express.raw`,
`express.json`) but `express` was only a transitive dependency of
`@nestjs/platform-express`. Under pnpm's strict layout it is not exposed to the
app. **Reproduced live** during this work: the API refused to boot with
`Error: Cannot find module 'express'` (`scratchpad/evidence-d7-before.log`).

### D-8 — cold Docker build

`pnpm install --frozen-lockfile` ran in a `deps` stage that had copied only the
package.json manifests. pnpm executes workspace lifecycle hooks during install,
and `packages/contracts` declares `"prepare": "pnpm run build"` →
`tsc -p tsconfig.build.json`, whose tsconfig is not copied until the next stage.
**Reproduced:**

```
packages/contracts prepare: error TS5058: The specified path does not exist: 'tsconfig.build.json'
ERROR: process "/bin/sh -c pnpm install --frozen-lockfile" did not complete successfully: exit code: 1
```

Three further image defects surfaced while fixing it: `pnpm deploy` did not
carry the Prisma client across, `apps/api` had no `files` field so sources and
tsconfigs shipped into the runtime image, and the base image's bundled npm
contributed 1 CRITICAL + 24 HIGH scan findings for code that never executes.

### Account axes

Three independent axes were collapsed:

- `POST /v1/me/provider/upgrade` stamped `PENDING_REVIEW`, so an **empty**
  profile entered the admin review queue the moment someone clicked "become a
  provider". `PENDING_REVIEW` stopped meaning "a complete application was
  submitted", and `approve` accepted `DRAFT` as a source state, making any
  completeness gate optional.
- There was no admin access-request concept at all.
- `grantAdminProviderAccess` welded three decisions together (admin role,
  provider role, provider approval) and force-activated the profile; the seed
  used it for admin-only dev users, so they received a provider role and an
  ACTIVE profile they never used.
- The Admin dashboard had no admin-access column, so the third axis was
  invisible.
- The Provider shell gate was `if (profile && profile.status !== 'ACTIVE')`;
  `profile` is null while the query is in flight, so the **live marketplace
  mounted first** and was then replaced.

### Phase 12

`<html lang>` and `<html dir>` were never set — `dir` was applied only to inner
`<div>` wrappers. Assistive technology announced Arabic content in an English
voice, and the UA's own bidi handling never engaged for native controls,
scrollbar side, or text selection. The language choice also reset on every
reload. There was no browser test infrastructure at all.

### Defects found _while_ remediating (not in the brief)

- **A fatal bootstrap error produced no output whatsoever.** `NestFactory` is
  created with `bufferLogs: true`; anything logged before `useLogger()` sits in a
  buffer that `process.exit` discards. The container died with an exit code and
  silence.
- **`RealtimeSocketAdapter` checked `RedisService.isReady()`**, but it runs
  before `app.listen()` triggers `onModuleInit`, so Redis had never connected at
  that point and the check was _always_ false. The old code only warned, so
  every boot silently ran without the Redis adapter.
- **Authored `AppError` details were stripped in production** by the exception
  filter, which would have shipped the provider onboarding 422 with an **empty**
  missing-field list — exactly the machine-readable payload the client needs.
- **Pre-existing Prisma drift:** `20260502010000_add_disputes_and_settings` used
  `ON DELETE NO ACTION` for both `Dispute` FKs while `schema.prisma` implies
  `RESTRICT` / `SET NULL`. Every `migrate diff` had reported it.
- **Badge colour collision:** `SUSPENDED` (account axis) and `REJECTED`
  (admin-access axis) rendered the _same_ rose badge, and they frequently share
  a row.

---

## 3. Files changed and why

113 files, +10,241 / −1,288. The load-bearing ones:

| Area     | File                                                                      | Why                                                                                            |
| -------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| D-1      | `apps/api/src/infrastructure/throttle/rate-limit.store.ts`                | Redis-backed, Lua-atomic counter store; fails **closed**.                                      |
| D-1      | `.../registration-throttle.service.ts`                                    | 5/hour charged on **both** normalised email and proxy-aware IP.                                |
| D-1      | `.../app-throttler.guard.ts`                                              | Stable `RATE_LIMITED` envelope instead of the `ThrottlerException` string.                     |
| D-1      | `apps/api/src/config/env.{schema,validation}.ts`                          | Production/staging **refuse to boot** with a wider limit, shorter window, or non-shared store. |
| D-1      | `apps/api/src/main.ts`                                                    | `trust proxy` from an explicit `TRUST_PROXY_HOPS` count.                                       |
| D-2      | `.../services/session-validation.service.ts`                              | `assertSessionActive` — the single authority, no positive cache, fails closed.                 |
| D-2      | `.../persistence/iam/session.repository.ts`                               | One indexed PK lookup that pulls user standing through the relation.                           |
| D-2      | `.../strategies/jwt.strategy.ts`                                          | Uses `assertSessionActive`.                                                                    |
| D-2      | `.../services/authentication.service.ts`                                  | logout/logout-all/reset commit revoke + audit together and publish post-commit.                |
| D-2      | `docs/adr/0001-immediate-access-token-blocking.md`                        | Rewritten; residual-TTL acceptance withdrawn.                                                  |
| D-4      | `apps/api/src/modules/realtime/realtime.gateway.ts`                       | Same session check as REST; DB-resolved roles/status; room policy; eviction subscriptions.     |
| D-4      | `.../realtime-identity.resolver.ts`                                       | Current roles + provider status from the database.                                             |
| D-4      | `.../realtime-socket.adapter.ts`                                          | Owns its pub/sub pair; hardened boot fails without cross-instance eviction.                    |
| D-4      | `apps/api/src/shared/security-events/`                                    | Transport-agnostic post-commit bus (breaks the IAM↔realtime module cycle).                     |
| Phase 4  | `packages/database/prisma/schema.prisma` + migration                      | `AdminAccessRequest`, provider onboarding columns, audit types, FK drift fix.                  |
| Phase 4  | `apps/api/src/modules/iam/admin-access/**`                                | Request lifecycle: no self-review, one pending, minimum-role grant, session revoke.            |
| Phase 4  | `apps/api/src/modules/provider/onboarding/**`                             | Completeness policy, submit-for-review, withdraw, edit lock.                                   |
| Phase 4  | `packages/database/src/admin-access-grant.ts`                             | Split into `grantAdminAccess` / `grantProviderAccess`.                                         |
| D-7      | `apps/api/package.json`                                                   | `express` as a direct dependency; `files: ["dist"]`.                                           |
| D-8      | `apps/api/Dockerfile`                                                     | Ordering fix, in-package Prisma client, build-time assertions, npm removed.                    |
| Phase 12 | `apps/web/e2e/**`, `playwright.config.ts`                                 | 186 real-browser tests.                                                                        |
| Phase 12 | `apps/web/src/app/i18n/LanguageContext.tsx`                               | `<html lang/dir>` + persistence.                                                               |
| Phase 8  | `.github/workflows/ci.yml`                                                | The permanent gates.                                                                           |
| Proofs   | `scripts/runtime/verify-sprint01-security.cjs` + `sprint01-scenarios.cjs` | 117-scenario live harness.                                                                     |

---

## 4. Database migrations and rollback

**`20260821120000_add_admin_access_requests_and_provider_onboarding`**

Additive only — every new column is nullable, every enum change appends:

- `CREATE TYPE "AdminAccessRequestStatus"` (PENDING/APPROVED/REJECTED/CANCELLED)
- `ALTER TYPE "AuditEventType" ADD VALUE` ×6 (values are only appended and none
  is referenced elsewhere in the migration, so it is safe inside PostgreSQL 12+
  transactional DDL)
- `ProviderProfile`: `submittedForReviewAt`, `reviewedAt`, `reviewedByUserId`,
  `rejectionReason` — all nullable
- `CREATE TABLE "AdminAccessRequest"` with two indexes:
  `(userId, status)` for the one-pending rule and the per-user history;
  `(status, createdAt)` for the review queue drained oldest-first
- `Dispute` FK correction (pre-existing drift): `NO ACTION` → `RESTRICT` /
  `SET NULL`

**Rollback.** Drop the table, the type, and the four columns. The appended
`AuditEventType` values cannot be removed without rewriting the enum; leaving
them is harmless. The `Dispute` FKs revert with the inverse `ALTER TABLE`.

**Behavioural delta of the FK fix:** hard-deleting a `User` who resolved a
dispute previously failed and now nulls `Dispute.resolvedById`. The application
soft-deletes users and never issues a hard `DELETE`, so no application path
changes.

Verified zero remaining drift:

```
$ pnpm exec prisma migrate diff --from-migrations prisma/migrations \
    --to-schema-datamodel prisma/schema.prisma --shadow-database-url <shadow>
-- This is an empty migration.
```

---

## 5. Authorization matrix

Verified live (§8). `403` = wrong role/status; `401` = no or dead credential.

| Endpoint                                     | Unauthenticated | Customer     | Provider DRAFT | Provider PENDING | Provider ACTIVE | Provider SUSPENDED | Admin          |
| -------------------------------------------- | --------------- | ------------ | -------------- | ---------------- | --------------- | ------------------ | -------------- |
| `GET /v1/auth/me`                            | 401             | 200          | 200            | 200              | 200             | 200                | 200            |
| `GET /v1/me/profile`                         | 401             | 200          | 200            | 200              | 200             | 200                | 200            |
| `POST /v1/me/addresses`                      | 401             | 201          | 201            | 201              | 201             | 201                | 201            |
| `POST /v1/me/provider/upgrade`               | 401             | 200 (→DRAFT) | 200 (idem.)    | 200 (idem.)      | 200 (idem.)     | 200 (idem.)        | 200            |
| `GET /v1/me/provider/profile`                | 401             | **403**      | 200            | 200              | 200             | 200                | 403¹           |
| `GET /v1/me/provider/onboarding`             | 401             | **403**      | 200            | 200              | 200             | 200                | 403¹           |
| `POST /v1/me/provider/submit-for-review`     | 401             | **403**      | 200 / **422**  | **409**          | **409**         | **409**            | 403¹           |
| `POST /v1/me/provider/withdraw-review`       | 401             | **403**      | **409**        | 200              | **409**         | **409**            | 403¹           |
| `PATCH /v1/me/provider/profile`              | 401             | **403**      | 200            | **409** (locked) | 200             | 200                | 403¹           |
| `GET /v1/provider/available-requests`        | 401             | **403**      | **403**        | **403**          | 200             | **403**            | 403¹           |
| `GET /v1/provider/bids`                      | 401             | **403**      | **403**        | **403**          | 200             | **403**            | 403¹           |
| `GET /v1/provider/bookings`                  | 401             | **403**      | **403**        | **403**          | 200             | **403**            | 403¹           |
| `GET /v1/me/admin-access`                    | 401             | 200          | 200            | 200              | 200             | 200                | 200            |
| `POST /v1/me/admin-access`                   | 401             | 202          | 202            | 202              | 202             | 202                | **409**²       |
| `GET /v1/admin/users`                        | 401             | **403**      | **403**        | **403**          | **403**         | **403**            | 200            |
| `GET /v1/admin/providers`                    | 401             | **403**      | **403**        | **403**          | **403**         | **403**            | 200            |
| `GET /v1/admin/access-requests`              | 401             | **403**      | **403**        | **403**          | **403**         | **403**            | 200³           |
| `POST /v1/admin/access-requests/:id/approve` | 401             | **403**      | **403**        | **403**          | **403**         | **403**            | 200 / **403**⁴ |

¹ unless the admin also holds the provider role — the axes are independent.
² already holds the role.
³ requires the `admin:access:grant` permission in addition to the role.
⁴ **403 when the reviewer is the applicant** — self-review is refused even with
the permission.

### WebSocket rooms

| Connecting identity                                      | Handshake                               | Rooms joined                     |
| -------------------------------------------------------- | --------------------------------------- | -------------------------------- |
| Live session, customer                                   | accepted                                | `user:{id}`, `session:{sid}`     |
| Live session, ACTIVE provider                            | accepted                                | + `provider:{profileId}`         |
| Live session, current admin role                         | accepted                                | + `admin`                        |
| Token whose `roles` claim says admin, role since revoked | accepted                                | **no `admin` room** (DB decides) |
| DRAFT / PENDING_REVIEW / SUSPENDED / REJECTED provider   | accepted                                | **no provider room**             |
| Revoked session (logout / logout-all / reset / rotation) | **rejected** `AUTH_INVALID_CREDENTIALS` | —                                |
| Globally suspended / locked / deleted user               | **rejected** (same opaque code)         | —                                |
| Missing `sid` or `jti`                                   | **rejected**, before any lookup         | —                                |
| Identity lookup fails                                    | **rejected** (fails closed)             | —                                |

| Post-connection event                            | Effect                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| logout                                           | disconnect `session:{sid}` only — other devices survive                 |
| logout-all / password reset / account suspension | disconnect `user:{id}` (all instances)                                  |
| admin role change                                | disconnect `user:{id}` → forced re-handshake                            |
| provider status leaves ACTIVE                    | **evict `provider:{id}`, do NOT disconnect** — Customer access survives |

---

## 6. Account-state matrix

The four axes are now separate fields and separate columns.

| Axis | Field                           | Question it answers                 | Values                                                   |
| ---- | ------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| 1    | `User.status` / `User.isActive` | May this identity authenticate?     | PENDING_VERIFICATION, ACTIVE, LOCKED, SUSPENDED, DELETED |
| 2    | `UserRole`                      | What may it do?                     | customer, provider, admin                                |
| 3    | `AdminAccessRequest.status`     | Where does its admin request stand? | _(none)_, PENDING, APPROVED, REJECTED, CANCELLED         |
| 4    | `ProviderProfile.status`        | Marketplace readiness               | DRAFT, PENDING_REVIEW, ACTIVE, SUSPENDED, REJECTED       |

Worked combinations the dashboard must render distinctly:

| Account   | Roles              | Admin request | Provider profile | Correct reading                                    |
| --------- | ------------------ | ------------- | ---------------- | -------------------------------------------------- |
| ACTIVE    | customer           | —             | —                | Active **customer**. _Not_ "Admin active".         |
| ACTIVE    | customer           | PENDING       | —                | Asked for admin; **granted nothing**.              |
| ACTIVE    | customer, admin    | APPROVED      | —                | Admin. No marketplace presence.                    |
| ACTIVE    | customer, provider | —             | DRAFT            | Onboarding, not yet submitted.                     |
| ACTIVE    | customer, provider | —             | PENDING_REVIEW   | Complete application queued.                       |
| ACTIVE    | customer, provider | —             | SUSPENDED        | **Customer access intact**, marketplace withdrawn. |
| SUSPENDED | customer, provider | REJECTED      | ACTIVE           | Cannot authenticate at all — axis 1 dominates.     |
| ACTIVE    | customer           | REJECTED      | —                | Refused admin; ordinary account works normally.    |

**Frontend app intent/theme is UX only.** It selects branding
("FixNow Admin" on the login screen) and never authorization; `/admin` redirects
an unauthenticated visitor to login regardless of theme.

---

## 7. Test counts

| Suite                    | Baseline              | Final                 | Δ        |
| ------------------------ | --------------------- | --------------------- | -------- |
| API (jest) — suites      | 90 (85 pass / 5 skip) | 97 (91 pass / 6 skip) | +7       |
| API (jest) — tests       | 1047 (1032 / 15 skip) | 1243 (1224 / 19 skip) | **+196** |
| Web (vitest) — files     | 59                    | 59                    | 0        |
| Web (vitest) — tests     | 580                   | 580                   | 0        |
| Browser (Playwright)     | **0 (none existed)**  | **186**               | +186     |
| Runtime security harness | **0 (none existed)**  | **117**               | +117     |
| **Total**                | 1627                  | **2126**              | **+499** |

The 4 added skips are the new Redis-gated integration specs, which run for real
in the CI `integration-e2e` job (`RUN_REDIS_INTEGRATION=1`) — verified locally at
4/4 passing. **No test was deleted, weakened, `.only`'d, or made less strict.**
Two existing suites were rewritten to test the _replacement_ behaviour with
strictly more assertions:

- `session-validation.service.spec.ts` — 8 → 23 tests. Every account-standing
  case is retained; session-level cases were previously untestable because they
  were not checked.
- `admin-access-grant.spec.ts` — 7 → 23 tests, dominated by the new negative
  assertions (granting admin must not touch the provider axis, and vice versa).

---

## 8. Verification commands and exit codes

Full sweep from a clean install, against live Postgres 16 / Redis 7 / Mongo 7 /
Mailpit:

| Command                                                                | Exit  | Duration | Result                                  |
| ---------------------------------------------------------------------- | ----- | -------- | --------------------------------------- |
| `pnpm install --frozen-lockfile`                                       | 0     | 30s      | —                                       |
| `pnpm format:check`                                                    | **1** | 21s      | **732 files — pre-existing, see §12**   |
| `pnpm --filter …/api lint`                                             | 0     | 77s      | clean                                   |
| `pnpm --filter …/web lint`                                             | 0     | 28s      | 0 errors, 31 pre-existing warnings      |
| `pnpm --filter …/database prisma:validate`                             | 0     | 6s       | schema valid                            |
| `pnpm --filter …/database generate`                                    | 0     | 5s       | (see §12 note on Windows file locks)    |
| `pnpm --filter …/contracts build`                                      | 0     | 4s       | —                                       |
| `pnpm --filter …/database build`                                       | 0     | 7s       | —                                       |
| `pnpm --filter …/database typecheck`                                   | 0     | 5s       | —                                       |
| `pnpm --filter …/api typecheck`                                        | 0     | 24s      | —                                       |
| `pnpm --filter …/web typecheck`                                        | 0     | 7s       | —                                       |
| `pnpm --filter …/api test`                                             | 0     | 60s      | **1224 passed, 19 skipped, 1243 total** |
| `pnpm --filter …/web test`                                             | 0     | 96s      | **580 passed, 59 files**                |
| `pnpm --filter …/api build`                                            | 0     | 23s      | —                                       |
| `pnpm audit --prod --audit-level high`                                 | 0     | 98s      | **0 critical, 0 high**                  |
| `RUN_REDIS_INTEGRATION=1 jest test/integration/registration-throttle…` | 0     | 3s       | **4/4**                                 |
| `pnpm --filter …/web test:e2e` (Playwright)                            | 0     | ~120s    | **186 passed**                          |
| `node scripts/runtime/verify-sprint01-security.cjs`                    | 0     | ~90s     | **117/117**                             |
| `docker build --no-cache -f apps/api/Dockerfile`                       | 0     | ~180s    | cold build clean                        |
| Trivy `--severity CRITICAL,HIGH --ignore-unfixed --exit-code 1`        | 0     | ~60s     | **0 findings**                          |

Migration/schema drift check: `-- This is an empty migration.`

**Not executed:** the Postman/newman harnesses (§12).

---

## 9. Sanitized security evidence

From the 117-scenario runtime harness against **two live production-mode API
instances** (`:4010`, `:4011`) sharing one Postgres and one Redis. Every token,
cookie, password, OTP, and reset link is redacted by key _and_ by shape before
anything is written; error **codes** are deliberately preserved because they are
the evidence. A leak scan over the whole report is clean for passwords, JWTs,
cookies, and six-digit codes.

```
D-1 — production-safe registration rate limiting ......... 7/7
  PASS  first five validly-shaped attempts accepted, the sixth is 429
        statuses = [202, 202, 202, 202, 202, 429]
  PASS  the 429 carries the stable RATE_LIMITED envelope
  PASS  the 429 carries a positive Retry-After          (Retry-After: 3600)
  PASS  the 429 body leaks no framework artefact        (no "ThrottlerException")
  PASS  budget is AGGREGATE across instances: 5 accepted, 6th refused while alternating A/B
        [{A,202},{B,202},{A,202},{B,202},{A,202},{B,429}]
  PASS  known and unknown emails are indistinguishable under throttling
  PASS  a forged X-Forwarded-For does NOT escape the rate-limit bucket

D-2 — immediate access-token revocation .................. 18/18
  PASS  protected endpoint returns 200 before logout
  PASS  the SAME access token returns 401 immediately after logout
  PASS  a second independent session is UNAFFECTED by single-session logout
  PASS  session 2 / session 3 return 401 after logout-all
  PASS  a logout served by instance A is enforced by instance B on the next request
  PASS  pre-reset session 1 / 2 access tokens return 401 immediately after password reset
  PASS  pre-reset session 1 / 2 refresh tokens are rejected after password reset
  PASS  the access token replaced by refresh rotation is rejected
  PASS  the rotated session still works
  PASS  every token of a suspended account returns 401

D-4 — realtime authorization and immediate disconnection . 13/13
  PASS  a plain customer joins ONLY its user and session rooms
  PASS  a REVOKED session is rejected at the WebSocket handshake
  PASS  an already-connected socket is disconnected after logout
  PASS  a logout served by instance A disconnects the socket held by instance B
  PASS  an already-connected socket is disconnected after global suspension
  PASS  a globally suspended account is rejected at the WebSocket handshake
  PASS  a current admin joins the admin room
  PASS  a PENDING_REVIEW provider connects but does NOT join the provider room
  PASS  an ACTIVE provider joins the provider marketplace room
  PASS  provider suspension evicts the marketplace room WITHOUT disconnecting the session

Admin — access-request lifecycle ......................... 27/27
  PASS  a fresh signup has NO admin role, whatever the account status
  PASS  the account is ACTIVE yet still not an admin (the two axes are separate)
  PASS  a non-admin receives 403 from /admin/users, /admin/access-requests, /admin/providers
  PASS  submitting with an injected role/roles/status/userId/hasAdminRole field is rejected (400)
  PASS  a PENDING request still grants NO admin role
  PASS  a pending applicant is STILL refused by admin endpoints
  PASS  the review item carries account status, roles, and request status separately
  PASS  approval succeeds; the applicant's existing session is revoked by the grant
  PASS  after re-authentication the applicant HAS the admin role
  PASS  approval did NOT create an ACTIVE ProviderProfile
  PASS  a REJECTED applicant keeps an ordinary working session and no admin role
  PASS  the rejection reason is surfaced to the applicant, not a generic account error

Provider — DRAFT → submit → PENDING_REVIEW → ACTIVE ...... 31/31
  PASS  upgrade creates a DRAFT profile (NOT auto-active, NOT auto-submitted)
  PASS  an incomplete application is refused with 422
  PASS  the 422 carries machine-readable missing-field codes
  PASS  a DRAFT provider receives 403 from available-requests / bids / bookings
  PASS  a complete submission moves the profile to PENDING_REVIEW + stamps submittedForReviewAt
  PASS  editing a queued application is refused (409)
  PASS  a PENDING_REVIEW provider can still sign in and read their own status
  PASS  withdrawing a queued application returns it to DRAFT and it is editable again
  PASS  admin approval → ACTIVE; an ACTIVE provider reaches the marketplace feed
  PASS  a SUSPENDED provider is refused by marketplace endpoints
  PASS  provider suspension does NOT suspend the user identity (Customer access survives)
  PASS  a REJECTED provider is told WHY, not shown a generic account error

Customer — capabilities and boundaries ................... 16/16
  PASS  /auth/me works and leaks no credential material
  PASS  can read own profile, create an address
  PASS  403 from admin users / providers / access-requests
  PASS  403 from provider feed / bids / profile before any upgrade
  PASS  registration rejects injected role/roles/status/isAdmin/userId/permissions (400)

IDOR — cross-user resource access ........................ 5/5
  PASS  another user cannot READ / MUTATE the address by id
  PASS  the address does not appear in another user's list
  PASS  a non-admin cannot read another user's admin record

========================================================================
Scenarios: 117/117 passed
```

---

## 10. Docker build, boot, health, and shutdown

```
$ docker build --no-cache -f apps/api/Dockerfile -t hsm-api:remediation .
  express resolves at /out/node_modules/.pnpm/express@5.2.1/node_modules/express/index.js
  prisma client + engine load from the deployed bundle
  deployed bundle carries no sources and no TypeScript toolchain
EXIT=0
```

```
health/live : 200
health/ready: 200
runs as     : uid=100(app) gid=101(app) groups=101(app)      ← non-root
npm present : REMOVED
module errs : 0                                              ← no "Cannot find module"
HEALTHCHECK : healthy
SIGTERM     : exit=0 in 0s
  "Received SIGTERM, shutting down gracefully"
  "Mongo connection lost"
  "Redis connection closed"
```

Boot log milestones: `Postgres connection established` → `Redis ready` →
`Nest application successfully started` → `API listening on :4000 (env=production)`.

Image contents: `dist`, `node_modules`, `package.json` — no `src`, no `test`,
no `typescript`. Size 529 MB.

---

## 11. Dependency and container scan results

**Production dependency audit** — `pnpm audit --prod --audit-level high`

|          | Before | After |
| -------- | ------ | ----- |
| critical | 0      | **0** |
| high     | **25** | **0** |
| moderate | 33     | 4     |
| low      | 3      | 1     |

Cleared via pnpm `overrides` for transitive packages (`path-to-regexp`,
`lodash`, `fast-xml-builder`, `form-data`, `multer`, `ws`, `socket.io-parser`)
and direct bumps for `axios` → ^1.16.0, `react-router` → ^7.18.2,
`nodemailer` → ^9.0.1. All suites re-verified afterwards.

**Container scan** — Trivy `--severity CRITICAL,HIGH --ignore-unfixed`

|                    | Before               | After |
| ------------------ | -------------------- | ----- |
| OS (alpine 3.23.4) | 0                    | **0** |
| node packages      | 1 CRITICAL + 24 HIGH | **0** |
| Trivy exit code    | 1                    | **0** |

The CRITICAL (`node-tar` gzip bomb) and most HIGHs came from the **base image's
bundled npm**, not the application. Removed, with `! command -v npm` asserted at
build time so a future base image cannot quietly reintroduce it.

**Secret scan.** Configured in CI (gitleaks, full history). Not executed
locally — see §12.

---

## 12. Blockers, remaining risks, and assumptions

### Blockers (each independently forces FAIL)

**B-1 — Findings D-3, D-5, and D-6 are unaccounted for.**
The brief requires every finding ID from the original audit to be resolved. The
"Sprint 1 Manual-Like Security Verification" document **does not exist in this
repository or its git history** — searched across all `.md` files, all branches,
and the full commit log. D-1, D-2, D-4, D-7, and D-8 were recoverable only
because the brief names them. D-3, D-5, and D-6 cannot be closed, contradicted,
or scoped without their text. _Next action:_ supply the audit document; each
missing ID is then either verified or explicitly re-opened.

**B-2 — The Postman / runtime harnesses were not executed.**
`postman:provider`, `postman:admin`, `postman:*-runtime`, `runtime:provider-loop`
and `runtime:verify-500` are listed as required. They were not run: `newman` is
not installed and the collections predate this sprint's contract changes
(`/v1/me/provider/upgrade` now returns DRAFT, `AdminUserSummary` gained a field,
`/admin/providers/:id/approve` no longer accepts DRAFT), so they would need
updating before their result would mean anything. Running them unmodified would
produce failures that say nothing about the remediation. _Next action:_
`pnpm add -Dw newman newman-reporter-htmlextra`, update the collections for the
new lifecycle, then run each.

**B-3 — `pnpm format:check` exits 1 (732 files).**
This is **pre-existing and environment-induced**: the repository is checked out
on Windows with `core.autocrlf=true`, so every file is CRLF on disk while
Prettier's `endOfLine: "lf"` expects LF. Untouched files such as `turbo.json` and
`tsconfig.base.json` fail identically, and the count was 777 before this work
began. It would pass on a Linux runner, but that is an inference, not a
measurement — and the brief requires the formatting check to pass. _Next action:_
add `.gitattributes` with `* text=auto eol=lf`, renormalise once
(`git add --renormalize .`), and re-run. Deliberately **not** done here: it
rewrites ~750 files and would bury this sprint's diff.

### Remaining risks

1. **The Admin console is not responsive.** It is a declared desktop surface
   ("Desktop 1440px" in the app selector) built around a fixed 256 px sidebar; at
   375 px and 768 px the page scrolls horizontally by ~210–270 px. The browser
   tests assert strict no-page-overflow at desktop and, at smaller viewports,
   that the overflow is bounded, direction-independent, and scrollable-to.
   Making it responsive is a redesign this sprint was told not to make.
2. **Per-request database read.** `assertSessionActive` deliberately has no
   positive cache (see the rewritten ADR 0001), so every authenticated request
   costs one indexed primary-key lookup. Correct, but unprofiled under load.
3. **`RolesGuard` still reads the token's `roles` claim.** Safe only because
   every role mutation now revokes the user's sessions. If a future code path
   changes roles without revoking, authorization goes stale. The realtime side
   does not share this exposure — it resolves roles from the database.
4. **The three-persona workflow is proven at the API layer, not through the
   browser.** The 117-scenario harness drives real HTTP and WebSocket traffic
   against live instances; the browser suite covers the same states with stubbed
   API responses. A browser-level persona test against the live API remains
   unwritten.
5. **`REJECTED` is terminal for a provider application.** There is no admin
   "reopen to DRAFT" route, so a rejected provider must contact support. Product
   decision, not a defect — but it is a dead end in the UI today.
6. **Three provider component tests are order-dependent.** They pass in the full
   suite and in isolation, but fail when only
   `src/app/components/provider/` is run. Pre-existing (reproduced on the
   pristine baseline); the language-persistence work made it visible and the
   global `localStorage` reset in `test-setup.ts` fixed the symptom, not the
   underlying ordering sensitivity.
7. **CI has never executed.** Every gate in `.github/workflows/ci.yml` is
   written and structurally validated (YAML parses; jobs, services, and
   dependencies check out), but nothing has been pushed, so no run exists. The
   remediation is not "permanent" until a real run is green.

### Assumptions

- `AUTH_REQUIRE_EMAIL_VERIFICATION=true` throughout the runtime proofs; OTP codes
  and reset links were read back from the Mailpit sink rather than the flow being
  weakened.
- The harness clears Redis rate-limit counters **between** scenario groups
  because every client shares one loopback IP bucket. This is time-travel, not a
  bypass: the limit is never raised, the API is never reconfigured, and D-1's own
  six-attempt sequence runs with no reset in the middle.
- Production-mode instances ran with `TRUST_PROXY_HOPS=0` (direct exposure), which
  is what makes the forged-`X-Forwarded-For` proof meaningful.
- The container reaches host services via `host.docker.internal`; CI uses
  `--network host` instead.

---

## 13. Checklist

| Item                                                            | Status | Evidence                                        |
| --------------------------------------------------------------- | ------ | ----------------------------------------------- |
| **D-1** exactly 5/hour production default                       | ✅     | statuses `[202×5, 429]`                         |
| D-1 no permissive dev limit in production code                  | ✅     | env validation refuses >5 in production/staging |
| D-1 typed env, default 5, override dev/test only                | ✅     | `env.schema.ts` / `env.validation.ts`           |
| D-1 shared Redis store across replicas                          | ✅     | alternating A/B: 5 accepted, 6th refused        |
| D-1 identity resists casing/whitespace, email cycling, replicas | ✅     | unit + integration + runtime                    |
| D-1 trusted proxies configured safely                           | ✅     | `TRUST_PROXY_HOPS`; forged XFF → 429            |
| D-1 stable 429 envelope + valid Retry-After                     | ✅     | `RATE_LIMITED`, `Retry-After: 3600`             |
| D-1 anti-enumeration preserved                                  | ✅     | known vs unknown identical                      |
| D-1 unit + integration + two-instance tests                     | ✅     | 27 unit, 4 integration, 7 runtime               |
| **D-2** `assertSessionActive` with all seven checks             | ✅     | `session-validation.service.ts`                 |
| D-2 `JwtStrategy.validate()` uses it                            | ✅     | `jwt.strategy.ts`                               |
| D-2 fails closed on infrastructure failure                      | ✅     | 2 unit tests                                    |
| D-2 no stale positive cache                                     | ✅     | no cache at all; ADR documents why              |
| D-2 indexed lookup, no N+1                                      | ✅     | one `findUnique` + relation select              |
| D-2 immediate invalidation on all six triggers                  | ✅     | 18 runtime scenarios                            |
| D-2 transactional mutation + audit                              | ✅     | logout / logout-all / reset / suspend           |
| D-2 ADR updated                                                 | ✅     | `docs/adr/0001-…` rewritten                     |
| D-2 negative tests (9 cases)                                    | ✅     | 23 unit tests                                   |
| **D-4** handshake validates signature/iss/aud/exp/sub/sid/jti   | ✅     | gateway + passport options                      |
| D-4 handshake validates the Session row + user status           | ✅     | same `assertSessionActive`                      |
| D-4 roles resolved from DB, not the JWT claim                   | ✅     | revoked-admin test                              |
| D-4 socket data carries userId/sessionId/roles/provider status  | ✅     | `SocketData`                                    |
| D-4 server-owned rooms with correct policy                      | ✅     | room table §5                                   |
| D-4 non-ACTIVE provider never joins marketplace rooms           | ✅     | 4 statuses tested                               |
| D-4 security events revalidated / disconnect path               | ✅     | `subscribe:conversation` revalidates            |
| D-4 all five post-connection enforcement cases                  | ✅     | 13 runtime scenarios                            |
| D-4 Redis adapter for cross-instance ops                        | ✅     | A→B eviction proven                             |
| D-4 events published post-commit                                | ✅     | all publishers outside `tx.run`                 |
| D-4 `disconnectSockets(true)` across two instances              | ✅     | runtime scenario                                |
| D-4 production fails or explicitly accepts single-instance      | ✅     | 9 adapter tests                                 |
| **Axes** kept separate everywhere                               | ✅     | §6 + three-axis dashboard tests                 |
| Admin: public signup never grants admin                         | ✅     | 27 runtime scenarios                            |
| Admin: `AdminAccessRequest` lifecycle                           | ✅     | model + migration + service                     |
| Admin: no self-approval                                         | ✅     | 403, both approve and reject                    |
| Admin: transactional + audited transitions                      | ✅     | 4 audit types                                   |
| Admin: minimum role only, no ProviderProfile                    | ✅     | runtime + unit                                  |
| Admin: role changes invalidate sessions                         | ✅     | applicant session 401 after grant               |
| Admin: first admin stays out-of-band                            | ✅     | `grant:admin` CLI                               |
| Admin: combined grant routine split                             | ✅     | 23 unit tests                                   |
| Admin: dashboard shows three separate columns                   | ✅     | browser tests                                   |
| Admin: Customer/Provider get 403 everywhere                     | ✅     | runtime                                         |
| **Provider** upgrade idempotent + authenticated                 | ✅     | runtime                                         |
| Provider: upgrade → DRAFT, no auto-activate/submit              | ✅     | runtime + unit                                  |
| Provider: onboarding editable in DRAFT                          | ✅     | runtime                                         |
| Provider: dedicated submit-for-review                           | ✅     | `POST /submit-for-review`                       |
| Provider: completeness policy (9 requirements)                  | ✅     | 20 policy tests                                 |
| Provider: 422 with machine-readable codes                       | ✅     | runtime + unit                                  |
| Provider: atomic DRAFT→PENDING_REVIEW + audit                   | ✅     | status-scoped `updateMany`                      |
| Provider: edit-while-pending decided and tested                 | ✅     | **blocked** (409) + withdraw path               |
| Provider: admin detail shows the submitted snapshot             | ✅     | contract extended                               |
| Provider: no private storage paths exposed                      | ✅     | no document surface added                       |
| Provider: non-ACTIVE can sign in, see status, keep Customer     | ✅     | runtime                                         |
| Provider: ACTIVE gets full access                               | ✅     | runtime                                         |
| Provider: suspension ≠ user suspension                          | ✅     | runtime                                         |
| Provider: no live-shell flash                                   | ✅     | browser test with delayed profile               |
| **Customer** full lifecycle + boundaries                        | ✅     | 16 runtime scenarios                            |
| Customer: cannot inject role/status/userId/permissions          | ✅     | 6 injection tests                               |
| Customer: cannot read/mutate another user's resources           | ✅     | 5 IDOR scenarios                                |
| **D-7** express a direct dependency, lockfile updated           | ✅     | build-time resolution assert                    |
| D-7 resolves under pnpm's strict layout                         | ✅     | `require.resolve` in `/out`                     |
| **D-8** cold `--no-cache` build succeeds                        | ✅     | exit 0                                          |
| D-8 lifecycle scripts not run before sources exist              | ✅     | ordering fixed                                  |
| D-8 native/generated deps present                               | ✅     | argon2 + Prisma engine asserted                 |
| D-8 contracts/database built before api                         | ✅     | explicit order                                  |
| D-8 Prisma generation in the right stage                        | ✅     | builder                                         |
| D-8 `pnpm deploy --prod` self-contained                         | ✅     | `--legacy` + `files: ["dist"]`                  |
| D-8 non-root, no dev deps, no sources                           | ✅     | uid 100; no src/test/typescript                 |
| D-8 real production command                                     | ✅     | `node dist/main.js` via tini                    |
| D-8 six boot proofs                                             | ✅     | §10                                             |
| D-8 container scan, fail on critical/high                       | ✅     | Trivy exit 0                                    |
| **Phase 12** Playwright + config + scripts + CI                 | ✅     | 186 tests                                       |
| Phase 12 traces/screenshots/videos on failure                   | ✅     | `retain-on-failure`                             |
| Phase 12 real Chromium                                          | ✅     | three projects                                  |
| Phase 12 `lang`/`dir`, toggle, persistence, restore             | ✅     | 42 tests                                        |
| Phase 12 Admin dashboard in Arabic + all badges                 | ✅     | 69 tests                                        |
| Phase 12 all five provider status surfaces                      | ✅     | 75 tests                                        |
| Phase 12 three viewports                                        | ✅     | mobile/tablet/desktop                           |
| Phase 12 DOM geometry assertions                                | ✅     | overflow, containment, clipping, focus          |
| Phase 12 screenshots not the only assertion                     | ✅     | every visual test has DOM assertions            |
| Phase 12 persona workflow against the real API                  | ⚠️     | API layer only — risk 4                         |
| **Phase 8** CI on `develop` and `main`                          | ✅     | trigger updated                                 |
| Phase 8 all nine required jobs                                  | ✅     | + `ci-gate`                                     |
| Phase 8 artefacts on failure only                               | ✅     | `if: failure()`                                 |
| Phase 8 CI executes automatically                               | ❌     | **never run — blocker B-3 context, risk 7**     |
| Findings D-3 / D-5 / D-6 accounted for                          | ❌     | **B-1**                                         |
| Postman / runtime harnesses executed                            | ❌     | **B-2**                                         |
| `pnpm format:check` passes                                      | ❌     | **B-3**                                         |

---

## 14. Final verdict

> **FAIL — NOT SAFE TO MERGE**

| #   | Blocker                                  | Failed command / scenario                                                                                    | Recommended next action                                                                 |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| B-1 | Findings D-3, D-5, D-6 unaccounted for   | _(no artifact to run)_ — the Sprint 1 audit document is absent from the repo and its history                 | Supply the audit; verify or explicitly re-open each ID                                  |
| B-2 | Postman / runtime harnesses not executed | `pnpm postman:provider`, `postman:admin`, `postman:*-runtime`, `runtime:provider-loop`, `runtime:verify-500` | Install `newman`, update the collections for the new provider/admin lifecycle, run each |
| B-3 | Formatting check fails                   | `pnpm format:check` → exit 1, 732 files (pre-existing; CRLF checkout vs `endOfLine: lf`)                     | Add `.gitattributes` (`* text=auto eol=lf`), `git add --renormalize .`, re-run          |

Everything within the audited scope that **was** executable has been executed and
passes: 2126 automated tests across five suites, 117 live security scenarios
against two production-mode instances, a clean cold Docker build with a verified
production boot and graceful shutdown, and zero critical/high findings in both
the dependency and container scans. No unmitigated Critical or High severity
finding remains in the code. The blockers above are gaps in _verification
coverage and inputs_, not known-broken behaviour — but they are real, and the
rules for this sprint do not permit calling that a pass.
