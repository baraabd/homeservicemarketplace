# R25 acceptance record

## Integration correction for PR #175 — 2026-10-17

The owner-requested follow-up has applied the five CR-001 shared-test/CI changes. The dedicated **R25 real replicas and recovery** job is now required by both aggregate gates, with exact-head checkout, disposable services, authenticated TCP readiness, positive test counts and fixed-schema evidence. The changed shared fixtures preserve the original domain, credential and browser assertions. See [CR-001](shared-change-requests/CR-001-integration.md) for the applied scope and observed local checks.

**Final combined-source verification is pending in this source record.** The PR body records the actual final commit, exact-source runner result and final GitHub checks after they execute. Earlier source identities and failed aggregate results below remain historical evidence and are not relabeled as results for this correction. Hosted operation and production activation remain separate acceptance steps.

## Prior lane acceptance record

## Current classification

The R25 implementation and its isolated real-service acceptance have executed successfully. Attempt `20261017083556600-f1ac8be4` is **SANDBOX_ACCEPTED** on the clean source identified below. The broad API run remains failed, and shared integration, final-PR CI/CodeQL, hosted operation and release acceptance are separate gates. The PR remains Draft while CR-001 or required remote evidence is outstanding.

| Layer                  | Current result      | Meaning                                                                                                   |
| ---------------------- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| G1/start authority     | Accepted            | Owner-merged #171/#172 establish the frozen Wave 2 source and R25 readiness                               |
| Implementation         | IMPLEMENTED         | Socket, SSE and browser recovery changes within the exact R25 ownership                                   |
| Owned source checks    | SOURCE_VERIFIED     | Focused units, lint, types, builds and security checks below; not a passing full API suite                |
| Isolated real services | SANDBOX_ACCEPTED    | 13 real API cases and one browser journey using two actual API processes; zero R25 failures/skips/retries |
| Shared CI integration  | INTEGRATION_PENDING | Coordinator applies the exact CR-001 patches and runs the combined source                                 |
| Hosted/production      | Not run             | No owner rollout or live flag activation occurred                                                         |

## Source identity

- Execution base: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.
- Base tree: `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
- Branch: `feat/r25-realtime-multi-instance`.
- Approved record overlay inspected at `07c8e584c684111bfc80995c7efb0144cfb6161b`; later than the execution base and not copied into it.
- Accepted local candidate: `797a426c18a2b8fa6d6b2ed20afdb88d098ed12f`, tree `280b44f4fa3b336d088078cbeb1f8256da1d4a31`.
- Acceptance head/tree, compiled API directory SHA-256 and configuration fingerprint: produced by the committed-candidate runner. The PR records the final publication head separately to avoid a self-referential commit identifier inside its own tree.

The acceptance documentation is updated after that run. A publication run must report its actual clean publication head and tree separately; identical runtime code does not make two commit identifiers interchangeable. The final PR body and sanitized evidence bundle are the publication-bound record.

## Environment and isolation

Pinned Node 24.21.0, pnpm 10.32.1 and Prisma 6.12.0. Services are dedicated loopback PostgreSQL 16.15 (54325), authenticated Redis 7.0.15 (56325) and Mailpit 1.31.6 (SMTP 51025 / HTTP 58025). The native process topology is used because Docker is unavailable here. Compose is prepared configuration, not executed Compose evidence. Native binaries were verified against the signed distribution/release metadata before use.

The database name and user are specific to R25. PostgreSQL migrations and reference seeding succeeded. No shared database reset, shared Redis flush, user environment copy, global package-manager change or weakened throttle was used. API A/B used 4325/4425 and web A/B used 5325/5425. Credentials and synthetic mail/session output stay in private local diagnostics. Browser contexts isolate seeker, provider and admin sessions; ports alone do not isolate browser cookies.

The runner refuses non-loopback/default/shared service destinations, hardened runtime aliases, occupied replica ports, dirty/changed source identities and loadable `.env` files. It gives its children only explicitly selected settings and new per-run signing/encryption secrets. Each attempt has a new evidence directory. POSIX process groups and signal handlers stop only owned commands and descendants.

## Executed checks before the candidate run

| Command/check                                                      | Observed result                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                   | Exit 0; lockfile unchanged; normal prepare/Husky lifecycle executed |
| `pnpm --filter @homeservicemarketplace/database generate`          | Exit 0; Prisma 6.12.0 client and native engine smoke checked        |
| `pnpm --filter @homeservicemarketplace/api build:deps`             | Exit 0                                                              |
| Existing migration history + seed on disposable database           | Exit 0 for both                                                     |
| Focused API realtime unit suites                                   | 4 suites / 129 tests passed; 0 failed/skipped                       |
| Enabled R25 PostgreSQL/Redis integration spec                      | 13 passed, 0 failed/skipped; 10.24 seconds                          |
| API TypeScript check                                               | Exit 0                                                              |
| `node --test scripts/production/realtime/verify-replicas.test.cjs` | 29 passed, 0 failed, 0 skipped                                      |
| `pnpm security:audit --output <private-report>`                    | Exit 0; info/low/moderate/high/critical all 0                       |
| `pnpm security:audit:prod --output <private-report>`               | Exit 0; info/low/moderate/high/critical all 0                       |
| `pnpm security:audit:test`                                         | 39 passed, 0 failed/skipped                                         |
| `node --test scripts/security/secret-scan-tree.test.cjs`           | 7 passed, 0 failed/skipped                                          |
| Focused web realtime/auth tests                                    | Final 138 passed across 7 realtime test files                       |
| Full web unit suite                                                | Final 204 files / 2,499 tests passed (48.15 seconds)                |
| Web application / E2E type checking                                | Exit 0 on final frontend source                                     |

These counts refer to the actual commands, not an invented single aggregate run. The acceptance runner rejects zero-test, skipped, failed or flaky reports.

## Evidence contract

The real API suite uses independent Nest instances with actual PostgreSQL, Redis, JWT/session and authorization services in one test process. It is not credited as two operating-system API processes. The real browser suite supplies that additional proof: both children execute the same built `apps/api/dist` on separate ports, browsers exercise real routes, and the test restarts only its own API A.

Required browser evidence includes actual B-to-A messages before and after restart, same-ID replay with one visible row, REST gap recovery without page reload, durable history/read positions, one visible alert across tabs, AR/EN layout and keyboard checks, real provider suspension and logout. API evidence includes polling and WebSocket transports, current session/role/capability authority, private-room denial, atomic per-user connection admission, adapter subscriber loss and a declared bounded workload.

The declared workload is a bounded local observation, not a production capacity or saturation certification. Queue-overflow and stalled-dependency tests are identified separately. A socket-only fault proves continued REST polling; a total Redis failure can correctly fail closed in the required REST rate limiter. Do not equate these scenarios.

## Declared real-service workload before the candidate run

The focused R25 run observed 24 connections, 120 durable notification rows and 240 received packets, with no foreign recipient delivery. Seventy samples over 318 ms observed 12 pending deliveries and 6,974 pending bytes on each replica; measured heap growth was 20,882,152 bytes. Limits remained 512 deliveries / 16 MiB aggregate and the declared workload's 64 MiB heap-growth assertion. These are measured values for the local workload, not hosted capacity promises.

A paused real SSE reader was hard-closed after 81 repeated frames of a persisted 57,344-byte body; authorization queue/byte counters returned to zero. Additional real cases establish idle Socket.IO/SSE expiry, original-JTI rotation, session-repository logout-all/password-reset revocation plus the actual security bus, membership removal and control barriers. Logout-all/password-reset coverage is the real repository/bus mechanism, not a claimed browser journey through those forms. Permission-only removal remains a unit boundary because the existing admin role grant is shared; no global seeded grant was mutated for an isolated test.

## Complete-suite environment attempts

The first complete API run on `118d7f875bbdf286e66eebbb2402ebab77c85417` reported 6,037 passed, 121 failed and 81 environment-gated pending tests (323 passing / 9 failing / 13 pending suites). This is **not** passing acceptance. Seven older real-service suites read `REDIS_URL` rather than the structured host/port settings and initially selected the unused default 6379 port. The private launcher was corrected to supply the same dedicated authenticated Redis URL, without touching shared test source or security limits. One health unit test assumes an unset source environment; the whole-suite launcher now leaves that test's source variable under its own control while recording the Git head separately. Five R12 contract-double failures require CR-001 rather than a permissive production branch.

The corrected-Redis full run on the same API source reported **6,151 passed, 7 failed and 81 pending** (329 passing / 3 failing / 13 pending suites), exit 1 in 297.376 seconds. The exact command was `pnpm --filter @homeservicemarketplace/api test --maxWorkers=2 --json --outputFile=<private>/api-full-results.json`; the wrapper retained both output streams in `api-full-tests.log` and Git identity in `api-full-summary.json`. It still inherited the source environment before that final launcher correction; do not call this a passing full-suite run.

Separate follow-ups, each with their own result:

- `env -u HSM_SOURCE_SHA -u SOURCE_SHA pnpm --filter @homeservicemarketplace/api exec jest src/infrastructure/health/health.service.spec.ts --runInBand --json --outputFile=<private>/api-health-results.json`: **12/12 passed**, exit 0, after restoring the test's expected environment.
- `pnpm --filter @homeservicemarketplace/api exec jest test/integration/r22-outbox-reliability.integration.spec.ts --runInBand --json --outputFile=<private>/r22-isolated-results.json`: **21/21 passed**, exit 0, 8.671 seconds, on `35424d915e10e6c3e8c221ac70010d9906d0e74b`, with the same disposable DB and no queue reset. The unchanged test's broad result was 20/21: `runOnce()` counted three older Notification aggregate events whose notification rows were already gone. Their recorded creation times, 08:05:48.157, 08:05:48.298 and 08:05:48.429 UTC on 2026-10-17, precede the R25 integration suite's recorded start at 08:05:50.291 UTC within that second full-suite attempt. Attribution to the R17 dispute fixture remains an inference because the Notification rows had already been deleted. This does not show visibility of the uncommitted R22 intent. CR-001 documents the pre-existing dispute-fixture cleanup omission and a namespace-limited patch. The isolated pass does not repair that leak or rewrite the broad result.
- Five R12 participant/standing cases still require the explicit original-credential, transport and identity doubles in CR-001. No assertion or production authorization check was weakened.

The **81 existing environment-gated cases** comprise 40 R20 S3 cases (`RUN_R20_STORAGE_INTEGRATION`), 29 retention cases (`RUN_RETENTION_INTEGRATION`), three R22 process cases (`RUN_R22_WORKER_PROCESS`), three dispute process cases (`RUN_DISPUTE_WORKER`) and six older browser cases (`RUN_PROVIDER_BROWSER`, `RUN_DISPUTE_BROWSER`, `RUN_ADMIN_BROWSER`). They were not counted as executed or passed. The enabled R25 suite has zero skips.

The initial failed reports are preserved as `api-full-results-initial-env.json`, `api-full-summary-initial-env.json` and `api-full-tests-initial-env.log`. Targeted reruns are never subtracted from a previous aggregate to invent a green full-suite result.

## First independent-process candidate attempt

Attempt `20261017081920258-be43b4cf` ran on clean head `346b6311b850582dd8435c8f22639881244492f1`, tree `dd4bed67e6fcb6d29d49e2560ac6ec1466f4763e`. Migrations, database build/seed, API integration **13/13**, API build, web typecheck and both production-mode web builds exited 0. Both real API processes reported that source SHA and healthy PostgreSQL/Redis dependencies. The browser case failed at the first booking-card action after the application's bootstrap error screen appeared; this attempt is **INTEGRATION_PENDING**, not browser acceptance. Both owned process groups were stopped. Its private JSON, failure screenshots and summary are retained.

A bounded follow-up identified `net::ERR_CERT_AUTHORITY_INVALID` for the Google Fonts stylesheet, causing the existing bootstrap CSS preload to fail. No local asset or API failure was implicated. The accepted visual suites already retain the exact Cairo/Inter CSS and WOFF2 assets under a source-controlled manifest. R25 reuses that unchanged static-font fixture and verifies both families instead of disabling TLS validation. Application HTTP responses, cookies, sessions, business state and Socket.IO delivery remain real. This is explicitly local font-controlled evidence, not an assertion that the external font CDN or hosted TLS deployment was verified.

## Accepted independent-process candidate attempt

Attempt **`20261017083556600-f1ac8be4`**, under `apps/web/test-results/r25-3h8q74q7/`, executed on clean head `797a426c18a2b8fa6d6b2ed20afdb88d098ed12f`, tree `280b44f4fa3b336d088078cbeb1f8256da1d4a31`. The source identity was unchanged at completion. All nine recorded commands exited 0 without a timeout or signal; owned process groups were stopped. Its `summary.json` reports **SANDBOX_ACCEPTED**.

| Evidence                              | Actual result                                                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R25 real PostgreSQL/Redis integration | 1 suite, 13 passed, 0 failed/pending/todo                                                                                                                              |
| Real browser journey                  | 1 passed, 0 failed/skipped/flaky, retry 0; 29.410769 seconds in the Playwright report                                                                                  |
| Full runner command duration          | 105.705 seconds summed over the nine command records; not the browser duration                                                                                         |
| Actual topology                       | 2 API OS processes, 2 web previews, 3 principal browser contexts and 2 same-origin seeker tabs                                                                         |
| Browser transport observations        | 17 cumulative namespace connections and 17 authorized connections across navigation/restart; 3 conversation acknowledgments                                            |
| Message observations                  | 2 actual cross-replica message frames and 2 same-ID repeated frames; 2 distinct live message IDs, plus 2 REST-recovered gap messages; 4 durable rows visible once each |
| Failure and state transitions         | Actual API A restart, socket-only partition/REST fallback, once-visible cross-tab alert, read-all convergence/reload, provider suspension and logout                   |
| Logout observation                    | Both seeker tabs clear private state and redirect; old REST authorization returns 401; 3,000 ms without a new socket attempt, acknowledgment or message                |
| Layout                                | EN/AR notification drawer at 320, 390, 430, 768, 1024 and 1440 px; RTL/no-horizontal-overflow assertions and keyboard close action                                     |
| Evidence controls                     | Static-font fixture only; application responses and Socket.IO remain real; traces/videos disabled; 16 inspected PNGs                                                   |

The provider/admin browser steps establish real persisted suspension, provider REST 403 and removal of the message composer after recovery/reload. They do not independently establish denial of a private provider socket frame; the real API suite supplies that authorization boundary. The 17 connection counters are cumulative, not simultaneous load.

| Build/configuration identity        | Files | SHA-256                                                            |
| ----------------------------------- | ----: | ------------------------------------------------------------------ |
| Compiled API directory              |   927 | `99a2eb0cdb2ecb1fcb37916140877d8ba8fa4adb9c22a58fc45541eabf2cd575` |
| Production-mode web A               |    83 | `8a97d4dce9afe79933f9752fde2c164f708555a812789976fdd1c76d9a6314e3` |
| Production-mode web B               |    83 | `1d82f76d13a834cd0bec194a9710717f7d4d7bd63f5ffe62f61f8adee2dcc0ee` |
| Sanitized configuration fingerprint |     — | `1e025d920f53227c6685b76b3e549aa9a769c421dab6d1350824de5f183b1045` |

This attempt's workload is **24 simultaneous connections / 120 durable notification rows / 240 received packets**, with no foreign recipient delivery. Seventy samples over **312 ms**, sampled every 5 ms, observed **12 pending deliveries / 6,974 bytes on each replica**. Heap growth was **28,959,072 bytes**, below the declared 64 MiB workload assertion. The paused SSE reader was hard-closed after 81 attempted frames with a 57,344-byte body; authorization queue and byte counters ended at zero. The earlier focused metrics above belong to their earlier run and are not substituted for these measurements. This bounded workload is not a soak or saturation test.

### Inspected screenshots

All 16 named PNG attachments from the accepted attempt were extracted, hashed and individually inspected. The following names are artifact IDs inside the sanitized evidence bundle; raw browser JSON, traces, credentials and mail/session diagnostics are not public artifacts.

| Scenario / width          | English PNG                        | Arabic PNG                      |
| ------------------------- | ---------------------------------- | ------------------------------- |
| Seeker messages, 390 px   | `r25-seeker-messages-en-390.png`   | Not captured                    |
| Provider messages, 390 px | `r25-provider-messages-en-390.png` | Not captured                    |
| Admin review              | `r25-admin-review-en-1440.png`     | `r25-admin-review-ar-390.png`   |
| Notifications, 320 px     | `r25-notifications-en-320.png`     | `r25-notifications-ar-320.png`  |
| Notifications, 390 px     | `r25-notifications-en-390.png`     | `r25-notifications-ar-390.png`  |
| Notifications, 430 px     | `r25-notifications-en-430.png`     | `r25-notifications-ar-430.png`  |
| Notifications, 768 px     | `r25-notifications-en-768.png`     | `r25-notifications-ar-768.png`  |
| Notifications, 1024 px    | `r25-notifications-en-1024.png`    | `r25-notifications-ar-1024.png` |
| Notifications, 1440 px    | `r25-notifications-en-1440.png`    | `r25-notifications-ar-1440.png` |

The captures show four durable messages once each, readable notification rows and visible close/settings controls, including at 320 px. Wide notification views retain the existing centered 430 px shell. Admin EN/AR captures show Application Suspended with Account Active; normal vertical scrolling is required for controls below the captured viewport.

Existing shared presentation limitations remain visible: Arabic interface chrome is localized and placed in RTL, but persisted notification titles/bodies remain English; the unchanged row chevron is not mirrored; the greeting emoji appears as a missing-glyph square in the captured font environment. The notification PNGs were taken after read-all and zero-unread assertions, so the hidden read-all control is expected and the images do not prove its visibility at every width or Arabic activation. These are visual inspections and bounded browser assertions, not pixel-baseline parity, contrast measurement or a screen-reader audit. No shared visual source was changed by R25.

### Exact command record

All commands ran from the assigned worktree with the pinned task-local Node/pnpm PATH. The private launcher calls the committed runner's `configuration()` and `verify()` functions after reading the dedicated credentials; the public equivalent is `node scripts/production/realtime/verify-replicas.cjs --run` with the documented R25 variables. No secrets are part of the command record. Below, `<attempt>` denotes the accepted attempt directory above and `<private>` the private diagnostic directory only; these placeholders replace paths, not command options.

```sh
pnpm --filter @homeservicemarketplace/api exec jest src/modules/realtime/realtime.gateway.spec.ts src/modules/realtime/conversation-participant.gate.spec.ts src/modules/realtime/realtime-events.publisher.spec.ts src/modules/realtime/realtime-socket.adapter.spec.ts --maxWorkers=2
pnpm --filter @homeservicemarketplace/api exec tsc --noEmit
pnpm --filter @homeservicemarketplace/web exec vitest run src/lib/realtime --reporter=dot
pnpm --filter @homeservicemarketplace/web exec vitest run --reporter=dot
pnpm --filter @homeservicemarketplace/web exec tsc -b
pnpm --filter @homeservicemarketplace/web exec tsc -p tsconfig.e2e.json --noEmit
```

The runner's nine executed command records are:

```sh
pnpm --filter @homeservicemarketplace/database migrate:deploy
pnpm --filter @homeservicemarketplace/database build
pnpm --filter @homeservicemarketplace/database seed
pnpm --filter @homeservicemarketplace/api test --runTestsByPath test/integration/r25-realtime-recovery.integration.spec.ts --json --outputFile=<attempt>/private/api-results.json
pnpm --filter @homeservicemarketplace/api build
pnpm --filter @homeservicemarketplace/web typecheck
pnpm --filter @homeservicemarketplace/web exec vite build --outDir <attempt>/web-A
pnpm --filter @homeservicemarketplace/web exec vite build --outDir <attempt>/web-B
pnpm --filter @homeservicemarketplace/web exec playwright test e2e/r25-realtime-recovery.real-api.spec.ts --project=chromium-desktop --retries=0 --reporter=json --output=<attempt>/private/browser-output
```

Scoped ESLint and Prettier completed with exit 0 on the 12 API and 9 web files. Normal commits ran the repository's Husky/lint-staged ESLint `--fix` and Prettier lifecycle. The final frontend formatter command was `prettier --write` with unchanged output, not a separately claimed `--check`. `git diff --check` passed. Dependency audits covered 1,319 total and 553 production dependencies, with zero reported vulnerabilities at every severity. Gitleaks 8.24.3 scanned the earlier `118d7f8` candidate's complete 2,510-file tracked tree (21,129,915 bytes) and its two-commit history (277,829 bytes), with no leaks; final publication scans have their own identity and results in the PR evidence.

Private reproducibility artifacts include `api-full-results.json`, `api-full-summary.json`, `api-health-results.json`, `r22-isolated-results.json`, `web-final-unit.log`, audit reports, Gitleaks SARIF, the attempt's `summary.json`, both command output streams, `api-results.json` and browser JSON. The focused web 138/138 result is the executing agent's observed command result; no separate stdout file was retained. Some earlier precommit checks also lack a separately retained source identity and are marked as such in the verification manifest. The sanitized deliverable retains summaries, measured workload, source/build fingerprints, visual-review limits and the inspected synthetic screenshots, with file hashes.

## Published source and completed CI observation

Publication head `5496a887c88808db193718169137ae4f8ce29159`, tree `a99ee2fcf9a0a543e553b67d08a809beab619845`, was accepted by a fresh isolated run: **`20261017122942875-c1d90cb6`**, **13/13 API and 1/1 browser**, zero failures/skips/flaky/retries. All nine commands exited 0, the clean source was unchanged, and owned processes stopped. Browser report duration was 32.594696 seconds; recorded command durations totaled 112.068 seconds. The API and both web directory hashes and the sanitized configuration fingerprint match the accepted candidate above. All 16 publication-attempt PNGs were independently inspected again.

That run measured 24 connections / 120 durable rows / 240 packets, 71 samples over 328 ms, peaks of 12 deliveries / 6,974 bytes on each replica, and 15,171,016 bytes of heap growth. The SSE slow-reader result remained 81 attempted frames / 57,344-byte body / zero remaining authorization queue and bytes. The published tracked-tree scan covered 2,510 files / 21,153,003 reported bytes; the one-commit published-range scan covered 300,851 bytes, both without leaks. These measurements belong to that source, not to an invented aggregate with prior runs.

The completed GitHub observation for [PR #175](https://github.com/baraabd/homeservicemarketplace/pull/175) and [CI run 39032705025, attempt 1](https://github.com/baraabd/homeservicemarketplace/actions/runs/39032705025) is **blocked**, not passing acceptance. Nine latest PR-event workflows completed: eight succeeded and the main CI workflow failed. There were 31 Actions jobs (26 succeeded / five failed), plus the separate successful official CodeQL result: **32 checks, 27 success / five failure / zero skipped or pending checks**. Skipped or unrun test cases and job steps are recorded separately below.

The published PR head is the workflow association. Main CI and CodeQL Actions actually checked out synthetic merge `cb866831cfb448ce60314ecd9d2b7886c82d4f27`, tree `486c0d13260f944e3dc18a28dfcf81acd848e7c3`, with parents develop `07c8e584c684111bfc80995c7efb0144cfb6161b` and the published head. Production governance checked out the literal published head. The separate official CodeQL check `117396785543`, app `github-advanced-security` / 57789, completed successfully on the exact head and PR with zero annotations; its scope is new alerts in changed PR code, not repository-wide zero vulnerabilities.

| Remote check                                       | Actual result and scope                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| API lint/typecheck/unit/build                      | Passed; 4,593 tests passed / 1,646 skipped, leaving service-dependent tests to their integration job        |
| Web lint/typecheck/unit/build                      | Passed; 204 files / 2,499 tests                                                                             |
| Enabled full API, job `117397172451`               | **6,153 passed / five failed / 81 skipped**, 331 passing / one failing / 13 skipped suites, 295.315 seconds |
| R25 / R22 within that API run                      | R25 **13/13** passed (15.88 s); R22 reliability **21/21** passed (8.622 s); R12 **35/40** passed            |
| Separate R22 worker-process step                   | **3/3** passed, 6.637 seconds; separate from the three process cases pending in the broad run               |
| Ordinary Browser E2E, job `117397172620`           | **836 passed / 349 skipped / three failed**, 1,188 registered, zero retries/flaky, 7.1 minutes              |
| Phase 5 real-route R17-B stage, job `117397977318` | **Two passed / one failed / two did not run**, five registered, zero retries/flaky, 38.6 seconds            |
| R18 acceptance and CI aggregate gates              | Both failed through prerequisite enforcement after the direct failures; no acceptance credit                |

All five enabled-API failures are in the unchanged R12 realtime-room contract-double cases. The fake lacks the original JTI, so `AUTH_INVALID_CREDENTIALS` occurs before participant authority is evaluated. CR-001 supplies the complete original-credential, managed-transport, room and identity double update. No R25 test failed, and the earlier R22 orphan-event ordering failure did not recur in this CI run; the independently identified cleanup omission remains unpatched.

The three ordinary-browser failures are the one R25 scenario under desktop/tablet/mobile, each stopped in `beforeAll` because `HSM_R25_REALTIME` is undefined instead of `isolated-ci`. Its body did not run. The command was `pnpm --filter @homeservicemarketplace/web test:e2e`. This confirms the shared discovery/dedicated-job requirement, not a failure of the isolated browser journey. Its six annotations represent three failed cases, not six.

The observed R17-B failure is **the Arabic toast expectation after reload**, not cookie Origin. The exact command was `pnpm --filter @homeservicemarketplace/web exec playwright test e2e/r17-notifications.real-api.spec.ts --project=chromium-desktop --workers=1 --retries=0 --output=test-results/r17-b-notifications`. Artifact `12101631628` retains a passing `r17b-drawer-ar-360.png` with the first Arabic aggregate hint; its 390 × 844 failure PNG has the same unread row but no second toast after a new `page.goto()`. The unchanged test creates one notification and expects its arrival toast again at every width. R25's first-login hint works; persisted baseline/presentation claims prevent replay on the second visit. CR-001 therefore also proposes independent real fixtures and browser contexts per viewport, preserving every Arabic, keyboard, unread, toast-visibility and geometry assertion. No shared test was changed or credited as passing by this lane.

The admin-bell and cookie-only Socket.IO cases were serially **unrun** after that R17 failure. The missing Origin remains a statically verified, unexecuted compatibility issue. The later PLATFORM-TX-1 acceptance step was skipped; its always-run upload then failed because the skipped step produced no files. That is consequential missing evidence, not an executed transaction-test failure. Later counter recomputation/assertion steps were also skipped. R17-B and generic real-API evidence uploads succeeded.

The source docs are followed by a documentation-only publication update to record this completed observation and the concrete R17 supplement. The final PR metadata and its own runner/check records identify that subsequent publication separately. Prior-head CI, screenshots and scans are retained with their original identity; they are never relabeled as final-head results.

## Honest failures and remaining work

The initial Node xz extraction produced a truncated executable despite a verified archive; the official gzip artifact was separately verified and used successfully. Playwright's CDN returned truncated Chrome archives; the identical Chrome 151.0.7922.34 headless-shell release was downloaded and checked from the official Chrome-for-Testing distribution, with the required FFmpeg build. Its initial partial extraction lacked ICU/runtime resources; a complete extraction verified all 287 archive/extracted entries and then passed a real launch/Arabic/RTL smoke test. These setup failures were retained separately and were never counted as application acceptance.

CR-001 covers five coordinator-owned files: R12 credential/transport/identity doubles; R17 browser Origin and independent Arabic viewport fixtures; R25 Playwright routing; the required R25 CI job; and namespace-limited dispute-fixture Notification outbox cleanup. None has been applied by this lane. No existing test was skipped or weakened to conceal the changes. Final publication-head CI, the separate official CodeQL check and publication secret scans are recorded in the PR evidence after execution. The missing dedicated R25 hosted CI job cannot be reported as passing. Only the coordinator can accept the integrated wave; hosted proxy/TLS/Redis evidence and owner rollout approval remain outstanding.
