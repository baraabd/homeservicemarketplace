# R23 — observability, privacy-safe diagnostics and incident detection

Sprint: R23 (Wave 1, lane 5 of 5; legacy coverage P48). Branch:
`feat/r23-observability-incidents`. Delivery mode: A (integration and
reliability; no UI change).

## Baseline

| Item               | Value                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base SHA           | `059c018576a75837d4dfb262ee49168d9217d881` (`origin/develop` at start, 2026-10-13; equal to the planning observation)                                                            |
| Worktree           | `C:/Users/mohab/Documents/GitHub/HSM-r23` (new, isolated; own `node_modules`, `dist`, generated Prisma client)                                                                   |
| Toolchain          | Node 24.21.0, pnpm 10.32.1 (repository pins; nothing changed machine-wide)                                                                                                       |
| Install            | `pnpm install --frozen-lockfile`: exit 0, 20 m 33 s (four concurrent installs on the host)                                                                                       |
| Coordinator inputs | **None found**: no wave manifest, no G0 acceptance record, no approved allowlist on disk or `origin`. Recorded as R23-G0 in RISKS.md. The allowlist is proposed in ALLOWLIST.md. |

Final SHAs are recorded in ACCEPTANCE.md.

## Findings that shaped the work

| ID  | Finding                                                                                                                                                                                                                                                                  | Evidence                                                                                  | Resolution                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| F-1 | `http_requests_total` and `http_request_duration_seconds` were declared and exposed on `/metrics` since Sprint 1, but **no code ever incremented them**. Any API availability or latency alert would have evaluated an empty series and stayed silent through an outage. | `grep -rn httpRequestsTotal apps/api/src` at base: only the declaration and its unit test | `HttpTelemetryMiddleware` (route pattern, bounded labels, 499 for aborts), mounted by `MetricsModule`             |
| F-2 | pino-http's `genReqId` took the raw `x-request-id` header **unvalidated**; `RequestIdMiddleware` validated later, but the raw value had already become the log's `req.id`.                                                                                               | `logger.module.ts` at base                                                                | `generateRequestId` validates with the same rule; CR-01 aligns the middleware                                     |
| F-3 | Request logs used pino's default serializer: full URL with query string (`/reset?token=…`), all headers except a denylist, and the client IP.                                                                                                                            | `REDACT_PATHS` at base was a denylist of 18 paths                                         | Allowlisted `serializeRequest`/`serializeResponse`; query strings and IPs are never logged                        |
| F-4 | Error messages and causes (driver URLs with passwords, presigned URLs, JWTs in SDK errors) reached logs verbatim; the filter logged `err.message` as-is.                                                                                                                 | `all-exceptions.filter.ts`                                                                | Scrubbing `logMethod` hook over every log argument, including message strings and nested causes                   |
| F-5 | Smoke test found the raw `x-request-id` header still logged via the header allowlist; 404 routes labelled `/{*path}`; scrubbed errors typed `Object` by pino.                                                                                                            | live run of `synthetic-target.cjs`                                                        | Header removed from allowlist; Nest wildcard mapped to `unmatched`; class name preserved. Regression tests added. |
| F-6 | A metric label named `job` collides with Prometheus's target label and is renamed to `exported_job` at scrape time.                                                                                                                                                      | Prometheus relabelling rules                                                              | Labels are `job_name`                                                                                             |
| F-7 | Error-ratio rules returned **no data** (not 0) while no 5xx series existed.                                                                                                                                                                                              | promtool test 4 failed before the fix                                                     | Numerators use `or vector(0)`                                                                                     |

## What was built

### Privacy boundary (`apps/api/src/infrastructure/logger/`)

- `redaction.ts`: key classification (secret → `[REDACTED]`, personal →
  removed, content such as bodies/receipts/images → omitted, coordinates →
  two decimals); free-text rules (JWT, Bearer/Basic, URL userinfo, sensitive
  `key=value`, AWS signature/credential/token, PEM keys, emails, precise
  coordinate pairs); bounded depth, breadth, string length and cycles; never
  throws. Identifiers are removed, not hashed.
- `pino-http-options.ts`: the production pino-http options (validated request
  id, trace bindings, allowlisted serializers, scrubbing hook, job-trace
  mixin), free of the configuration module so tests boot exactly this
  configuration.
- `logger.module.ts`: unchanged behaviour otherwise (level from config,
  dev-only pretty transport).

### Telemetry (`apps/api/src/infrastructure/telemetry/`)

- `trace-context.ts`: W3C `traceparent` v00 parsing (strict; arrays,
  oversize, zero ids and unknown versions rejected), deterministic ratio
  sampling, inbound sampled flag ignored unless trusted, AsyncLocalStorage
  propagation.
- `telemetry.service.ts`: `recordHttp`, `runInstrumentedJob(jobName, fn)`,
  `callDependency(dependency, operation, fn)`. Every instrumentation failure is
  contained and counted; the business result or error passes through
  unchanged.
- `span-pipeline.ts`: queue cap (default 2048), batch size, hard export
  timeout with abort, failure back-off that drops instead of retrying,
  `onEnd` never throws; span attributes allowlisted by key and scrubbed; OTLP
  1.x HTTP/JSON exporter on the runtime's `fetch` (no SDK dependency); refuses
  endpoints with embedded credentials and never reads collector bodies.
- `label-bounds.ts`: enum labels, first-come cardinality limiter, route
  patterns only.
- `domain-metrics.ts` + `MetricsService.domainCounter/Gauge/Histogram`: the
  stable extension interface for R29–R34 (METRICS_CATALOG.md).
- `dependency-diagnostics.ts`: deep diagnostics (SMTP, storage, scanner,
  payment) with per-probe timeout; never part of liveness/readiness; wiring
  is CR-03.

### Observability assets (`infra/production/observability/`)

- `prometheus/rules/api-slo.rules.yml` (19 rules) and `platform.rules.yml`
  (10 rules), with `prometheus/tests/*.test.yml` promtool unit tests.
- `alertmanager/alertmanager.test.yml`: severity routing, grouping, inhibition,
  `send_resolved`, test webhook receivers only.
- `dashboards/hsm-api-overview.json`, `hsm-platform-slo.json` (Grafana).
- `RUNBOOK.md`: one section per alert (owner, first checks, escalation,
  recovery).
- `compose.alert-test.yml` + `prometheus/prometheus.test.yml`: disposable local
  stack for the synthetic test.

### Scripts (`scripts/production/observability/`)

- `synthetic-target.cjs`: the compiled API telemetry (real `MetricsModule`,
  middleware, exception filter, pino options) with an injectable failing route.
- `test-receiver.cjs`: local webhook receiver that records notifications.
- `alert-quality.cjs`: quality gate over the rules Prometheus loaded.
- `run-synthetic-alert.cjs`: end-to-end failure → alert → receiver → recovery.

## Wiring

`MetricsModule` mounts `HttpTelemetryMiddleware` for all routes; nothing in
`AppModule`, `main.ts`, configuration, health routes, CI or Compose outside
the observability directory changed. Everything else that needs global glue is
a change request: CR-01 (request-id agreement, path-only error logs), CR-02
(trace export configuration), CR-03 (diagnostics scheduling), CR-04 (boundary
adoption by other lanes), CR-05 (CI job, hosted scrape, receivers).

## Contracts, schema, flags

No Prisma schema, migration, shared contract, environment key or feature flag
changed. The `/metrics` exposition gains series; `/health/live` and
`/health/ready` are unchanged (R18 `sourceSha` provenance preserved).
