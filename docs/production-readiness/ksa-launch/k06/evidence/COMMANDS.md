# K06 commands, exit codes and counts

Host: Windows 11, Git Bash; Node 24.21.0, pnpm 10.32.1, Docker 29.1.3.
Worktree: `HSM-k06`, branch `release/ksa-k06-admin-operations`.
Final code SHA: `49d7ba2e3974592ffe1d9b669bd61785009b70c4` (tree `f1e28473…`). API, gated and runtime runs below are at `6be58f44`; `49d7ba2e` adds only `IntakeForm.support.test.tsx`.
Base: `92770ea65ee1154f94f4251d5febfa39822f9b9a` (tree `854a9146…`).

## Disposable services (isolated from the dev stack and other K lanes)

| Container        | Image digest                                                                              | Host port   |
| ---------------- | ----------------------------------------------------------------------------------------- | ----------- |
| `k06-pg` (tmpfs) | `postgres@sha256:20edbde7749f822887a1a022ad526fde0a47d6b2be9a8364433605cf65099416`        | 5472        |
| `k06-redis`      | `redis@sha256:8b81dd37ff027bec4e516d41acfbe9fe2460070dc6d4a4570a2ac5b9d59df065`           | 6419        |
| `k06-mail`       | `axllent/mailpit@sha256:757f22b56c1da03570afdb3d259effe5091018008a81bbedc8158cee7e16fdbc` | 1035 / 8035 |

The repository's integration compose was not used: its fixed container names
collide with another session's running `hsm-phase2-it-mailpit`, which was left
untouched.

Environment for gated suites (synthetic, local-only):
`DATABASE_URL=postgresql://postgres:<local>@127.0.0.1:5472/hsm_k06 REDIS_HOST=127.0.0.1 REDIS_PORT=6419 RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1 JWT_ACCESS_SECRET=ci_only_dummy_secret_at_least_32_chars_long`.

## Setup

| Command                                                                       | Exit | Result                                                                |
| ----------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                              | 0    | 1170 packages                                                         |
| `pnpm --filter @homeservicemarketplace/database generate`                     | 0    | Prisma Client 6.12.0                                                  |
| `prisma migrate deploy` (against k06-pg)                                      | 0    | 75 migrations, `20261103090000_k06_support_ticket_experience` applied |
| `prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code` | 0    | No drift                                                              |
| `node packages/database/dist/seed.js`                                         | 0    | Baseline roles/permissions and synthetic dev accounts                 |

## Red → green (defect reproduction)

| Test                                                          | Before fix                     | After fix         |
| ------------------------------------------------------------- | ------------------------------ | ----------------- |
| r13 support, 5 K06 cases (service reverted to base)           | 5 failed, 12 passed            | 17/17             |
| r17 › removed admin cannot write settings                     | failed: PUT 200                | pass              |
| r17 › removed admin cannot mint an admin …                    | failed: access approve **200** | pass              |
| r17 › admin cannot decide own provider profile                | failed: approve **200**        | pass              |
| vitest ProviderStatusState support entry (component reverted) | 5 failed, 12 passed            | 17/17             |
| Playwright 44×44 check (previous bundle)                      | failed: "Back" w=29 at 320     | pass              |
| evidence audit-outage case, mutation (audit result ignored)   | failed: 200, bytes served      | pass on real code |

## Final-SHA gates (`6be58f44`)

| Command                                                                                                                                                                                                                                                                                                                                     | Exit | Counts                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------- |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                                                                                                                                                                                                                                                                       | 0    | —                                                                                  |
| `pnpm --filter @homeservicemarketplace/api lint`                                                                                                                                                                                                                                                                                            | 0    | —                                                                                  |
| `eslint` on every changed API test file                                                                                                                                                                                                                                                                                                     | 0    | —                                                                                  |
| `prettier --check` on every changed `.ts/.tsx`                                                                                                                                                                                                                                                                                              | 0    | —                                                                                  |
| `pnpm exec jest --maxWorkers=4` (API, CI-style dummy env, no DB gate)                                                                                                                                                                                                                                                                       | 0    | 311 suites passed, 101 skipped (DB-gated); **5486 passed, 0 failed**, 1890 skipped |
| Gated, in band: r13, r17-admin-operations, r18-admin-floor, r26-authorization, admin-provider-review, evidence-read-boundary, dispute-intake, dispute-workspace-http, admin-verification-policy, evidence-scan, admin-provider-directory, r17-dispute-legacy-http, e2e admin-settings / admin-disputes / admin-verification / app-module-di | 0    | **16 suites, 191 passed, 0 failed, 0 skipped**                                     |
| Gated, in band: route-capability-matrix, provider-journey, r17-provider-surfaces, r17-admin-operations-browser (`RUN_ADMIN_BROWSER=1`), r17-dispute-legacy-browser (`RUN_DISPUTE_BROWSER=1`)                                                                                                                                                | 0    | **5 suites, 200 passed**                                                           |
| Gated, in band: phase3 journeys C activation / C admin approval / D returned correction / submission stamping + admin-provider-directory + r17 + e2e admin-verification                                                                                                                                                                     | 0    | 7 suites, 150 passed                                                               |
| Gated, in band: app-module-di, admin-audit-notifications, restricted-media-boundary, r17-dispute-legacy-http, r17-disputes, service-area-expansion, phase5-c1-onboarding-defaults, r17-notifications, auth-flow (code-equivalent tree before the last two API commits)                                                                      | 0    | 9 suites, 138 passed                                                               |
| r13 + evidence-read-boundary + dispute-intake, 3 consecutive runs (default workers)                                                                                                                                                                                                                                                         | 0 ×3 | 46/46 each                                                                         |

Web, at `c715e81b` (no web file changed after it; verified with `git diff c715e81b HEAD -- apps/web` = empty):

| Command                                                                                                               | Exit | Counts                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @homeservicemarketplace/web typecheck`                                                                 | 0    | —                                                                                                                                                                                                                                                                                                                                                  |
| `tsc --noEmit -p tsconfig.e2e.json`                                                                                   | 0    | —                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm --filter @homeservicemarketplace/web lint`                                                                      | 0    | 0 errors, 34 warnings (pre-existing; the two in `HelpSupportPage.tsx` exist on base)                                                                                                                                                                                                                                                               |
| `pnpm exec vitest run` (1st run)                                                                                      | 1    | 2738 passed, **1 failed**: `DashboardOverview.test.tsx` "shows each currency separately…" after 29 s under host load. This file is untouched by K06; it passes 6/6 in 3 isolated runs and in the earlier full run                                                                                                                                  |
| `pnpm exec vitest run` (2nd run)                                                                                      | 0    | **227 files, 2739 passed**                                                                                                                                                                                                                                                                                                                         |
| `pnpm exec vitest run` at `49d7ba2e` (3rd run)                                                                        | 1    | 2742 passed, **1 failed**: the same `DashboardOverview` case. Cause: it is the file's first test, cold-imports the admin dashboard and waits with `findByTestId`'s default 1 s; under full-suite load on this shared host it times out. Pre-existing, file untouched, passes alone. Not changed here (no timeout inflation); flagged for its owner |
| `vitest run IntakeForm.support.test.tsx`                                                                              | 0    | 4 passed (4 failed against the base component)                                                                                                                                                                                                                                                                                                     |
| `VITE_API_URL=http://127.0.0.1:4061 VITE_PROVIDER_ONBOARDING_V2=true pnpm --filter @homeservicemarketplace/web build` | 0    | `SupportPage` and `HelpSupportPage` lazy chunks; entry `index-DNgWBRY6.js`, rebuilt from the committed tree with a **matching** hash                                                                                                                                                                                                               |

## Real runtime

- API: `pnpm --filter @homeservicemarketplace/api build` then `node apps/api/dist/main.js` on 4061 (`NODE_ENV=development`, CI browser-job env), rebuilt at `6be58f44`, health ok.
- SPA: `vite preview --host 127.0.0.1 --port 4181 --strictPort`, serving the hash-verified bundle above.
- Port ownership was checked before every restart. Only processes started by this lane (matched by start time and health uptime) were stopped; another session's API process was left running.

| Command                                                                                                                                                                                                      | Exit | Result                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | -------------------------------------------------------------------- |
| `E2E_REAL_API=http://127.0.0.1:4061 E2E_MAILPIT=http://127.0.0.1:8035 E2E_BASE_URL=http://127.0.0.1:4181 playwright test e2e/k06-support-operations.real-api.spec.ts --project=chromium-desktop --workers=1` | 0    | **3 passed** (EN provider, AR provider, EN customer); 44 screenshots |

## Not run, and why

| Suite / check                                                | Reason                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `evidence-retention.integration`                             | Needs the Go-built MinIO fixture and ClamAV from the hosted `evidence-retention` job; unchanged by K06 |
| Full gated jest suite in one process                         | Host shared with several K lanes; targeted gated sets above instead. Hosted CI runs the full set       |
| `admin-review-workflow.real-api` and other web real-API jobs | Owned by hosted CI jobs; no admin UI changed                                                           |
| Real mobile devices, dark mode, screen readers, axe          | See BLOCKED_INPUTS B-8                                                                                 |
| Staging, two synthetic admins on hosted infrastructure       | K03 not accepted (B-3)                                                                                 |
