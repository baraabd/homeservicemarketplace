# R23 — exact write allowlist

Status: **PROPOSED, awaiting coordinator approval.** No coordinator wave
manifest or G0 acceptance record was available in this worktree or on
`origin` when work started (see `IMPLEMENTATION.md` § Baseline), so the
allowlist below was derived from the sprint prompt's ownership roots and the
real tree at `059c018576a75837d4dfb262ee49168d9217d881`. The coordinator may
narrow it; nothing outside it was written.

## Owned roots (from the sprint prompt)

| Root                                     | Exists at base | Use                                 |
| ---------------------------------------- | -------------- | ----------------------------------- |
| `apps/api/src/infrastructure/telemetry/` | yes            | extended                            |
| `apps/api/src/infrastructure/logger/`    | yes            | extended                            |
| `infra/production/observability/`        | no             | created                             |
| `scripts/production/observability/`      | no             | created (`scripts/production/` new) |
| `docs/production-readiness/r23/`         | no             | created                             |

## Exact files written

Modified (existed at base):

- `apps/api/src/infrastructure/logger/logger.module.ts`
- `apps/api/src/infrastructure/telemetry/metrics.module.ts`
- `apps/api/src/infrastructure/telemetry/metrics.service.ts`

Added:

- `apps/api/src/infrastructure/logger/pino-http-options.ts`
- `apps/api/src/infrastructure/logger/redaction.ts`, `redaction.spec.ts`,
  `logger.privacy.spec.ts`
- `apps/api/src/infrastructure/telemetry/trace-context.ts` (+ `.spec.ts`)
- `apps/api/src/infrastructure/telemetry/label-bounds.ts` (+ `.spec.ts`)
- `apps/api/src/infrastructure/telemetry/span-pipeline.ts` (+ `.spec.ts`)
- `apps/api/src/infrastructure/telemetry/telemetry.service.ts` (+ `.spec.ts`)
- `apps/api/src/infrastructure/telemetry/http-telemetry.middleware.ts`
- `apps/api/src/infrastructure/telemetry/domain-metrics.ts` (+ `.spec.ts`)
- `apps/api/src/infrastructure/telemetry/dependency-diagnostics.ts` (+ `.spec.ts`)
- `infra/production/observability/**` (rules, rule tests, Alertmanager test
  config, Prometheus test config, Compose test stack, dashboards, runbook)
- `scripts/production/observability/*.cjs`
- `docs/production-readiness/r23/**`

Tests live beside the owned modules (`*.spec.ts`) and in
`infra/production/observability/prometheus/tests/`. No test was added under
`apps/api/test/`.

## Flagged for coordinator review

`metrics.module.ts` now mounts `HttpTelemetryMiddleware` for all routes from
inside `MetricsModule`. The file is lane-owned and `AppModule` is untouched,
but the effect is global (every HTTP request is measured). This was chosen
because without it `http_requests_total` has no producer and every API SLO
alert is blind (see `IMPLEMENTATION.md` finding F-1). If the coordinator
prefers the mount in `AppModule`, CR-01 contains the alternative.

## Not written (coordinator-owned; change requests instead)

`apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `apps/api/src/config/**`,
`apps/api/src/infrastructure/http/**`, `apps/api/src/infrastructure/health/**`,
mail/storage/outbox/scanner modules, root manifests and lockfile, CI
workflows, Docker/Compose outside `infra/production/observability/`. See
`shared-change-requests/`.
