# R23 — exact write allowlist

## Ordered CI repair (2026-10-15)

The owner's current request explicitly asks to repair the R19, R22 and R23
PR failures, in that order. This follow-up addresses the three failed database
suites reported by R23's main CI, in addition to the original correction:

- `apps/api/test/support/isolated-database.ts` (new test-only lifecycle helper)
- `apps/api/test/integration/r18-admin-floor.integration.spec.ts`
- `apps/api/test/integration/r18-work-access-readiness.integration.spec.ts`
- `apps/api/test/e2e/password-reset.e2e.spec.ts`
- This allowlist and `ACCEPTANCE.md`.

The scope is database-test isolation. It grants no runtime policy, schema,
migration, CI-gate, production activation or release acceptance change.
R19 and R22 were first synchronized with already-merged develop on their
existing corrective branches; no unmerged peer source is imported here.

## Approved corrective follow-up (2026-10-15)

The repository owner approved the concrete 11-file corrective scope proposed
in PR #163 by replying "نعم" in the implementation session on 2026-10-15.
That approval authorizes this R23 correction and a successor PR because #163
is already merged. It does not retroactively approve the historical wave
records, accept G1, authorize CR-02–CR-05, or permit merge/deployment.

Resumed base: `develop@af662586a640e41d8438d0cb2dd69e8cbb0e172a`, tree
`2d951c7a2c8c6788c0ed6f03db35ea6e6f9071c9`. The isolated R23 worktree was
clean and the assigned branch was advanced to this already-merged base by
fast-forward only. No unmerged peer branch was imported.

Exact approved files (one writer: this R23 correction session):

| Path                                                                                     | Authority                                       |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `apps/api/src/infrastructure/http/request-id.middleware.ts`                              | Explicit shared-file corrective lease           |
| `apps/api/src/infrastructure/http/request-id.middleware.spec.ts`                         | Explicit shared-file corrective lease; new test |
| `apps/api/src/infrastructure/http/all-exceptions.filter.ts`                              | Explicit shared-file corrective lease           |
| `apps/api/src/infrastructure/http/all-exceptions.filter.spec.ts`                         | Explicit shared-file corrective lease           |
| `apps/api/src/infrastructure/logger/logger.privacy.spec.ts`                              | R23 lane                                        |
| `docs/production-readiness/r23/ALLOWLIST.md`                                             | R23 lane                                        |
| `docs/production-readiness/r23/IMPLEMENTATION.md`                                        | R23 lane                                        |
| `docs/production-readiness/r23/ACCEPTANCE.md`                                            | R23 lane                                        |
| `docs/production-readiness/r23/RISKS.md`                                                 | R23 lane                                        |
| `docs/production-readiness/r23/ROLLBACK.md`                                              | R23 lane                                        |
| `docs/production-readiness/r23/shared-change-requests/CR-01-request-id-and-error-log.md` | R23 lane                                        |

The lease lasts for this corrective PR only. Root manifests, lockfiles,
schema/migrations, CI, health wiring, export configuration and domain
instrumentation remain outside this approval. Historical status below is
retained as recorded and is not the authority for the corrective work.

## Historical initial implementation

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
- `scripts/production/observability/*.cjs` (including receiver regression tests)
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

## Written outside the owned roots — lease requested

Two coordinator-owned security files were appended to clear the blocking
secret scan that R23's own commit `4c438f0` triggered on PR #163:

- `.gitleaksignore`: three exact fingerprints, append-only.
- `docs/security/gitleaks-historical-baseline.md`: new § 11 review record.

No lease was recorded before the edit. It follows the established per-lane
procedure (R13, R19 and R21 did the same in their branches), and the
alternative (rewriting history) is forbidden. **The coordinator must confirm
this as a lease or reject it.** If rejected, revert the commit; the secret
scan then fails until the coordinator baselines the same fingerprints. Both
files are also appended on develop after G0 (R19, R21), so integration has an
end-of-file conflict whose resolution is to keep every entry.

## Not written (coordinator-owned; change requests instead)

`apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `apps/api/src/config/**`,
`apps/api/src/infrastructure/http/**`, `apps/api/src/infrastructure/health/**`,
mail/storage/outbox/scanner modules, root manifests and lockfile, CI
workflows, Docker/Compose outside `infra/production/observability/`. See
`shared-change-requests/`.

## PR repair scope (2026-10-14)

The owner's request to repair the open PR also covers
`.github/workflows/observability.yml`, a new isolated Linux validation job.
It exercises the actual Compose topology and firing/recovery receiver path;
existing CI/security gates are unchanged. It contacts only the disposable
local test receiver. No production receivers or hosted acceptance are added.
