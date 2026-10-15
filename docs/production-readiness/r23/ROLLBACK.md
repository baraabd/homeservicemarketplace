# R23 — rollback

## CR-01 corrective follow-up

The 2026-10-15 corrective PR changes only request-id reuse, exception-path
logging, regression tests and R23 documentation. It introduces no migration,
data repair, dependency, flag or deployment configuration.

If a separately authorized rollback is needed, revert the corrective PR's
commits through review. The original R23 telemetry, metrics and redaction
remain. Reverting the correction reintroduces query-bearing exception paths
and inconsistent generated ids; retain the correction unless a reproduced
regression justifies that privacy/correlation tradeoff. Do not disable the
scrubber as a workaround. Run the HTTP/logger/telemetry suites and required
CI on the rollback candidate before deployment.

The procedure below concerns rollback of the original R23 implementation,
not the bounded corrective follow-up.

R23 adds no migration, no schema change, no dependency, no environment key and
no feature flag. Rollback is a code revert; no data needs repair.

## Revert

Revert the R23 merge commit (or the PR's commits) on the release branch. That
removes:

- the HTTP telemetry middleware (`http_requests_total` and
  `http_request_duration_seconds` stop receiving data again — the API SLO
  alerts then match nothing, which is the pre-R23 state);
- the log scrubbing hook, allowlisted request/response serializers, validated
  request id and trace ids in log lines;
- the new metrics, span pipeline, diagnostics leaf providers and domain-metric
  interface.

Lanes that adopted `domainCounter`/`callDependency`/`runInstrumentedJob`
(CR-04) after R23 must be reverted first or the build fails on the missing
methods. Check with `git grep -n "domainCounter\|callDependency\|runInstrumentedJob" apps/api/src`.

## Partial rollback without a revert

| Symptom                                        | Action                                                                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request overhead suspected                     | Remove the `configure()` method from `MetricsModule` (one file). Logging, metrics and redaction stay. Measured overhead is in ACCEPTANCE.md.                          |
| A log line needed for an incident was scrubbed | Do **not** disable the scrubber. Look the request up by `traceId`/`requestId`; extend the request serializer allowlist through review if a field is genuinely needed. |
| Span export misbehaves                         | Export is off by default; if CR-02 enabled it, unset `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` and restart. Logs keep their trace ids.                                     |
| Alert noise                                    | Silence the alert in Alertmanager with an expiry and a ticket; fix the rule through review. Do not delete the rule file.                                              |

## Infrastructure files

`infra/production/observability/` and `scripts/production/observability/`
are not loaded by any running service in this repository; removing or
reverting them affects nothing at runtime. The synthetic test stack is torn
down by its own script (`docker compose -p hsm-r23-obs down -v`), which only
removes that project's containers and anonymous volumes.
