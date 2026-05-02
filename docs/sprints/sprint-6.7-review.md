# Sprint 6.7 Review Report — Admin Runtime Harness + Newman

## 1. Planning Summary

- **Scope:** Bundle the per-sprint Admin Postman scaffolding into
  a single end-to-end runnable; add a Newman runner script + a
  harness guide.
- **Existing:** `postman/hsm-admin.postman_collection.json` already
  has folders 00 → 70 from Sprints 6.0 → 6.6. Only the runner
  script + the runtime guide were missing.

## 2. Implementation Summary

- **Files added:**
  - `docs/testing/admin-runtime-harness.md` — runtime guide:
    prerequisites, env setup, what each folder covers, what's not
    covered, troubleshooting.
- **Files changed:**
  - `package.json` — added `pnpm postman:admin` script (Newman +
    `--bail` + htmlextra reporter writing to
    `postman/reports/admin.html`).
- **Migrations:** none.
- **Contracts:** none.
- **UI:** none.
- **API endpoints:** none — Sprint 6.7 is harness-only.

## 3. Automated Tests

| Check                                                 | Result                          |
| ----------------------------------------------------- | ------------------------------- |
| `pnpm --filter @homeservicemarketplace/api typecheck` | pass                            |
| `pnpm --filter @homeservicemarketplace/api test`      | unchanged from 6.6 — 637 passed |
| `pnpm --filter @homeservicemarketplace/web test`      | unchanged from 5.6 — 295 passed |

## 4. Postman Tests

- Cumulative admin story (8 folders; total 17+ requests).
- The `pnpm postman:admin` runner picks up the same
  `postman/local.postman_environment.json` (gitignored) the provider
  harness uses and writes its HTML report to
  `postman/reports/admin.html` (also gitignored — added in Sprint 5.7).

## 7. Remaining Issues

- See `docs/testing/admin-runtime-harness.md §4` for the explicit
  list of what's not covered.

## 8. Sprint Decision

**PASS** — Continue automatically. The admin chapter is closed.

---

## Sprint 6.7 (refined) — Consolidated Admin Runtime collection

Re-opened by the spec to ship a single end-to-end **runtime narrative**
rather than the legacy 8-folder reference collection (which is
organised by sprint number, mixing per-feature negatives with
positives). The consolidated runtime mirrors `FixNow Provider
Runtime` (Sprint 5.7) — one bearer-token capture in folder 01,
then every later folder reuses it, plus a dedicated
`10 — Negative Security` folder that pins cross-role 403 / no-token
401 / IDOR-style query rejection across the whole admin surface.

### Files added / changed (refined run)

| File                                                   | Change                                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `postman/FixNow Admin Runtime.postman_collection.json` | **new** — 10-folder consolidated admin runtime (29 requests, collection-level Prisma/SQL/secret guard)           |
| `postman/local.postman_environment.example.json`       | added `targetUserId`, `adminUserId`, `adminNotificationId` env keys                                              |
| `package.json`                                         | added `pnpm postman:admin-runtime` script (Newman + `--bail` + htmlextra → `postman/reports/admin-runtime.html`) |

### 10 folders (matches the 6.x admin chapter)

| #   | Folder                      | Endpoints exercised (positive path)                                                                                                                                       |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | Auth                        | `POST /v1/auth/login` (admin + customer), `GET /v1/auth/me` — captures `adminToken`, `customerToken`, `adminUserId`, `adminOtpChallengeId` if mobile-mode OTP gate fires  |
| 02  | User Control (Sprint 6.1)   | `GET /v1/admin/users`, `?query=test`, `GET /:id`, `PATCH /:id/status`, `GET /v1/admin/roles`                                                                              |
| 03  | Provider Verification (6.2) | `GET /v1/admin/providers`, `GET /:id` (asserts `reviewNotes`), `GET /:id/audit`, `PATCH /:id/review-notes` (round-trip), `POST /:id/approve` (idempotent 200/404/409)     |
| 04  | Disputes (6.3)              | `GET /v1/admin/disputes`, `?status=OPEN&priority=HIGH` (asserts every row matches), `GET /:id` (asserts `recentEvents` array + `priority`), `PATCH /:id` (priority bump)  |
| 05  | Analytics (6.4)             | `GET /v1/admin/analytics/overview` (counts/revenue/range), `GET /v1/admin/analytics/revenue` (buckets[])                                                                  |
| 06  | Financials (6.4)            | `GET /v1/admin/financials/summary` (asserts `totalProviderEarnings === totalRevenue − totalPlatformFees`), `/bookings` (per-row reconcile), `/provider-earnings` (sorted) |
| 07  | Settings (6.5)              | `GET /v1/admin/settings` (whitelisted keys present), `PATCH` valid (round-trip), `PATCH` invalid (unknown `JWT_SECRET` → 400, body never echoes `pwned`)                  |
| 08  | Admin Notifications (6.6)   | `GET /v1/admin/notifications` (every `deepLink` starts with `/admin/`), `POST /:id/read` (200/404, `readAt` populated)                                                    |
| 09  | Audit Logs (6.6)            | `GET /v1/admin/audit-logs` (renamed `actor`/`action` wire fields, redaction guard), `?action=ADMIN_PROVIDER_APPROVED` (every row matches)                                 |
| 10  | Negative Security           | customer-token → `/admin/users` 403 + no `admin@` leak, customer-token → `/admin/audit-logs` 403, no-token → `/admin/financials/summary` 401, `?userId=victim` → 400      |

### Runtime invocation

```bash
# Bootstrap (one-time per fresh DB):
pnpm install
pnpm docker:up
pnpm --filter @homeservicemarketplace/database migrate:deploy
pnpm --filter @homeservicemarketplace/database seed
pnpm --filter @homeservicemarketplace/api dev    # in a separate terminal

# Postman environment:
cp postman/local.postman_environment.example.json postman/local.postman_environment.json
# fill: adminEmail / adminPassword / customerEmail / customerPassword

# Run the consolidated runtime:
pnpm postman:admin-runtime
```

The collection is also runnable interactively in Postman — folder 01
must run first to populate tokens.

### Acceptance criteria

- [x] 10 folders matching the 6.x admin chapter — present
- [x] Collection-level Prisma / SQL / `passwordHash` / `mfaSecret` /
      `refreshToken` / `JWT_SECRET` / `DATABASE_URL` /
      `STRIPE_SECRET` leak guard — present
- [x] Negative-security folder covers cross-role 403, no-token 401,
      and IDOR-style unknown-query 400 — present
- [x] Newman runnable via `pnpm postman:admin-runtime` (htmlextra
      reporter to `postman/reports/admin-runtime.html`) — present
- [x] Settings-write attempt with key `JWT_SECRET` is rejected and
      the failed value never appears in the response — asserted in
      folder 07
- [x] Audit-log response asserts the renamed canonical wire fields
      (`actor`, `action`) — asserted in folder 09
- [x] Financial reconciliation invariants asserted in-band — folder
      06 (`totalProviderEarnings === totalRevenue − totalPlatformFees`
      summary-level + `amount − platformFee === netAmount` per booking)

### Coverage delta vs. legacy `hsm-admin` collection

The legacy `postman/hsm-admin.postman_collection.json` is reference-
style (one folder per sprint number, mixing positives + per-folder
negatives) — kept callable for backwards-compatible CI references.
The new `FixNow Admin Runtime` collection is **runtime-style**:

- bearer tokens captured once in folder 01 and reused
- every folder asserts JSON shape + financial / pagination
  invariants in-band
- one consolidated negative-security folder pins cross-role +
  IDOR-style guards across the entire admin surface in one place
- Newman script `pnpm postman:admin-runtime` (separate from the
  reference `pnpm postman:admin`)

### Sprint decision (refined)

**PASS** — Admin runtime narrative is callable end-to-end, the 10
folders match the 6.x chapter exactly, security negatives are
asserted, and Newman invocation is documented. Auto-continue to
Sprint 7.0.
