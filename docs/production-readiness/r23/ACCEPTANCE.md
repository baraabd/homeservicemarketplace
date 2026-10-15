# R23 — acceptance evidence

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
