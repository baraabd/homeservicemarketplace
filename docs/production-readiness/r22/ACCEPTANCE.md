# R22 — acceptance evidence

Sections 1–4 preserve the original implementation evidence. The 2026-10-15
corrective execution is recorded separately in §5. Old passing results do
not establish acceptance of the correction.

**Lane status: IMPLEMENTED · SOURCE_VERIFIED · INTEGRATION_PENDING.**
SANDBOX_ACCEPTED, HOSTED_ACCEPTED and RELEASE_ACCEPTED are **not** claimed.
Only the coordinator marks the wave accepted after integrated candidate tests.

## 1. Identity

| Item                                        | Value                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base                                        | `059c018576a75837d4dfb262ee49168d9217d881`                                                                                                                               |
| Source commit (code, tests, scripts, infra) | `1b43641b5f4379fc62a1f0104f5c7953a2c20ea7`, tree `aec3a77d659bfccab88076b082a1b51b6d25d7b2`                                                                              |
| Evidence commit                             | the commit adding `docs/production-readiness/r22/`. Its SHA is recorded in the PR body, not here, to avoid a self-referential commit                                     |
| Toolchain                                   | Node 24.21.0, pnpm 10.32.1 (repository pins); Prisma per lockfile; Windows 11 host, Git Bash                                                                             |
| Install                                     | `pnpm install --frozen-lockfile`: exit 0 (19m28s; contended with four concurrent lane installs). `prisma generate` was run explicitly because the worktree has no `.env` |

### Environment fingerprint (no secrets)

| Service     | Configuration                                                                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL  | `postgres:16-alpine` (CI's image), container `hsm-r22-pg`, `127.0.0.1:54922`, anonymous volume, `--rm`. Databases `r22_outbox` (CR-01 applied in-test), `r22_it` (pristine migrations), `r22_serial` (migrations + seed). All migrations applied with `prisma migrate deploy`: exit 0 |
| Redis       | `redis:7-alpine` (CI's image), container `hsm-r22-redis`, `127.0.0.1:54923`; replaced, not flushed, between runs                                                                                                                                                                      |
| Credentials | throwaway, loopback-only, never committed. The JWT secret is CI's published dummy value                                                                                                                                                                                               |
| Isolation   | The user's working DB (`hsm-postgres:5432`), the live API on the main checkout and every other lane's containers were not touched. Ports were checked free before binding                                                                                                             |

## 2. Commands and results (source commit content)

| #   | Command (from repo root unless noted)                                                                                                                                             | Result                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm --filter @homeservicemarketplace/api typecheck` (includes `test/**`)                                                                                                        | exit 0                                                                                                                  |
| 2   | `pnpm --filter @homeservicemarketplace/api lint`                                                                                                                                  | exit 0                                                                                                                  |
| 3   | pre-commit hook (lint-staged eslint + prettier over all 19 staged files)                                                                                                          | pass. The first attempt failed on 4 lint errors in test/CLI files outside the package lint glob; fixed and re-committed |
| 4   | `prettier --check` on all changed paths                                                                                                                                           | pass                                                                                                                    |
| 5   | `pnpm --filter @homeservicemarketplace/api build`                                                                                                                                 | exit 0                                                                                                                  |
| 6   | `npx jest src/infrastructure/outbox` (apps/api)                                                                                                                                   | **3 suites, 20/20 passed**                                                                                              |
| 7   | `node --test scripts/production/workers/outbox-replay.test.cjs`                                                                                                                   | **6/6 passed**                                                                                                          |
| 8   | Real PG (`r22_it`, pristine): `RUN_DB_INTEGRATION=1 RUN_R22_WORKER_PROCESS=1 npx jest --runInBand outbox.integration r22-outbox-reliability r22-outbox-replay r22-outbox-process` | **4 suites; 47 passed, 4 skipped, 0 failed**. The 4 skips are the CR-01 execute-path tests, by design                   |
| 9   | Repeat of #8 minus replay, three times (concurrency and timing changed)                                                                                                           | **43/43, 43/43, 43/43**                                                                                                 |
| 10  | Real PG with CR-01 applied (`R22_APPLY_CR01_IN_TEST=1`, `r22_outbox`): `r22-outbox-replay`                                                                                        | **7 passed, 1 skipped**. The skip is the fail-closed test, which only applies without the enum and passed in #8         |
| 11  | CLI smoke, real PG: `outbox-health.cjs`                                                                                                                                           | exit 0; JSON snapshot; app↔DB clock skew measured −76 ms                                                                |
| 12  | CLI smoke, real PG: `outbox-replay.cjs` with an unknown operator                                                                                                                  | exit 2 `unauthorized`. `--execute` without `--confirm-count`: exit 64                                                   |
| 13  | Tracked-tree secret scan, gitleaks 8.24.3. The Windows build was verified via the release checksums file, whose Linux entry equals CI's pinned SHA-256                            | commit `1b43641`: 2,232 files, **no leaks**                                                                             |

The reliability suite's first iteration exposed a real defect: an `int`
versus `bigint` binding in `make_interval(days => …)` in the replay service.
It was fixed before the commit, and all results above are from the fixed code.

Between #8/#9 and the commit, only lint-level edits were made: an eslint
directive comment and one variable initializer in the CLI. Neither changes
behaviour; #7 was re-run after them.

## 3. Regression of the rest of the gated API suite

**Status: NOT ESTABLISHED locally — host resource exhaustion. Hosted CI is
the regression gate.**

Three attempts on this host. The host was shared with four other lanes'
installs, builds and stacks; 12 cores and 15.8 GB RAM, 0.5 GB free at the end.

| Attempt | Configuration                                                                                                                                        | Outcome                                                                                                                                                                                                                                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A       | Full `pnpm --filter @homeservicemarketplace/api test`, default parallelism, CI env (`RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1`), fresh seeded DB | Stopped by me after ~25 min: an outbox-worker edit (`hasClaimed`) landed mid-run, which invalidated it. 9 suites had finished, all failing on `db-isolation` advisory-lock acquisition timeouts (120 s). Waits were blocked on `mediaAssets`, `marketRegistry` and `providerLifecycle`, never on `outbox`/`seed` |
| B       | Same, on the final code, fresh DB and Redis                                                                                                          | Stopped by me after ~35 min with only 10 suites finished. All failed in `beforeAll` lock acquisition (blocked on `mediaAssets` 105, `outbox`(shared) 127, `providerLifecycle` 42). At that rate the run would have taken hours                                                                                   |
| C       | Serial (`--runInBand`) run of the 37 suites that touch the outbox or failed in B, fresh seeded DB                                                    | **Killed by Claude Code for low system memory** before jest printed totals. 6 suites reported FAIL: admin-provider-review, phase3-journey-b, phase3-journey-c, provider-journey, provider-portfolio, r17-provider-surfaces. The pass count is unavailable because the run ended before the summary               |

**Failure signature in C:** 83 × `expected 200, got 500` and 23 ×
`Transaction already closed … timeout for this transaction was 5000 ms`. The
first expired transaction was raised at
`provider-onboarding-wizard.service.ts:1120` (6,015 ms elapsed). These are
**domain** transactions under Prisma's default 5 s timeout. They are not the
outbox delivery transaction and did not pass through `OutboxWorker`.

**Interpretation, not proof:** this is consistent with host starvation
rather than an R22 regression. It is not established. A same-host baseline
comparison (base `059c018` outbox files on the same suites) was planned but
not run, because the host had no memory headroom. Treat the regression of the
broader gated suite as **UNVERIFIED** until hosted CI on the PR head is green.

The outbox-specific suites (§2 #8–#10) were unaffected. They ran on the same
host before the memory pressure and passed repeatedly.

Contention note: R22's three suites hold the exclusive `outbox` advisory lock
for about 30 s combined when unloaded, the same pattern as the Sprint 6
suite. Under heavy parallel load this adds to queueing for suites that take
`outbox` shared (RISKS R10).

## 4. Requirement → evidence matrix

| Requirement (prompt)                                                                             | Evidence                                                                                                                                                                                                                                                                                   | State                                                        |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| 1 Inventory workers and activation controls; `DISPUTE_WORKER_MODE`, not `DISPUTE_WORKER_ENABLED` | `infra/production/workers/OUTBOX_PLAYBOOKS.md` §1; CR-02 removes the inert key                                                                                                                                                                                                             | DONE (doc); key removal INTEGRATION_PENDING                  |
| 2 Post-commit publication                                                                        | tests _invisible until commit_, _rolled-back transaction emits nothing_; audit of 8 publish sites (IMPLEMENTATION §5) found no premature publication                                                                                                                                       | SOURCE_VERIFIED                                              |
| 3 Claim/lease/heartbeat/retry; no permanent loss, no indefinite stale owner                      | tests _stale owner cannot overwrite_, _reclaimed event delivered once_, _stale owner cannot record a failure_, _DB-clock reclaim_, _heartbeat renews only own_, _heartbeat keeps batch_; process suite _killed mid-dispatch_                                                               | SOURCE_VERIFIED                                              |
| 4 Backoff+jitter, DLQ, finite budget, typed errors, safe authorized replay                       | unit `outbox.retry.spec`, `outbox.errors.spec`, `outbox-replay.service.spec`; real-PG _permanent → DEAD_, _retry-after hint_, _ceiling_, _poison does not starve_, _unknown type_; replay suite (authz, dry-run, DEAD-only, fail-closed, audit, markers respected, rate limit, concurrent) | SOURCE_VERIFIED; execution INTEGRATION_PENDING (CR-01/03)    |
| 5 Graceful shutdown                                                                              | in-process _finishes in-flight, releases rest, stops claiming_, _bounds hung delivery_; process suite _graceful shutdown hands batch back_ (IPC on Windows; SIGTERM path on Linux via CR-04)                                                                                               | SOURCE_VERIFIED (Windows); Linux SIGTERM INTEGRATION_PENDING |
| 6 Handler registration contract; R23 metrics                                                     | `HANDLER_REGISTRATION_CONTRACT.md`; boot-time registry validation test; `outcome="lease-lost"`; CR-05                                                                                                                                                                                      | DONE; new series INTEGRATION_PENDING                         |
| 7 Failure-injection and playbooks                                                                | `OUTBOX_PLAYBOOKS.md` §3 (duplicate delivery, clock skew, long handler, DB down, Redis down, unknown handler, scanner down, retention hold, replay, deploys); alert rules; process suite = kill injection; in-process deadline/stale-lease injection                                       | DONE                                                         |
| Two independent processes, real PG, termination around claim/dispatch/ack                        | `r22-outbox-process.integration.spec.ts` (3/3 ×4 runs)                                                                                                                                                                                                                                     | SOURCE_VERIFIED                                              |
| Real Redis                                                                                       | The outbox path has no Redis dependency (verified by reading); Redis was used only by the regression suites in §3                                                                                                                                                                          | NOT APPLICABLE to the outbox core                            |
| Evidence-scan and privacy/retention tests stay active                                            | No scan or retention test was skipped or modified; nothing was marked CLEAN                                                                                                                                                                                                                | preserved                                                    |
| Browser / RTL / mobile                                                                           | No UI change                                                                                                                                                                                                                                                                               | NOT APPLICABLE                                               |
| Hosted CI / CodeQL on final SHA                                                                  | PR Draft; see PR body                                                                                                                                                                                                                                                                      | PENDING                                                      |

## 5. Corrective execution, 2026-10-15 (separate from historical results)

Status at source publication: **IMPLEMENTED, SOURCE_VERIFIED (local unit,
lint, typecheck, build), INTEGRATION_PENDING, EXTERNAL_BLOCKED (local real
services)**. This is not SANDBOX_ACCEPTED, HOSTED_ACCEPTED or RELEASE_ACCEPTED.
The final-head CI record belongs in the corrective Draft PR, together with
run/artifact IDs and final SHA; that avoids a self-referential evidence commit
and never substitutes an earlier head's checks for the final head.

| Identity                     | Value                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen G0                    | `059c018576a75837d4dfb262ee49168d9217d881` (existing owner approval, IMPLEMENTATION §1)                                                        |
| Original branch head         | `79617ff051efa69e49a4c7b8f4c446e9b04f3510`                                                                                                     |
| Original PR                  | #158, merged as `3e9fd3ad106639aa87780af8d3927d1d391cb355`; not merged by this execution                                                       |
| Correction source commit     | `eec7488c9d2ee506f3b430895d081973a1a74d21`                                                                                                     |
| Correction source tree       | `6f4a5fe854318357a0fcc9b0caaa2e72f44f8dbb`                                                                                                     |
| Final evidence commit / tree | recorded in the corrective PR's Final SHA / source-tree fields after commit                                                                    |
| Comparison develop           | `af662586a640e41d8438d0cb2dd69e8cbb0e172a`                                                                                                     |
| Branch                       | `feat/r22-worker-outbox-reliability`; independent clean clone before edits                                                                     |
| Changed paths and leases     | exact ten paths in OWNERSHIP.md; no shared lease                                                                                               |
| Contract / schema            | existing published workspace contracts and Prisma 6.12.0 unchanged; clarified best-effort callback semantics; no signature change or migration |

### Local commands and outcomes

Commands run from repository root unless a working directory is shown. Each
exit code was checked; no hook, test gate, timeout budget or assertion was
weakened. The expected red run preceded the runtime fix.

| Command                                                                                                                                                                                                                                                                    | Result                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                                                                                                                                                           | exit 0; lockfile unchanged                                                                                 |
| `pnpm --filter @homeservicemarketplace/database generate`                                                                                                                                                                                                                  | exit 0; Prisma 6.12.0                                                                                      |
| `pnpm exec jest --runInBand src/infrastructure/outbox/outbox.worker.spec.ts` (apps/api, before fix)                                                                                                                                                                        | exit 1; 4 failed, 2 passed, 0 skipped; reproduced callback stalls                                          |
| `pnpm exec jest --runInBand src/infrastructure/outbox` (apps/api, after fix)                                                                                                                                                                                               | exit 0; 4 suites, 26 passed, 0 failed, 0 skipped; includes all 6 new regressions                           |
| `node --test scripts/production/workers/outbox-replay.test.cjs`                                                                                                                                                                                                            | exit 0; 6 passed, 0 failed, 0 skipped                                                                      |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                                                                                                                                                                                                      | exit 0                                                                                                     |
| `pnpm --filter @homeservicemarketplace/api lint`                                                                                                                                                                                                                           | exit 0                                                                                                     |
| `pnpm exec eslint apps/api/src/infrastructure/outbox/outbox.worker.ts apps/api/src/infrastructure/outbox/outbox.worker.spec.ts apps/api/src/infrastructure/outbox/outbox.handler.ts apps/api/test/integration/r22-outbox-reliability.integration.spec.ts --max-warnings 0` | exit 0                                                                                                     |
| `pnpm --filter @homeservicemarketplace/api build`                                                                                                                                                                                                                          | exit 0; baseline and corrected source both built                                                           |
| `pnpm exec prettier --check apps/api/src/infrastructure/outbox/outbox.worker.ts apps/api/src/infrastructure/outbox/outbox.worker.spec.ts apps/api/src/infrastructure/outbox/outbox.handler.ts apps/api/test/integration/r22-outbox-reliability.integration.spec.ts`        | exit 0                                                                                                     |
| `pnpm security:audit`                                                                                                                                                                                                                                                      | exit 0; 0 info/low/moderate/high/critical findings                                                         |
| `pnpm security:audit:prod`                                                                                                                                                                                                                                                 | exit 0; 0 info/low/moderate/high/critical findings                                                         |
| `git diff --check`                                                                                                                                                                                                                                                         | exit 0                                                                                                     |
| `git merge-tree --write-tree origin/develop HEAD` (source commit)                                                                                                                                                                                                          | exit 0; conflict-free candidate tree `7e335b7c1d8bb909729ef4f45f824c29c0ac3075`; no branch update or merge |
| Normal pre-commit hook                                                                                                                                                                                                                                                     | exit 0; scoped ESLint and Prettier; no bypass                                                              |

### Environment fingerprint and missing evidence

- Linux 6.18.44 x86_64; task-scoped Node **24.21.0**, pnpm **10.32.1**.
  No machine-wide version change; this worktree owns its node_modules and
  generated output. Lockfile SHA-256:
  `724b826ea09da6e070f4721a30f5dd9145a333606fac124e0249b5ef7fe18222`.
- No user `.env`, database, Redis instance, external bucket or session was
  copied or reused. No services, containers, volumes or other processes were
  reset, flushed or terminated.
- Local PostgreSQL/Redis/Docker executables were unavailable. A task-local
  package-index attempt exited 100 because the execution environment denied
  `setgroups`/`seteuid`; no sandbox protection was bypassed. Therefore the
  two new real-Postgres regressions and independent process suite were **not
  run locally**. Unit contract doubles establish scheduling only, not durable
  atomicity. Owner: CI/integration coordinator for isolated service evidence.
- Existing CI enables PostgreSQL/Redis API integration, including the new
  real-Postgres cases. It still does not set `RUN_R22_WORKER_PROCESS=1`:
  Linux two-process SIGTERM evidence remains blocked on CR-04. Audit replay
  execution cases remain conditionally gated by CR-01; no tests were newly
  skipped to get green. Preserve scanner and retention tests at the gate.
- Local secret/container scanning and final-head CodeQL are supplied by
  hosted CI, not claimed from the dependency audit. No UI changed: real-route
  screenshots, AR/EN/RTL/mobile/keyboard checks are not applicable to this
  infrastructure-only correction; none were fabricated or inspected locally.
- Existing ts-jest `isolatedModules` deprecation and the frozen-install
  optional build-script warnings did not fail the checks. Pins and lockfile
  were not changed to suppress them.

CR-01…CR-05 remain serial coordinator integration requests. R16/R18 policy
decisions and live-rail authorization remain unchanged. The corrective PR
must remain Draft while required integration evidence or acceptance is
missing; only the coordinator can accept the wave and the owner authorize
merge/deployment. No deployment or live activation was attempted.
