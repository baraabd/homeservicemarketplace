# R23 — acceptance evidence

## Corrective verification (2026-10-15)

Scope: CR-01 request correlation and exception-path privacy, plus evidence
reconciliation. Authorization and exact changed-path boundaries are in
`ALLOWLIST.md`. No G1, hosted or release acceptance is inferred.

- Original frozen base: `059c018576a75837d4dfb262ee49168d9217d881`.
- Corrective execution base: `af662586a640e41d8438d0cb2dd69e8cbb0e172a`.
- Base tree: `2d951c7a2c8c6788c0ed6f03db35ea6e6f9071c9`.
- Branch: `feat/r23-observability-incidents`; isolated checkout with its own
  dependencies, generated Prisma output, build output and test caches.
- Toolchain: task-local Node 24.21.0 and pnpm 10.32.1; no global changes.
- Environment: Linux; no `.env` copied or created; dummy validation values
  only, database endpoint `127.0.0.1:1` (unreachable); DB integration disabled
  locally. Real HTTP tests use an ephemeral loopback port and synthetic data.
- No Docker, Postgres, Redis or gitleaks executable was initially installed.
  Hosted runtime acceptance is separate from disposable GitHub CI services.

Corrective local status: **IMPLEMENTED, SOURCE_VERIFIED**. Final corrective
PR CI is required before integration; the broader R23 handoffs remain
INTEGRATION_PENDING, EXTERNAL_BLOCKED and POLICY_BLOCKED. No SANDBOX_ACCEPTED,
HOSTED_ACCEPTED or RELEASE_ACCEPTED declaration is made here.

### Corrective commands and results

Locally validated corrective source commit:
`b0c52d6f0f0ab0362eccf6a5fa9b46a5a1b6048d`; source tree:
`12b5afb378b6c8083b89c3e9c60ec70b3be06f1e`. Its GitHub-published counterpart
is `12192d94b5d46a6f7136a6fa5bb064302ca29c09`, with the identical full tree.
The CLI could not authenticate a push, so publication used the authorized
GitHub connection after normal local commit hooks, checking exact tree
equality. Commit identities differ; tested file bytes do not. The follow-up
evidence commit changes only this document. The exact final PR-head SHA belongs in the PR
body, per `.github/pull_request_template.md`, avoiding a self-referential
commit. Final CI must target that final head.

Security verification of the source commit (exit 0):

- `node scripts/security/secret-scan-tree.cjs --gitleaks <task-local-gitleaks> --work-dir <isolated-scan-dir>`:
  gitleaks 8.24.3, 2,459 tracked files and 20,038,798 bytes scanned, zero
  findings. The archive matched the repository-pinned SHA-256
  `9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c`.
- `gitleaks git --redact --no-banner --log-opts='af662586a640e41d8438d0cb2dd69e8cbb0e172a..HEAD'`:
  one corrective commit scanned, zero findings. No baseline or scanner
  configuration was changed.
- Pre-commit hooks ran normally: lint-staged ESLint and Prettier passed for
  all 11 staged files; their temporary backup was cleaned up. No bypass.

All commands used the task-local pinned toolchain. API commands requiring
configuration received only dummy database/JWT validation inputs; no live
connection or real credential was supplied. The API test command retains
the existing environment-gated suites; no skip was added by this change.

| Command                                                                                                                                                                                                                                                     | Exit | Observed result                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                                                                                                                                                            | 0    | Independent dependencies installed; lockfile unchanged; runtime guard passed                        |
| `pnpm --filter @homeservicemarketplace/database generate`                                                                                                                                                                                                   | 0    | Prisma 6.12.0 generated locally; native engine loaded; no database connection                       |
| `pnpm --filter @homeservicemarketplace/api exec jest src/infrastructure/http/request-id.middleware.spec.ts src/infrastructure/http/all-exceptions.filter.spec.ts src/infrastructure/logger/logger.privacy.spec.ts --maxWorkers=50%` (before implementation) | 1    | 16 regression failures / 122 passed, 3 suites failed; reproduced correlation and query privacy gaps |
| `pnpm --filter @homeservicemarketplace/api test --maxWorkers=50% src/infrastructure/http src/infrastructure/logger src/infrastructure/telemetry test/e2e/request-id.e2e.spec.ts`                                                                            | 0    | 289 tests / 16 suites passed, zero skipped                                                          |
| `pnpm --filter @homeservicemarketplace/api exec jest src/infrastructure/http src/infrastructure/logger src/infrastructure/telemetry test/e2e/request-id.e2e.spec.ts --maxWorkers=50%`                                                                       | 0    | Independent repeat: 289 tests / 16 suites passed                                                    |
| Same focused `exec jest` selection with `--detectOpenHandles`                                                                                                                                                                                               | 0    | 289 passed; identifies unchanged 5-second slow-exporter test timer (RISKS.md)                       |
| `pnpm --filter @homeservicemarketplace/api lint`                                                                                                                                                                                                            | 0    | API source/spec lint passed                                                                         |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                                                                                                                                                                                       | 0    | Source and test types passed after fixing the new supertest header overload                         |
| `pnpm --filter @homeservicemarketplace/api test --maxWorkers=50%`                                                                                                                                                                                           | 0    | 4,478 passed / 1,630 skipped; 249 suites passed / 88 skipped; no failures                           |
| `pnpm --filter @homeservicemarketplace/api build`                                                                                                                                                                                                           | 0    | Dependency builds and production Nest build passed                                                  |
| `node --test scripts/production/observability/test-receiver.test.cjs`                                                                                                                                                                                       | 0    | 3 passed / zero failed or skipped                                                                   |
| `pnpm exec prettier --write` on the exact 11-file allowlist; `git diff --check`                                                                                                                                                                             | 0    | Formatting applied; whitespace check passed                                                         |
| `git diff --exit-code -- pnpm-lock.yaml package.json`                                                                                                                                                                                                       | 0    | Root package and lockfile unchanged                                                                 |

The initial concurrency harness used supertest's automatic server lifecycle
and hit ECONNRESET; one explicit ephemeral loopback listener fixed the test
lifecycle before the reported 16-failure reproduction. An initial typecheck
also caught the new repeated-header call's overload mismatch; the supported
object-header overload corrected it. Neither failure was hidden or counted
as a pass. The existing slow-exporter timer warning remains documented.

Sanitized environment fingerprint SHA-256:
`4f6423ce854c0854e5cff9a6773f12abadc0d2eb136b76ad57f126b6fb14bda4`.
It hashes sorted-key compact JSON (no secrets):

```json
{
  "RUN_DB_INTEGRATION": false,
  "database": "unreachable-loopback:1",
  "envFile": false,
  "externalReceivers": false,
  "http": "ephemeral-loopback",
  "node": "24.21.0",
  "platform": "linux-x64",
  "pnpm": "10.32.1",
  "prisma": "6.12.0",
  "sampling": 1,
  "spanExporter": "in-memory-contract-double"
}
```

No new UI surface exists and no browser screenshot was captured or visually
accepted locally. Docker/Postgres/Redis/storage and real-route browser
acceptance are delegated to the existing final-PR CI, without claiming the
older successful runs validate the new source. No production resources were
contacted. Local security scans and the exact corrective commit identities
are recorded in the source-identity follow-up below and the PR.

### Verified historical evidence that supersedes the incomplete alert run

PR #163 was merged on 2026-10-14 as the corrective base above. Rechecked via
GitHub on 2026-10-15: 32/32 latest distinct named checks succeeded on
`66603ffb4521faf9b4c39bc21224dddd060a15dd` (source tree
`a7f0814d60fa91a32e5426130a06fd6b88c463f5`); 28/28 checks succeeded on the
merged base. Those results validate those exact commits, not this correction.

[Linux synthetic alert job](https://github.com/baraabd/homeservicemarketplace/actions/runs/38546338227/job/115793217945):
300 healthy requests, 16 alert definitions with zero quality problems,
27 dashboard queries with zero failures. Firing reached the test receiver at
2026-10-14T10:05:01.082Z and recovery at 2026-10-14T10:10:01.084Z;
`passed=true`. Artifact `11884698755` belongs to the exact R23 head and was
unexpired when checked (retention expires 2026-10-21).

The base real Postgres/Redis job (run `38549121757`, job `115806369405`)
passed 5,983 tests, skipped 88; 323 suites passed, 13 skipped. These are
existing CI results independently read, not newly executed local results.

### Historical initial evidence

Status: **IMPLEMENTED, SOURCE_VERIFIED (partial), INTEGRATION_PENDING.**
Not SANDBOX_ACCEPTED, not HOSTED_ACCEPTED, not RELEASE_ACCEPTED. Some parts
are EXTERNAL_BLOCKED or POLICY_BLOCKED (see RISKS.md). The end-to-end
synthetic alert path has **not** completed (§ 4).

## 1. Identity

| Item                     | Value                                                                                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base (G0)                | `059c018576a75837d4dfb262ee49168d9217d881`                                                                                                                                                                                  |
| Source commit            | `4c438f05f262cd05eef9746027e34dbefa58d6e6` (tree `7d20f3679952bbedddb08719d6e85219b259ba5a`)                                                                                                                                |
| Rules/dashboards/scripts | `578c955`                                                                                                                                                                                                                   |
| Docs                     | `2d317083bb880e6214274080602e77c3e6e8d159` (tree `5225708dbb030cf4485299b181989359dc3bac68`)                                                                                                                                |
| Verified source state    | every check in § 3 ran against `2d31708` or its parent commits, whose source files are identical                                                                                                                            |
| Final SHA                | the PR head that carries this file; it changes only `docs/production-readiness/r23/**`                                                                                                                                      |
| Alerting config version  | `0b5bf8d64d0bd5661105538866b4a72a5345c9ba4bf3296b7710f5dced182a03` (SHA-256 over the two rule files, Prometheus and Alertmanager test configs and the Compose file, as computed by `run-synthetic-alert.cjs`)               |
| Toolchain                | Node 24.21.0, pnpm 10.32.1, Docker 29.1.3 (Docker Desktop, Windows 11)                                                                                                                                                      |
| Images                   | `prom/prometheus:v3.5.0`, `prom/alertmanager:v0.28.1` (tags; not yet pinned by digest)                                                                                                                                      |
| Environment              | No `.env` in the worktree. Tests used dummy values: `DATABASE_URL` pointed at `127.0.0.1:1` (unreachable), `JWT_ACCESS_SECRET=ci_only_dummy_secret_at_least_32_chars_long` (the value CI uses). `RUN_DB_INTEGRATION` unset. |

Develop moved after G0 (R19, R20, R21 and R22 merged; `origin/develop` was
`ef3a48f` on 2026-10-14). This branch was **not** rebased; the coordinator
integrates it at the wave gate.

## 2. Commands and results (2026-10-14, worktree `HSM-r23`)

| #   | Command                                                                    | Exit | Result                                                                                              |
| --- | -------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------- |
| 1   | `pnpm --filter @homeservicemarketplace/api typecheck`                      | 0    |                                                                                                     |
| 2   | `pnpm --filter @homeservicemarketplace/api lint`                           | 0    |                                                                                                     |
| 3   | `npx eslint --no-warn-ignored scripts/production/observability/*.cjs`      | 0    | lint-staged lints these; `api lint` does not                                                        |
| 4   | `npx prettier --check` on every changed path (45 files)                    | 1→0  | only `IMPLEMENTATION.md` needed formatting; fixed by the pre-commit hook                            |
| 5   | `pnpm --filter @homeservicemarketplace/api build`                          | 0    | fresh `dist` for the synthetic target                                                               |
| 6   | `npx jest src/infrastructure/telemetry src/infrastructure/logger` (no env) | 1    | 178/178 tests pass; `logger.module.spec.ts` cannot load without env (identical at base)             |
| 7   | `npx jest --maxWorkers=50%` (all API specs, dummy env)                     | 1    | suites 235 passed, 1 failed, 79 skipped (315); tests 4291 passed, **1 failed**, 1516 skipped (5808) |
| 8   | `promtool check rules` on both rule files                                  | 0    | 19 + 10 = 29 rules                                                                                  |
| 9   | `promtool test rules api-slo.test.yml platform.test.yml`                   | 0    | both files SUCCESS; 19 `eval_time` assertions                                                       |
| 10  | `amtool check-config alertmanager.test.yml`                                | 0    | 3 inhibit rules, 2 receivers (both local test webhooks)                                             |
| 11  | load-overhead spec, three runs                                             | 0    | `recordHttp` 10.78, 3.24, 4.31 µs per call over 20 000 calls                                        |
| 12  | `node scripts/production/observability/run-synthetic-alert.cjs <scratch>`  | —    | **killed by the host** after the healthy phase; see § 4                                             |

The single failure in run 7 is `src/infrastructure/storage/restricted-erasure.spec.ts`
("does not flatten a directory or ENOTDIR storage error into absence"):
Windows reports `ENOENT`, not `ENOTDIR`, for a path through a regular file.
R23 changes no storage file (`git diff 059c018 -- apps/api/src/infrastructure/storage`
is empty) and the spec imports no telemetry or logger code. Linux CI is the
arbiter.

The 79 skipped suites are the database-gated integration suites
(`RUN_DB_INTEGRATION=1`). They were not run locally (host memory, see
`env_parallel_lanes_host_exhaustion`); hosted CI runs them on the PR.

## 3. Required scenarios and where they are proven

| Requirement                                                                                            | Evidence                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synthetic secrets in headers, payloads, causes, SDK errors absent from logs, spans, metrics, responses | `logger/logger.privacy.spec.ts`: a real Nest app with the production pino options, real `MetricsModule` and a span sink; each secret is checked against every stream |
| Free-text and key redaction rules                                                                      | `logger/redaction.spec.ts`                                                                                                                                           |
| Inbound correlation validation, bounded trace context                                                  | `telemetry/trace-context.spec.ts`                                                                                                                                    |
| Collector outage, unreachable collector, slow collector                                                | `telemetry/span-pipeline.spec.ts` against a real local HTTP collector                                                                                                |
| Queue and memory limits, exporter timeout and back-off                                                 | `telemetry/span-pipeline.spec.ts` ("SpanPipeline bounds")                                                                                                            |
| High-cardinality input                                                                                 | `telemetry.service.spec.ts`: 10 000 distinct routes produce at most 401 series; `label-bounds.spec.ts`                                                               |
| Metrics failure does not affect the operation                                                          | `telemetry.service.spec.ts`: a throwing metric, broken job instrumentation                                                                                           |
| Load overhead                                                                                          | § 2 row 11                                                                                                                                                           |
| False-positive recovery and noise control                                                              | `api-slo.test.yml`: a one-minute burst after two healthy hours does not page; alerts resolve after recovery                                                          |
| Liveness stays process-local                                                                           | `dependency-diagnostics.spec.ts`; `/health/live` and `/health/ready` unchanged                                                                                       |
| Alert reaches a test receiver, with sourceSha, config version, timestamps                              | **Not yet demonstrated** (§ 4)                                                                                                                                       |

## 4. Synthetic alert path — incomplete

Run on 2026-10-14 against `2d31708` (clean tree), Compose project
`hsm-r23-obs`, loopback ports 19090/19093/19095/19100:

| UTC          | Event                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| 06:00:45.176 | synthetic target and test receiver up                                                                           |
| 06:00:58.447 | Prometheus and Alertmanager up                                                                                  |
| 06:01:09.143 | scrape target `hsm-api` healthy                                                                                 |
| 06:01:09.208 | alert quality gate over the loaded rules: 16 alerts, 0 problems                                                 |
| 06:02:09.325 | healthy phase done: 288 OK, 0 failed, 0 transport errors                                                        |
| after        | runner killed by the Claude Code host's low-memory reaper (0.5 GB free of 15.8 GB, other lanes' stacks running) |

Failure injection, the delivery of `ApiAvailabilityFastBurn` to
`/alerts/page`, the resolved notification and the dashboard-query check did
**not** run. No result file exists. The stack was removed with
`docker compose -p hsm-r23-obs ... down -v`; nothing else was touched.

To complete: on a host with memory to spare, run
`node scripts/production/observability/run-synthetic-alert.cjs <dir>` from a
clean checkout of the PR head and attach `synthetic-alert-result.json`
(it records `sourceSha`, `configVersion`, image ids and the timeline). The
coordinator may instead run it in CI (CR-05).

## 5. Secret scan finding and fix

Hosted CI on `ba173e6` (run `38534564439`) failed both secret-scan steps on
three synthetic values in `logger.privacy.spec.ts` at `4c438f0`. They were
reproduced locally with gitleaks 8.24.3, classified as fixtures, and handled
by the repository's baseline procedure
(`docs/security/gitleaks-historical-baseline.md` § 11):

- the spec now builds the values at runtime;
- three exact fingerprints were appended to `.gitleaksignore`;
- the range scan now exits 0, and a runtime canary is still detected (exit 1).

These two files are outside the allowlist; see ALLOWLIST.md for the lease
request.

## 6. Not established

No hosted runtime or alerting evidence (PR CI is build and test evidence only). No production receiver. No approved objectives. Database-gated
suites not run locally. Integration with R19–R22, now on develop, has not been
tested. No claim of zero defects or production readiness.

## PR review repair verification (2026-10-14)

The earlier results above retain their original source identity. These
repairs are additive and do not turn the incomplete historical run into PASS:

- Untrusted inbound trace ids no longer determine the sampling decision.
  A server-generated span id supplies entropy; trusted parents and child
  spans retain their existing propagation behavior. Deterministic regression
  cases cover chosen low/high inbound ids.
- The synthetic target and receiver run inside the project Compose bridge.
  Prometheus and Alertmanager use service DNS on Linux and Docker Desktop;
  all published ports remain bound to host loopback. The target uses the
  existing production API runner image, built from this source checkout.
- The test receiver keeps a bounded, validated evidence projection in memory.
  It writes no network input to disk. The runner fetches its notifications
  and includes firing/recovery evidence in `synthetic-alert-result.json`.
- `.github/workflows/observability.yml` adds native Linux execution of the
  receiver regressions, promtool/amtool validation and the complete synthetic
  alert path. It is separate from hosted-production acceptance.
- Local Node 24.21.0 / pnpm 10.32.1: frozen install PASS; trace-context suite
  21/21 PASS; the complete logger/telemetry selection 182/182 PASS across
  11 suites; API typecheck and build PASS; changed-code ESLint PASS;
  receiver regression tests 3/3 PASS (valid firing/recovery,
  malformed/oversized requests, capacity bound). This workspace has no Docker
  daemon, so container execution is delegated to the final-head Linux CI job;
  its result must be checked rather than inferred from these unit tests.
