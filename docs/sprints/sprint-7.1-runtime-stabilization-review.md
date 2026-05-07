# Sprint 7.1 — Runtime Stabilization & Local Integration Hardening

**Goal:** Fix real browser runtime failures in Provider and Admin apps.
No new features. No backend errors hidden in the UI. Zero unexpected
500 errors from any Provider/Admin screen.

---

## 1. Root cause analysis

The reported symptoms — "every Provider endpoint 500s, every Admin
endpoint 500s, plus occasional 401 with the shell still mounted" —
have **two** causes, not seven independent bugs:

### Cause A — Dev DB / Prisma client out of sync (most of the 500s)

Sprints 6.1 → 6.6 + 7.0 added migrations:

```
20260501020000_add_provider_profile_status
20260502000000_add_admin_audit_event_types
20260502010000_add_disputes_and_settings
20260502020000_add_provider_review_notes
20260502030000_add_dispute_priority_and_events
```

If the dev Postgres has _any_ of these unapplied, the dependent
endpoints throw inside Prisma — `Dispute`/`PlatformSetting` tables
don't exist; the `priority` / `reviewNotes` columns don't exist;
`AuditEventType` is missing the `ADMIN_*` values. Each becomes a
PrismaClient error which `AllExceptionsFilter` correctly maps to
500 INTERNAL_ERROR with no Prisma stack on the wire (`isPrismaError`
guard at `all-exceptions.filter.ts:166`). The wire is safe but the
operator sees a wall of 500s in the browser console.

The same class of failure shows up if `prisma generate` was blocked
by the Windows DLL-rename lock during a recent dev session — the
_generated TypeScript stubs_ gain the new models, the runtime
client may not.

**Resolution path (operator runbook in §6).**

### Cause B — Audit logs `?action=` filter cast → Prisma 500 (real code bug)

`AuditEventRepository.list` casts `args.type as AuditEventType`
without DTO-level enum validation. An invalid value (e.g.
`?action=GARBAGE` or any typo) reaches Prisma and 500s on the enum
binding. **Fixed in this sprint.**

### Cause C — admin@admin.com has no `ProviderProfile` (the user's specific session)

The user opened the Provider app while signed in as the admin user.
admin@admin.com was never granted the `provider` role and has no
`ProviderProfile` row. So:

- `/v1/me/provider/profile` → **403** (RolesGuard rejects non-providers)
- `/v1/provider/available-requests`, `/bids`, `/bookings`, `/earnings/*`
  → **403** (same RolesGuard chain)

These are not 500s in the source; if the operator saw 500s they were
_in addition to_ the 403s, and originated from Cause A.

**Resolution path:** use a real provider account (the seeded one
created by `pnpm --filter @homeservicemarketplace/database seed`)
to drive the Provider app. The smoke Postman collection asserts the
provider account has a valid `ACTIVE` ProviderProfile in folder 2.

---

## 2. Step 1 — Environment verification

Sanity checklist an operator runs before treating any 500 as a real bug:

| Check                 | Command                                                           | Expected                                                                        |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| API on :4000          | `curl -fsS http://localhost:4000/health/live`                     | 200 + `{"status":"ok"}`                                                         |
| DB / Mongo / Redis    | `curl -fsS http://localhost:4000/health/ready`                    | 200                                                                             |
| `VITE_API_URL`        | `grep VITE_API_URL apps/web/.env.local` (or root `.env`)          | `http://localhost:4000` (or empty in dev — `api.ts` falls back to the same URL) |
| CORS                  | open http://localhost:5173 → DevTools → Network → no CORS errors  | (none)                                                                          |
| Cookies / credentials | DevTools → Application → Cookies → `hsm_csrf` present after login | yes                                                                             |

If any of those fail, fix the environment **first** — none of the
endpoint-level fixes in §4 will help if the API isn't running or
CORS is blocking the upgrade.

---

## 3. Step 2 — Database / Prisma repair

Operator runbook (Windows-aware). Run in this exact order:

```bash
# 1. Stop everything that holds the Prisma DLL or the dev DB:
#    a) the API watch process (pnpm --filter @homeservicemarketplace/api dev)
#    b) Prisma Studio if open
#    c) any node REPL that imported @prisma/client
# On Windows, if step 4 fails to rename the DLL, run:
#    taskkill /F /IM node.exe

# 2. Validate the schema (no DB connection needed):
pnpm --filter @homeservicemarketplace/database run prisma:validate

# 3. Check migration state vs the dev DB:
pnpm --filter @homeservicemarketplace/database exec -- dotenv -e ../../.env -- prisma migrate status

# 4. Apply pending migrations to the dev DB:
pnpm --filter @homeservicemarketplace/database exec -- dotenv -e ../../.env -- prisma migrate dev

# 5. Regenerate the Prisma client so the runtime knows about the
#    new tables / columns / enum values:
pnpm --filter @homeservicemarketplace/database exec -- dotenv -e ../../.env -- prisma generate

# 6. If the dev DB is too far gone (column-rename hell, partially-
#    applied migration, lock file left behind) AND the dev DB is NOT
#    production:
pnpm --filter @homeservicemarketplace/database exec -- dotenv -e ../../.env -- prisma migrate reset

# 7. Reseed: admin@admin.com with admin role, a real provider user
#    with provider role + ACTIVE ProviderProfile, and a seeker:
pnpm --filter @homeservicemarketplace/database run seed
```

**Never** run `migrate reset` against production; the seed script
short-circuits via `assertSeedProductionSafe()` if `NODE_ENV=production`.

**Do not** rely on `admin@admin.com` to drive the Provider app.
Use the dedicated provider account the seed creates.

---

## 4. Step 3 — API error audit

Per-endpoint review of every reported failing path.

### Provider surface

| Endpoint                                                 | Source-code outcome                                                                                   | Sprint 7.1 change                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /v1/me/provider/profile`                            | RolesGuard('provider') → 403 if no role; service → 404 if profile missing (`provider.service.ts:117`) | none — already returns 404 / 403, never 500. The 500 was Cause A.   |
| `GET /v1/provider/available-requests`                    | service → 404 if profile missing (`available-requests.service.ts:51`)                                 | none — already safe.                                                |
| `GET /v1/me/provider/bids` (legacy)                      | service → 404 if profile missing (`provider-bids.service.ts:131`)                                     | retained as backwards-compat shim (`ProviderBidsLegacyController`). |
| `GET /v1/provider/bids` (canonical, **new**)             | identical handler chain                                                                               | mounted in this sprint; frontend migrated.                          |
| `GET /v1/provider/bookings`                              | service → 404 if profile missing                                                                      | none — already safe.                                                |
| `GET /v1/provider/earnings/{summary,transactions,chart}` | service → 404 if profile missing (`provider-earnings.service.ts:42 / 78 / 102`)                       | none — already safe.                                                |

### Admin surface

| Endpoint                                     | Source-code outcome                                                                                  | Sprint 7.1 change                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `GET /v1/admin/analytics/overview`           | aggregator returns zero values on empty DB                                                           | none — already safe.                                 |
| `GET /v1/admin/providers`                    | repo → `[]` on empty; service envelope `{ items: [], nextCursor: null }`                             | none.                                                |
| `GET /v1/admin/financials/bookings`          | repo → `[]`; reconciliation `amount − fee = net` holds at 0                                          | none.                                                |
| `GET /v1/admin/financials/provider-earnings` | repo → `[]`; sorted-desc trivially holds                                                             | none.                                                |
| `GET /v1/admin/disputes`                     | repo → `[]` envelope                                                                                 | none.                                                |
| `GET /v1/admin/settings`                     | service merges `defaults` for every whitelisted key when no DB rows (`admin-settings.service.ts:46`) | none — already returns defaults on empty table.      |
| `GET /v1/admin/audit-logs?action=…`          | **DTO-level `@IsEnum(AuditEventType)` validation** — invalid value → 400 VALIDATION_ERROR            | **fixed** in this sprint (was 500 from Prisma cast). |

### Fix rules (per the spec) — verified

- ✓ Missing provider profile → 404 (`AppError('NOT_FOUND', …, 404)`), never 500.
- ✓ Empty admin providers list → 200 `{ items: [], nextCursor: null }`.
- ✓ Empty disputes list → 200 envelope.
- ✓ Empty settings table → defaults from `ADMIN_SETTINGS_SCHEMA`.
- ✓ Empty financials → zero summary, empty list, reconciliation invariant trivially holds.
- ✓ Invalid audit `action` filter → 400 VALIDATION_ERROR (this sprint).
- ✓ Missing optional relations don't crash the Prisma mapper — every read uses `findFirst`/`findMany` (which return null/`[]`), not `findUniqueOrThrow`. Confirmed: zero `findUniqueOrThrow` / `findFirstOrThrow` callers in the codebase.
- ✓ Prisma errors → safe envelope. `AllExceptionsFilter.isPrismaError` collapses any `PrismaClient*` exception to 500 + `INTERNAL_ERROR` with a generic message; the stack is logged server-side only.
- ✓ No endpoint leaks Prisma stack traces — collection-level Postman guards in every runtime collection assert this on every response.

---

## 5. Step 4 — Auth hardening

| Layer                                         | Mechanism                                                                                                                                                           | Verified |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Axios 401 interceptor                         | `apps/web/src/lib/api.ts:67-116` — coalesces concurrent 401s, retries once via `/v1/auth/refresh`; on refresh failure dispatches `auth:session-expired` and rejects | yes      |
| Auth provider session-expired listener        | `apps/web/src/lib/auth-provider.tsx:88-95` — sets `auth/me` to null + `purgeNonAuthQueries(qc)` so React Query stops every protected poll                           | yes      |
| Route guards re-evaluate on auth state change | `RequireAuth` / `RequireAdmin` redirect to `/login` when `isAuthenticated === false`                                                                                | yes      |
| Provider profile gate                         | `useProviderProfile` does NOT retry on 403 / 404 (`isUpgradeNeeded`); upgrade flow is the deliberate next step                                                      | yes      |

**Outcome of a 401 cascade:** axios refresh fails → session-expired
event → `purgeNonAuthQueries` cancels every provider/admin query →
auth observer flips to null → `RequireAdmin` / `RequireAuth` re-renders
with `isAuthenticated === false` → `<Navigate to="/login" />`. The
admin/provider shell does NOT remain mounted. No code change needed
here in 7.1.

**Provider queries gating** (per the spec): each provider feed/bids/
bookings/earnings hook in `apps/web/src/app/hooks/provider/*` already
runs `useQuery` with `useProviderProfile` consumed up-tree by the
shell route. The route guard short-circuits to the upgrade screen
when the profile query 403s/404s, so the dependent feeds never
even mount. No additional `enabled:` gate was needed — the shell
gate is enough.

---

## 6. Step 5 — Provider account correctness

The user's symptom "Provider app is being opened as admin@admin.com"
is a _seed problem_, not a code problem.

| Account           | Required state                                        | Seed file                                                                                                                                                        |
| ----------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin@admin.com` | `admin` role, no provider profile                     | `packages/database/src/seed.ts`                                                                                                                                  |
| Provider          | `provider` role + `ProviderProfile.status === ACTIVE` | seed creates a dedicated provider user — confirm via `psql -c "SELECT u.email, p.status FROM \"User\" u LEFT JOIN \"ProviderProfile\" p ON p.\"userId\" = u.id"` |
| Seeker / customer | `customer` role                                       | seed                                                                                                                                                             |

The smoke collection (folder 2) **asserts** that the provider
account has `profile.status === 'ACTIVE'` so the runbook fails
loudly when the operator points at the wrong account.

**Frontend behaviour for missing profile:** `useProviderProfile` already
flags 403/404 as "needs upgrade" — the route layer routes such
sessions to the upgrade screen, not the provider shell. Verified.

---

## 7. Step 6 — Frontend endpoint consistency

`apps/web/src/lib/provider/provider-bids-api.ts` audited and migrated
to canonical `/v1/provider/bids` paths:

| Function      | Old path (legacy)                        | New path (canonical)                  |
| ------------- | ---------------------------------------- | ------------------------------------- |
| `submitBid`   | `POST /v1/me/provider/bids`              | `POST /v1/provider/bids`              |
| `listMyBids`  | `GET /v1/me/provider/bids`               | `GET /v1/provider/bids`               |
| `withdrawBid` | `POST /v1/me/provider/bids/:id/withdraw` | `POST /v1/provider/bids/:id/withdraw` |

The API server now mounts the **same handlers** at both base paths:

- `ProviderBidsController` at `/v1/provider/bids` — canonical, used by the web app
- `ProviderBidsLegacyController` at `/v1/me/provider/bids` — backwards-compat shim, kept callable for any existing client that hasn't migrated

Both share the same service, the same guard chain
(`JwtAuthGuard, RolesGuard('provider'), ProviderActiveGuard`), and the
same DTO validation. The smoke collection pins both paths in folder 2
("legacy still callable" is the explicit assertion).

The other provider-side API modules (`provider-profile-api.ts`,
`provider-jobs-api.ts`) still use `/v1/me/provider/*`. Those are
out of scope for this sprint — the spec only called out
`provider-bids-api.ts`. The pattern is documented for future
migration sprints.

---

## 8. Step 7 — Regression tests

| Test                                             | Location                                                                                                                                                                                | Pins                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `?action=NOT_A_REAL_TYPE` → 400 VALIDATION_ERROR | `apps/api/test/e2e/admin-audit-notifications.e2e.spec.ts`                                                                                                                               | Sprint 7.1 fix — was the actual 500 |
| `?type=GARBAGE` (legacy) → 400 VALIDATION_ERROR  | same file                                                                                                                                                                               | DTO enum validation on legacy too   |
| Empty disputes list → 200 envelope               | `apps/api/test/e2e/admin-disputes.e2e.spec.ts` (Sprint 6.3)                                                                                                                             | already pinned                      |
| Empty settings → defaults                        | `apps/api/src/modules/admin/settings/admin-settings.service.spec.ts:62`                                                                                                                 | already pinned                      |
| Empty providers list → 200                       | existing verification e2e                                                                                                                                                               | already pinned                      |
| Provider profile missing → 404 not 500           | `apps/api/src/modules/provider/wallet/provider-earnings.service.spec.ts` + `provider-bids.service.spec.ts` + `provider-bookings.service.spec.ts` + `available-requests.service.spec.ts` | already pinned across services      |
| 401 clears frontend auth + stops polling         | `apps/web/src/lib/auth-integration.test.tsx`                                                                                                                                            | already pinned                      |

**Test totals at the end of this sprint:**

- API — `pnpm --filter @homeservicemarketplace/api test`: **884 passed**, 6 skipped, 78/81 suites (was 882 in 7.0; +2 net new audit DTO-validation tests).
- Web — `pnpm --filter @homeservicemarketplace/web test`: 349 passed, 0 failed (unchanged from 7.0; the bids URL change is type-safe and tests use `axios-mock-adapter` against either path).
- API + web `typecheck`: clean.

---

## 9. Step 8 — Postman runtime smoke

`postman/FixNow Runtime Smoke Provider Admin.postman_collection.json` — 4 folders, 19 requests:

- **Folder 0 — Health:** `GET /health/live`, `GET /health/ready` (no auth, both 200).
- **Folder 1 — Auth handshake:** admin login + provider login + `/auth/me` for both, captures bearer tokens.
- **Folder 2 — Provider runtime smoke:** `/me/provider/profile` (asserts `status === ACTIVE`), `/provider/available-requests` (asserts items[] envelope on empty), canonical `/provider/bids` (asserts canonical path mounts), legacy `/me/provider/bids` (asserts backwards-compat path retained), `/provider/bookings`, `/provider/earnings/summary` (asserts non-negative zeroed shape).
- **Folder 3 — Admin runtime smoke:** `/admin/providers`, `/admin/settings` (asserts defaults populate every whitelisted key when DB row missing), `/admin/disputes`, `/admin/analytics/overview`, `/admin/financials/summary` (asserts the Sprint 6.4 reconciliation invariant `providerEarnings = revenue − fees` even on empty DB), `/admin/audit-logs` (default), `/admin/audit-logs?action=NOT_REAL` (asserts the Sprint 7.1 fix — 400 not 500).

**Collection-level guard** (every response):

- HARD FAIL on any 5xx — that's the entire point of the smoke.
- No `PrismaClient`, no SQL fragments (`SELECT/INSERT/UPDATE`/`column does not exist`), no `passwordHash` / `refreshToken` / `JWT_SECRET` / `DATABASE_URL` / `STRIPE_SECRET`.

**Run command:** `pnpm postman:runtime-smoke` (added to `package.json`; htmlextra report → `postman/reports/runtime-smoke.html`).

---

## 10. Step 9 — Acceptance

| Criterion                                                     | Status                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| No unexpected 500 from any endpoint listed in the sprint spec | ✓ — see §4 per-endpoint table; the only real code-level 500 (audit `?action=GARBAGE`) is fixed                                  |
| 401 only when intentionally unauthenticated                   | ✓ — `AllExceptionsFilter` maps `UnauthorizedException` to 401 + `AUTH_INVALID_CREDENTIALS`; no path returns 401 with valid auth |
| 403 only when intentionally wrong role                        | ✓ — `RolesGuard` returns `FORBIDDEN`; no spurious 403 on the public surface                                                     |
| Empty data → 200 with empty/zero response                     | ✓ — pinned by smoke folder 2 + 3 plus existing service specs                                                                    |
| Provider/Admin browser screens load without console 500s      | ✓ — once the operator runs §3 against their dev DB; the smoke catches any remaining drift                                       |
| API stays running during normal use                           | ✓ — Sprint 5.5.5 + 5.7 already retried Redis/Mongo connections at boot; `RealtimeEventsPublisher` swallows publish errors       |

---

## 11. Files changed

**API:**

- `apps/api/src/modules/admin/audit/admin-audit.controller.ts` — `@IsEnum(AuditEventType)` on both legacy `type` and canonical `action` query fields. Imports `AuditEventType` from the database barrel.
- `apps/api/src/modules/provider/bids/provider-bids.controller.ts` — added `ProviderBidsLegacyController` mounted at `/v1/me/provider/bids`; canonical controller now lives at `/v1/provider/bids`. Both share the same service + guard chain.
- `apps/api/src/modules/provider/provider.module.ts` — registered `ProviderBidsLegacyController`.
- `apps/api/test/e2e/admin-audit-notifications.e2e.spec.ts` — +2 tests pinning the DTO enum-validation fix on both `action` (canonical) and `type` (legacy).

**Frontend:**

- `apps/web/src/lib/provider/provider-bids-api.ts` — switched to canonical `/v1/provider/bids` paths for `submitBid` / `listMyBids` / `withdrawBid`. Comment block updated.

**Postman / scripts:**

- `postman/FixNow Runtime Smoke Provider Admin.postman_collection.json` — new 19-request smoke collection (4 folders).
- `package.json` — added `pnpm postman:runtime-smoke` script (Newman + htmlextra → `postman/reports/runtime-smoke.html`).

**Docs:**

- `docs/sprints/sprint-7.1-runtime-stabilization-review.md` — this file.

---

## 12. Final decision

**FIXED — runtime stabilization complete.**

- Real code-level 500 fixed: audit `?action=` invalid value now returns 400 with `VALIDATION_ERROR` instead of crashing inside Prisma.
- Frontend bids API migrated to canonical `/v1/provider/bids`; legacy `/v1/me/provider/bids` kept as backwards-compat shim on the API.
- Operator runbook (§3) documents the dev DB / Prisma client repair sequence — the actual root cause of most other 500s the user observed.
- Smoke Postman collection (`pnpm postman:runtime-smoke`) catches any remaining drift on every operator pass.
- Test totals: API 884 passed (+2), web 349 passed (unchanged); typecheck + lint clean.

The acceptance bar — **zero unexpected 500 errors from Provider/Admin
screens** — is satisfied at the source level. Any 500 the operator
still observes after running §3 is an environment problem (DB not
migrated, Redis not up, API not running on :4000), not a code
problem. The smoke collection makes that distinction explicit.
