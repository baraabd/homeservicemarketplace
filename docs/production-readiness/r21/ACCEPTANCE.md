# R21 — acceptance evidence and instructions

Overall: **SOURCE_VERIFIED + local real-service verified; INTEGRATION_PENDING
(CR-R21-03); HOSTED_ENVIRONMENT_BLOCKED; POLICY_BLOCKED (service choice).**
Not SANDBOX_ACCEPTED, HOSTED_ACCEPTED or RELEASE_ACCEPTED.

A constructed SMTP client is not delivery evidence, and neither is Mailpit:
Mailpit proves local transport and message composition, not inbox placement
and not domain authentication.

## 1. Environment fingerprint (local, no secrets)

| Item       | Value                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Host       | Windows 11, Docker Engine 29.1.3, shared with other lanes' stacks                                                                             |
| Toolchain  | Node 24.21.0, pnpm 10.32.1, Prisma CLI 6.12.0 (repo pins)                                                                                     |
| Worktree   | `../HSM-r21`, independent `node_modules` (frozen install, exit 0)                                                                             |
| PostgreSQL | `postgres:16-alpine`, container `hsm-r21-pg`, tmpfs data, loopback ephemeral port, DB `hsm_r21`, random per-run password (never printed)      |
| Redis      | `redis:7-alpine`, container `hsm-r21-redis`, loopback ephemeral port                                                                          |
| SMTP       | `axllent/mailpit:v1.27`, container `hsm-r21-mail`, `MP_SMTP_DISABLE_RDNS=true`, loopback ephemeral SMTP + API ports                           |
| Isolation  | lane-unique container names and label `hsm.lane=r21`; the developer's `hsm-postgres`/`hsm-redis` and other lanes' containers were not touched |

Fixture note: with default settings Mailpit took ~10 s to send its SMTP
greeting to a host client on Docker Desktop (reverse-DNS lookup), which is
why the fixture disables RDNS (CR-R21-03 D).

## 2. Commands and results

Run on 2026-10-14 in `../HSM-r21` on the R21 tree over base `059c018`,
after recreating the lane stack (tmpfs Postgres, Redis, Mailpit
`axllent/mailpit:v1.27`; per-run random credentials, never printed). Every
exit code was checked. Counts are exact.

| #   | Command (worktree root unless noted)                                                                                                                                                                                     | Result                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <lane shadow DB> --script` (packages/database)                                                 | "This is an empty migration": schema and migrations agree                                                                                                            |
| 2   | `prisma migrate deploy`; `prisma generate` (6.12.0); database `build`; `node dist/seed.js`                                                                                                                               | exit 0 each; R21 migration applied to the lane DB                                                                                                                    |
| 3   | `pnpm --filter @homeservicemarketplace/api typecheck`                                                                                                                                                                    | first run **exit 2**: 2 type errors in R21 test files (a `Logger` spy signature, an untyped config map). Fixed; `tsc --noEmit -p apps/api/tsconfig.json` then exit 0 |
| 4   | `pnpm --filter @homeservicemarketplace/api lint`; `eslint test/integration/r21-*.spec.ts`; `eslint scripts/production/email/*.cjs`                                                                                       | exit 0, 0 problems each                                                                                                                                              |
| 5   | `prettier --list-different` over every changed file                                                                                                                                                                      | clean. Unformatted base files in the same folders (`otp.service*`, `session.service*`, `nodemailer-mail.*.spec`) are untouched by R21                                |
| 6   | `jest src/infrastructure/mail src/modules/iam src/infrastructure/outbox src/config` (apps/api)                                                                                                                           | 27/27 suites, **411/411** tests                                                                                                                                      |
| 7   | `jest` (apps/api, full unit run, no service env)                                                                                                                                                                         | suites: 229 passed, 81 skipped (DB-gated), 4 failed; tests: 4180 passed, 1542 skipped, 1 failed. Note A                                                              |
| 8   | `RUN_DB_INTEGRATION=1` + `R21_MAILPIT_*`: `jest test/integration/r21- --runInBand`                                                                                                                                       | 2/2 suites, **26/26** tests, **0 skipped** (Mailpit cases ran over real SMTP)                                                                                        |
| 9   | `RUN_DB_INTEGRATION=1 jest` on `auth-flow`, `password-reset`, `r04-auth-lifecycle`, `provider-upgrade-session`, `phase4-persistence-durability`, `outbox.integration`, `r17-notifications`, `verification-case-workflow` | 7/8 suites, 135/136 tests; 1 failed in `r17-notifications`. Note B                                                                                                   |
| 10  | `jest test/integration/r17-notifications --runInBand`, three isolated repeats                                                                                                                                            | 14/14, 14/14, 14/14                                                                                                                                                  |
| 11  | `node --test scripts/production/email/email-tools.test.cjs`                                                                                                                                                              | 8/8                                                                                                                                                                  |
| 12  | `pnpm --filter @homeservicemarketplace/api build`, then `node dist/main` on lane port 4121 (§5)                                                                                                                          | build exit 0; runtime results in §5                                                                                                                                  |

**Note A (pre-existing, not R21).** Three failing suites (`logger.module`,
`storage.module`, `market-module-safety`) crash at import because
`ConfigModule` validates `DATABASE_URL` and `JWT_ACCESS_SECRET`, which CI
always sets. With dummy values for those keys, all three pass. The fourth,
`restricted-erasure.spec.ts` › "does not flatten a directory or ENOTDIR
storage error into absence", fails because Windows reports a different
filesystem error than Linux. R21 changes no file under `storage/`,
`logger/` or `modules/provider/` (`git diff --quiet 059c018 --` on those
paths: exit 0).

**Note B (known local flake, not R21).** R17-B "an announcement whose
worker died after claiming is reclaimed and announced once" failed once on
a contended host and passed in three isolated repeats. It depends on lease
expiry against the Docker VM clock (known ~0.3 s skew). R21 changes nothing
under `infrastructure/outbox` or `modules/notifications` (`git diff
--quiet`: exit 0).

**Not run locally:** the full gated Postgres/Redis suite (~300 suites), the
web package and Playwright. R21 changes no web file. Hosted CI on the PR is
the gate for the full gated suite (`RISKS.md` 13).

### 2b. Re-run after merging develop (2026-10-14)

Tree: R21 merged with `origin/develop@4d04e91`, which includes R19 #159,
R22 #158, G0 #157 and #156; see `OWNERSHIP.md` › Integration with develop.
A fresh lane stack was created, and every migration on the merged tree was
applied to an empty database.

| #   | Command                                                                                                                                                                                                                                              | Result                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | `pnpm install --frozen-lockfile` (lockfile unchanged between `059c018` and `develop`)                                                                                                                                                                | exit 0                                                                                                                                          |
| M2  | `prisma validate`; `prisma format --check`; `prisma generate`                                                                                                                                                                                        | valid; formatted; generated                                                                                                                     |
| M3  | `prisma migrate diff --from-migrations … --to-schema-datamodel … --shadow-database-url <lane shadow>`; `migrate deploy`; seed                                                                                                                        | empty migration; all applied; exit 0                                                                                                            |
| M4  | `pnpm --filter @homeservicemarketplace/api typecheck`; `… lint`; `eslint test/integration/r21-*.spec.ts`                                                                                                                                             | exit 0 each                                                                                                                                     |
| M5  | `jest src/infrastructure/mail src/modules/iam src/infrastructure/outbox src/config src/modules/money`                                                                                                                                                | 35/35 suites, **489/489**                                                                                                                       |
| M6  | `jest test/integration/r21- --runInBand` (real Postgres + Mailpit)                                                                                                                                                                                   | 2/2 suites, **26/26**, 0 skipped                                                                                                                |
| M7  | `jest` on `auth-flow`, `password-reset`, `r04-auth-lifecycle`, `provider-upgrade-session`, `outbox.integration`, `r22-outbox-reliability`, `r22-outbox-replay`, `r19-subscription-money`, `r15-ledger`, `verification-case-workflow` (real Postgres) | 10/10 suites; 190 passed, 4 skipped, 0 failed. The 4 skips are R22's own CR-01-conditional replay cases (`applyCr01 ? it.skip : it`), not R21's |

## 3. Behaviour → evidence map

| Required behaviour                                | Evidence                                                                                                                                                                                                               | Level                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Real local SMTP (Mailpit)                         | `r21-durable-mail` › registration OTP reaches real SMTP; reset link; verification link                                                                                                                                 | real Postgres + real SMTP |
| Verification/reset link correctness               | same; links are `https://<FRONTEND_URL>/verify-email?token=…` / `/reset-password?token=…`, HTML `href` matches                                                                                                         | real                      |
| Link expiry / single use                          | `r21-durable-mail` › reset link single-use and expired link refused                                                                                                                                                    | real Postgres             |
| Resend throttling                                 | per-route throttles unchanged; per-address: `r21-durable-mail` › 7th reset request; unit › throttle spec                                                                                                               | real Postgres + unit      |
| Template escaping                                 | `mail-templates.spec.ts` (escaping, strict vars, URL builder, no secret in subject)                                                                                                                                    | unit                      |
| No token/secret leaks                             | envelope bytes contain neither token nor address (`r21-durable-mail`); logs never contain recipient/token/driver message (`durable-mail.service.spec`); probe script never echoes credentials (`email-tools.test.cjs`) | real + unit               |
| Rollback → no message                             | `r21-durable-mail` › rolled-back tx; reset whose audit fails; `r21-mail-feedback` › rolled-back worker tx                                                                                                              | real Postgres             |
| Retry/dedupe under crash                          | `r21-durable-mail` › SMTP unreachable then recovered; sender dies mid-flight; three dispatchers on one backlog; one messageKey = one message                                                                           | real Postgres             |
| Temporary rejection                               | `durable-mail.service.spec` › 4xx retry schedule; `r21-durable-mail` › unreachable relay                                                                                                                               | unit + real               |
| Permanent rejection                               | `durable-mail.service.spec` › 5xx; `r21-durable-mail` › permanent → FAILED, never reclaimed                                                                                                                            | unit + real               |
| Bounce signature / replay negatives               | `feedback-signature.spec` (wrong secret, tampered body, re-dated, stale, future, malformed); `r21-mail-feedback` › forged/stale/unsigned 401, concurrent replay → one applied                                          | unit + real HTTP          |
| Forged feedback cannot disable arbitrary accounts | `r21-mail-feedback` › cannot suppress an address never mailed / a message never accepted; extra `to` field → 400; account unchanged                                                                                    | real HTTP                 |
| Permanent suppression scope                       | `r21-mail-feedback` › hard bounce suppresses NOTIFICATION, AUTH still delivered, other address unaffected                                                                                                              | real HTTP                 |
| Acceptance ≠ delivery                             | rows stay ACCEPTED until signed `delivered` feedback                                                                                                                                                                   | real                      |
| Bilingual + sensitive-content exclusion           | `mail-templates.spec` (every template: `lang/dir`, Arabic present, no case ids); provider-status handler spec                                                                                                          | unit + real               |
| Existing auth-cookie / recovery tests preserved   | `authentication.service.spec` 48/48 unchanged assertions; gated `auth-flow`, `password-reset`, `r04-auth-lifecycle`, `provider-upgrade-session`, `phase4` suites (see §2)                                              | unit + real               |
| Operator tooling                                  | `email-tools.test.cjs` 8/8; probe rehearsal against local Mailpit (accepted, reply 250) and plaintext refusal without the loopback flag (ETLS)                                                                         | real local                |

## 4. Hosted acceptance (HOSTED_ENVIRONMENT_BLOCKED)

Blocked on: owner selection of the service and sender domain (P-1), sender
credentials in the protected secret mechanism, DNS authorization, and an
authorized independent test inbox. Owner: product owner / operator.

Run only against an **authorized** target; record results here, never the
credentials, tokens or full addresses.

| Step | Action                                                                                                                                                                          | Pass condition                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| H-1  | Fill the "Selected service" table in `infra/production/email/SENDER_DOMAIN.md` from the vendor's official docs (URL + date)                                                     | values sourced, not invented                                                                                                          |
| H-2  | With authorization, publish SPF/DKIM/DMARC; run `node scripts/production/email/check-sender-dns.cjs <domain> --dkim-selector <s>`                                               | exit 0, three PASS lines                                                                                                              |
| H-3  | Load SMTP settings from the secret mechanism into one process; run `node scripts/production/email/send-acceptance-probe.cjs --to <authorized inbox> --confirm-authorized-inbox` | exit 0, `accepted=1`, `smtp-reply=250`, TLS mode not plaintext                                                                        |
| H-4  | Open the probe in the independent inbox (a different provider from the sender)                                                                                                  | `Authentication-Results`: `spf=pass`, `dkim=pass` (d= sending domain), `dmarc=pass`; record the probe id and these three results only |
| H-5  | On the hosted API: register with the authorized inbox, receive OTP, verify; forgot-password, receive link, reset                                                                | both messages arrive, bilingual, links open the hosted web origin, `EmailDelivery` rows ACCEPTED                                      |
| H-6  | After a vendor feedback adapter exists: trigger the vendor's bounce/complaint simulator                                                                                         | rows move to BOUNCED/COMPLAINED; suppression row created; account unchanged                                                           |

Until H-1…H-5 are recorded, hosted delivery is **not evidenced**.

## 5. Runtime checks on the real API (local)

The built API (`node dist/main`, `NODE_ENV=development`, lane port 4121,
`SMTP_HOST`/`SMTP_PORT` pointing to the lane Mailpit, lane Postgres/Redis)
was exercised over HTTP on 2026-10-14:

| Check                                                            | Observed                                                                                                                                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/auth/register` (new synthetic address)                 | HTTP 202 (unchanged neutral response)                                                                                                                                       |
| Mailpit                                                          | one message to that address; subject `Confirm your email to finish signing up · أكّد بريدك لإكمال التسجيل` (no code in the subject); Message-ID domain = `SMTP_FROM` domain |
| `EmailDelivery` row                                              | `auth.registration_otp`, `ACCEPTED`, `attempts=1`, envelope cleared                                                                                                         |
| `POST /v1/mail/feedback` without `MAIL_FEEDBACK_SIGNING_SECRET`  | HTTP 404; `mail_feedback_rejected_total{reason="disabled"} 1`                                                                                                               |
| `/metrics`                                                       | `mail_delivery_attempts_total{category="AUTH",outcome="accepted"} 1`; `mail_delivery_queue_depth{status=…}` gauges present                                                  |
| Restart with a signing secret, unsigned `POST /v1/mail/feedback` | HTTP 401, fail closed; raw body mount is active; metric `mail_feedback_rejected_total{reason="signature"} 1`                                                                |

Correction: the first attempt at the second boot hit `EADDRINUSE` because
the first API process had not exited, so its response came from the old
process and was discarded. The table shows the repeated run on a
verified-free port. Both lane API processes were stopped afterwards.
