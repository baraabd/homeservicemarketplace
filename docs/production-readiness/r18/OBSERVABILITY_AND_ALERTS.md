# R18 — Observability and alerts

What the code provides at `fabeb07`, and what is missing. No vendor is
selected here.

## Present in code

| Signal               | Implementation                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| Structured logs      | `apps/api/src/infrastructure/logger/logger.module.ts` (pino)                                       |
| Request correlation  | `x-request-id` (`infrastructure/http/request-id.middleware.ts`), echoed by the exception filter    |
| Safe errors          | `all-exceptions.filter.ts`: no stack, SQL or Prisma detail reaches the client                      |
| Liveness / readiness | `GET /health/live`, `GET /health/ready` (`infrastructure/health`); worker readiness on each worker |
| Metrics              | `infrastructure/telemetry/metrics.module.ts` (prom-client); `/metrics` behind a bearer token (env) |
| Worker metrics       | dispute-maintenance and evidence-retention workers export counters and gauges                      |
| Alert rules          | `infra/monitoring/evidence-retention.rules.yml`: 6 rules (evidence retention and scanning)         |
| Graceful shutdown    | tested by CI `Docker cold build + production boot` (`Graceful SIGTERM`)                            |

## Gaps

| Gap                                               | Class       | Note                                                                                                                          |
| ------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| No hosted log, metrics or alert backend           | P1 (launch) | HOSTED_ENVIRONMENT_BLOCKED                                                                                                    |
| No deployed version / source SHA exposed (R18-O3) | P2          | images carry OCI labels; the API does not report them                                                                         |
| Alert rules exist only for evidence retention     | P2          | API error rate, latency, database/Redis health, outbox backlog, SMTP failure and auth abuse have metrics or logs but no rules |
| No synthetic alert test                           | P1 (launch) | needs a hosted backend                                                                                                        |

## Alert conditions to add with the hosted stack (each links to a runbook action)

| Alert               | Condition (initial, to tune on real traffic)          | Runbook (`INCIDENT_RUNBOOK.md`) |
| ------------------- | ----------------------------------------------------- | ------------------------------- |
| API 5xx rate        | 5xx share above the owner's threshold for 5 min       | § API errors                    |
| API latency         | p95 above the owner's threshold for 10 min            | § Latency                       |
| Readiness failing   | `/health/ready` non-200 on any instance for 2 min     | § Dependency down               |
| Outbox backlog      | oldest unpublished event age keeps growing for 10 min | § Outbox                        |
| Scanner unavailable | evidence-retention rules (existing)                   | § Scanner                       |
| SMTP failures       | send failures above zero for 10 min                   | § Mail                          |
| Auth abuse          | login rate-limit refusals spike                       | § Auth abuse                    |

Telemetry must not carry tokens, passwords, OTPs, message bodies, identity
bytes or precise private location; the logger's redaction is unit-tested
(`logger.module.spec.ts`).
