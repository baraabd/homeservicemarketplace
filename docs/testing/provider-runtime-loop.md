# Provider Core Loop — runtime testing (Sprint 5.7)

This guide explains how to drive the full multi-actor Provider Core
Loop end-to-end against a running dev API. Two complementary
harnesses are available:

1. **CLI harness** — `scripts/runtime/verify-provider-loop.cjs`. One
   Node script, no extra deps, drives every step with `fetch` and
   asserts each response. Best for CI smoke + quick re-runs.
2. **Postman collection** — `postman/FixNow Provider Runtime.postman_collection.json`.
   11 folders, 26 requests; the operator can step through manually
   in the Postman UI or batch-run via Newman. Best for human-readable
   reproduction and for exporting a green run as an HTML report.

Both consume the same set of three pre-supplied bearer tokens
(`seekerToken`, `providerToken`, `adminToken`) — the harness focuses
on the _business loop_, not the auth handshake (which is verified
elsewhere in the repo's e2e + integration suites).

---

## Prerequisites

1. **Dev stack up:**

   ```sh
   pnpm docker:up        # postgres / mongo / redis / mailpit
   pnpm --filter api dev # API on :4000
   ```

2. **Three accounts seeded** (one-time, dev-only):
   - **Seeker (customer):** sign up via the web app or curl
     (`POST /v1/auth/register` → grab token from Mailpit at
     <http://localhost:8025> → `POST /v1/auth/verify-email`). When
     `AUTH_REQUIRE_EMAIL_VERIFICATION=false` in `.env`, registration
     auto-activates.
   - **Provider:** same sign-up, then
     `POST /v1/me/provider/upgrade` with the seeker's bearer to add
     the `provider` role.
   - **Admin:** the `admin` role is not exposed via a public
     endpoint. Run a one-time Prisma update against your local DB:

     ```sh
     # from packages/database, with .env DATABASE_URL set
     pnpm prisma db execute --stdin <<'SQL'
       INSERT INTO "UserRole" ("userId", "roleId")
       SELECT u.id, r.id
       FROM "User" u, "Role" r
       WHERE u.email = '<your-admin-email>' AND r.name = 'admin'
       ON CONFLICT DO NOTHING;
     SQL
     ```

3. **Three bearer tokens** captured. The Postman collection's
   `01 — Auth` folder logs each role and writes `seekerToken /
providerToken / adminToken` into the local environment file.
   The CLI harness expects them in env vars.

---

## Running the CLI harness

```sh
BASE_URL=http://localhost:4000 \
SEEKER_TOKEN=<bearer> \
PROVIDER_TOKEN=<bearer> \
ADMIN_TOKEN=<bearer> \
node scripts/runtime/verify-provider-loop.cjs
# or:
pnpm runtime:provider-loop
```

Optional env:

| Var                     | Default                                       | Purpose                              |
| ----------------------- | --------------------------------------------- | ------------------------------------ |
| `PROVIDER_PROFILE_ID`   | (looked up via `GET /v1/me/provider/profile`) | Skips the lookup                     |
| `SERVICE_CATEGORY_SLUG` | `plumbing`                                    | First-page slug for request creation |
| `TIMEOUT_MS`            | `15000`                                       | Per-request timeout                  |

Exit codes: `0` green · `2` step failed · `64` env missing /
production blocked.

---

## Running the Postman collection (Newman)

```sh
pnpm postman:provider-runtime
# expanded:
newman run "postman/FixNow Provider Runtime.postman_collection.json" \
  -e postman/local.postman_environment.json \
  --bail \
  --reporters cli,htmlextra \
  --reporter-htmlextra-export postman/reports/provider-runtime.html
```

`postman/local.postman_environment.json` is gitignored — copy from
`postman/local.postman_environment.example.json` and fill in
`adminEmail / adminPassword / providerEmail / providerPassword /
customerEmail / customerPassword`. Tokens and IDs are populated by
the collection at runtime.

Newman is not added to the repo's devDependencies. Operators install
it themselves (`npm i -g newman newman-reporter-htmlextra` or use
`npx`). This matches the pattern of the existing
`pnpm postman:provider` and `pnpm postman:admin` scripts.

---

## What each folder verifies

| Folder                           | Step                                                     | Endpoint(s)                                                                  |
| -------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 01 — Auth                        | Login each of the three roles, capture bearer tokens     | `POST /v1/auth/login` × 3, `GET /v1/auth/me`, `GET /v1/me/provider/profile`  |
| 02 — Admin Provider Approval     | Provider profile flips to ACTIVE                         | `GET /v1/admin/providers`, `POST /v1/admin/providers/:id/approve`            |
| 03 — Seeker Request Creation     | Service request created                                  | `GET /v1/services`, `POST /v1/me/requests`                                   |
| 04 — Provider Available Requests | Provider sees the request                                | `GET /v1/provider/available-requests`                                        |
| 05 — Provider Bids               | Bid submitted                                            | `POST /v1/me/provider/bids`                                                  |
| 06 — Seeker Accept Bid           | Bid accepted; booking spawned                            | `POST /v1/me/requests/:r/bids/:b/accept`                                     |
| 07 — Provider Bookings           | start → complete                                         | `GET /v1/me/provider/bookings`, `POST /:id/start`, `POST /:id/complete`      |
| 08 — Notifications               | Seeker has new notifications                             | `GET /v1/me/notifications`, `GET /v1/me/notifications/unread-count`          |
| 09 — Chat                        | Open / send / readback                                   | `POST /v1/provider/conversations`, `POST /:id/messages`, `GET /:id/messages` |
| 10 — Earnings                    | `completedBookingsCount ≥ 1`, `gross/fees/net` reconcile | `GET /v1/provider/earnings/summary`, `/transactions`                         |
| 11 — Negative Security           | Cross-role 403 + missing-token 401                       | various                                                                      |

Every response runs the collection-level guard: no
`PrismaClient`, `column ... does not exist`, raw `SELECT`/`INSERT`/
`UPDATE` strings, `passwordHash`, `refreshToken`, `JWT_SECRET`, or
`DATABASE_URL` may appear in any body.

---

## Re-running on dirty state

The collection and the CLI harness both tolerate re-runs:

- The admin approve step accepts `409` (already-ACTIVE) as success.
- The provider bid step uses `requestId` from the _current_ run,
  so a previous run's stale request is irrelevant.
- The booking start/complete steps use the freshly-captured
  `bookingId` — they never operate on data from a prior run.

If a prior run left `status = COMPLETED` bookings around, the
earnings step still passes (it asserts `completedBookingsCount ≥
1`, not exact equality). Cleanup is best-effort; no data is
deleted by the harness.

---

## When something fails

The CLI harness prints the failed label, request id, status, and
a redacted body excerpt to stderr. The Postman collection's
collection-level guard surfaces the same in the Newman CLI output.

Common failure modes:

- **401 on the first request after a long break** — the access
  token expired. Re-run `01 — Auth`.
- **403 on `04 — Provider Available Requests`** —
  `ProviderActiveGuard` rejected the call because the profile is
  still in `DRAFT` / `PENDING_REVIEW` / `SUSPENDED`. Re-run
  `02 — Admin Provider Approval`.
- **Bid submitted but seeker can't see it** — the request status
  flipped (e.g., expired). Pick a fresh request via folder `03`.
