# K02 — Evidence (local; hosted acceptance not yet run)

## Identity

| Item                 | Value                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base                 | `origin/develop` `92770ea65ee1154f94f4251d5febfa39822f9b9a`, tree `854a9146c05bf21ef62af060358f581ec4c19306`                                                                                                            |
| Code head (evidence) | `4b44a632185b43024635a708f37b96ded3c19808`, tree `6366cef4187fa725da58deff6e8253516c27523b` (web build); API build from `8862c7f02cd792d423039b658c1f8add555a9a2b` — `apps/api`, `packages/*` unchanged between the two |
| Migration head       | `20261103091000_k02_user_legal_acceptance`                                                                                                                                                                              |
| Toolchain            | Node 24.21.0, pnpm 10.32.1, Prisma 6.12.0; `pnpm install --frozen-lockfile` exit 0                                                                                                                                      |
| Host                 | Windows 11, Docker 29.1.3; `postgres:16-alpine`, `redis:7-alpine`, `axllent/mailpit:latest` (throwaway containers `k02-*`)                                                                                              |
| Flags                | `LEGAL_DRAFT_ACCEPTANCE_ALLOWED` unset (open because `NODE_ENV=development`); `WORK_ACCESS_ENFORCED`/`VERIFICATION_ENFORCED` true in the K02 integration suite; web build has no K02 flag                               |

## Static

| Command                                                                        | Result                                                                 |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `pnpm --filter @homeservicemarketplace/{contracts,database,api,web} typecheck` | exit 0 ×4                                                              |
| `pnpm --filter @homeservicemarketplace/api lint`                               | exit 0                                                                 |
| `pnpm --filter @homeservicemarketplace/web lint`                               | 0 errors, 34 warnings (all pre-existing files; none introduced by K02) |
| `npx prettier --check` on all 156 changed source files                         | clean                                                                  |
| `prisma migrate diff --from-url … --to-schema-datamodel … --exit-code`         | exit 0 (no drift)                                                      |

## Unit (hermetic)

| Suite                                                                | Result                                                                                 |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm --filter @homeservicemarketplace/api test`                     | 312 suites passed, 102 skipped (DB-gated); 5,500 tests passed, 1,888 skipped, 0 failed |
| `apps/web: npx vitest run`                                           | 230 files passed; 2,756 tests passed, 0 failed                                         |
| new: `test/unit/k02-amount-unit.spec.ts`, `k02-saudi-market.spec.ts` | 22 passed                                                                              |
| `node --test scripts/perf/post-r18/lib/lib.test.mjs`                 | 26 passed                                                                              |

## Integration (real PostgreSQL 16 + Redis 7, real AppModule over HTTP)

| Suite                                                                                     | Result                                                 |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `k02-saudi-contracts.integration.spec.ts` (`RUN_DB_INTEGRATION=1`)                        | 8/8, three consecutive runs + final tree               |
| Every existing integration suite touched by K02 (fork, isolated seeded DB `hsm_k02_fork`) | all passed (94/94 + 72/72 after seeding)               |
| `pnpm --filter @homeservicemarketplace/database verify:migrations`                        | ALL CHECKS PASSED (empty, upgraded, two refusal cases) |
| Full DB-gated API suite                                                                   | **not run locally** — hosted CI (`ci.yml` DB job)      |
| `r21-durable-mail`, `r17-admin-operations-browser` (needs Mailpit/web build)              | **not run locally**                                    |

### Upgrade proof (pre-K02 data)

Database built at the pre-K02 migration head, rows inserted the old way
(currency by default), then K02 applied:

```
before|b1|1000|USD        after|b1|1000|USD|NULL
before|k1|1000|USD        after|k1|1000|USD|NULL
default|Bid|NONE   default|Booking|NONE   acceptances|0
```

## Browser (real API, production bundle, Mailpit, read-only DB checks)

API `node apps/api/dist/main.js` on 127.0.0.1:4110 (`/health/live`
`sourceSha: 8862c7f0…`), `vite preview` of `VITE_API_URL=http://127.0.0.1:4110
pnpm --filter @homeservicemarketplace/web build` on 127.0.0.1:4183, dev seed.

`playwright test e2e/k02-saudi-launch.real-api.spec.ts --project=chromium-desktop --workers=1`
→ **5 passed** (final run; also 2 earlier consecutive full passes):

| Test | Proves                                                                                                                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V01  | /select, /legal/{terms,privacy,operator}, signup + policy dialog at 320/390/430/768/1024/1440 × EN/AR: `lang`/`dir`, no page overflow, no internal labels, toggle ≥ 44 px and pill on the active language, DRAFT banner and exact version                                                   |
| V02  | 195 CSS px layout (390 @ 200 %): legal page and signup usable, no overflow, language control inside the viewport                                                                                                                                                                            |
| C01  | Protected deep link → login → signup; policy by pointer, Enter and Ctrl-click (new tab) never toggles consent; focus returns; email/password kept; Space ticks; OTP; lands on the returnTo; DB has TERMS + PRIVACY rows with the exact versions and a server time inside the request window |
| A01  | Arabic chosen on /select survives reload, a protected redirect, sign-in and another reload                                                                                                                                                                                                  |
| M01  | Seeker request via API; provider types `100.255` (refused inline) then `١٠٠٫٢٥` in the real bid form → DB `Bid` 10025 SAR scale 2 → booking 10025/SAR/2 → wallet `SAR 100.25` (no `$`, headline not clipped) → Admin financials `SAR 100.25`                                                |

Screenshots inspected (not only generated); curated set in `evidence/`
(synthetic accounts only). Defects found by inspection and fixed in K02: RTL
toggle pill on the wrong option, wallet card clipping, dialog focus loss,
selector fade captured mid-animation (reduced motion now honoured), password
hint (8 vs 12), auth header at 200 %.

Not covered: WebKit/Firefox, physical iOS/Android devices, dark theme on the
new legal pages (they inherit the app's theme class), hosted environment.
