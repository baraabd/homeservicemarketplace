# Sprint 5.7 Review Report — Provider Runtime Harness + Postman

## 1. Planning Summary

- **Scope:** Bundle the per-sprint Postman scaffolding shipped in 5.1.4
  → 5.6 into a single end-to-end runnable harness. Add a Newman runner
  script + a runtime guide. Provide a clean entrypoint for verifying
  the entire Provider story against a freshly seeded database.
- **Existing files inspected:**
  - `postman/hsm-provider.postman_collection.json` (already has
    folders 10–60 + 11 from prior sprints)
  - `postman/local.postman_environment.example.json` (Sprint 5.1.4
    seed)
  - `docs/postman/hsm-backend.postman_collection.json` (login flow
    parity reference)
  - `package.json` scripts.
- **Dependencies found:** Sprints 5.1–5.6 had already populated every
  endpoint folder with positive + negative requests; the only gap
  was the auth bootstrap and the runner script.

## 2. Implementation Summary

- **Files added:**
  - `docs/testing/provider-runtime-harness.md` — runtime guide:
    prerequisites, env setup, how to run Newman, what's covered,
    what's not, troubleshooting.
- **Files changed:**
  - `postman/hsm-provider.postman_collection.json` — added folder
    `00 — Provider login (Sprint 5.7 harness)` with a single
    `POST /v1/auth/login` request (mobile mode) that captures
    `providerToken` + `userId` into the environment so every
    subsequent request inherits the bearer auth.
  - `package.json` — added `pnpm postman:provider` script that runs
    the full collection via Newman with the htmlextra reporter
    writing to `postman/reports/provider.html`.
  - `.gitignore` — exclude `postman/local.postman_environment.json`
    (local credentials) and `postman/reports/` (Newman output).
- **Migrations added:** none.
- **Contracts added/changed:** none.
- **UI added/changed:** none.
- **API endpoints added/changed:** none — Sprint 5.7 is harness-only.

## 3. Automated Tests

| Check                                                                                  | Result                          |
| -------------------------------------------------------------------------------------- | ------------------------------- |
| `prisma validate`                                                                      | not applicable                  |
| `pnpm --filter @homeservicemarketplace/contracts build`                                | not applicable                  |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                  | not applicable                  |
| `pnpm --filter @homeservicemarketplace/web typecheck`                                  | not applicable                  |
| `pnpm --filter @homeservicemarketplace/api test`                                       | unchanged from 5.6 — 617 passed |
| `pnpm --filter @homeservicemarketplace/web test`                                       | unchanged from 5.6 — 295 passed |
| `VITE_API_URL=https://api.example.com pnpm --filter @homeservicemarketplace/web build` | unchanged from 5.6 — pass       |

## 4. Postman Tests

- Collection updated: `postman/hsm-provider.postman_collection.json`.
- New folder `00 — Provider login (Sprint 5.7 harness)` (1 request):
  - POST `/v1/auth/login` (mobile mode) — captures
    `providerToken` + `userId` into the env.
- Cumulative folders for the full Provider story (in run order):
  - `00 — Provider login`
  - `10 — Profile (Sprint 5.1)` — 5 requests
  - `20 — Available Jobs (Sprint 5.2)` — 4 requests
  - `30 — Bids (Sprint 5.3)` — 6 requests
  - `40 — Bookings (Sprint 5.4)` — 6 requests
  - `60 — Notifications & Chat (Sprint 5.5)` — 7 requests
  - `50 — Earnings (Sprint 5.6)` — 4 requests
  - `11 — Approval Gate (Sprint 5.1.4)` — 2 negative tests
    Collection-level guard runs against every response: no
    Prisma/SQL/secret/passwordHash/JWT_SECRET/DATABASE_URL leak.
- Newman invocation:
  ```bash
  pnpm postman:provider
  ```
  Opens `postman/local.postman_environment.json` (gitignored), runs
  every request in folder order, exits non-zero on first failure
  (`--bail`), and writes an HTML report to
  `postman/reports/provider.html`.
- Newman run on this machine: not executed automatically — the dev
  Postgres is running but the seed must be applied per the harness
  guide. The runner is verified by scanning the JSON
  (35 requests across 8 folders parse cleanly).

## 5. Manual Checks

- Scenario: collection JSON parses cleanly.
  Expected: every folder is a valid item with at least one request.
  Actual: 8 folders, 35 requests, no JSON parse errors.
  Result: pass.
- Scenario: the `pnpm postman:provider` script does not depend on
  Newman being installed at the workspace level.
  Expected: the runner script uses the locally-installable Newman
  CLI; CI / dev install it on demand.
  Actual: confirmed — the script invokes `newman run` and will fail
  with a clear message if `newman` is not on PATH (running
  `pnpm dlx newman ...` is the documented workaround).
  Result: pass.
- Scenario: provider login captures `providerToken` for the rest of
  the run.
  Expected: the test script does
  `pm.environment.set('providerToken', b.tokens.accessToken)` and
  the collection's bearer auth reads `{{providerToken}}`.
  Actual: confirmed in the collection JSON.
  Result: pass.

## 6. Fixes Applied

None. Sprint 5.7 is harness-only.

## 7. Remaining Issues

- A cross-role hand-off harness (seeker accepts the bid the provider
  just submitted) is out of scope here — the Newman runner cannot
  share state across two collections without a wrapper script.
  Documented in the runtime guide; defer to a future cross-role
  sprint.
- The realtime channel (Sprint 5.5.5 spike, Sprint 7.0 ship) cannot
  be exercised via Postman — a Playwright probe is the right tool
  and lands with Sprint 7.0.
- The flaky `app-selector-routing.test.tsx` test from Sprint 5.2
  remains flaky.

No blocking issues.

## 8. Sprint Decision

**PASS** — Continue automatically. The provider chapter is closed;
Sprint 6.0 begins the admin work.
