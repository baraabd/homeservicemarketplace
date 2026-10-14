# R23 — metric naming and the extension interface

This catalog is how later lanes (R29–R34) add domain metrics **without editing
the telemetry module**. The coordinator owns global collector and
configuration integration; each domain lane owns its own instruments.

## How to add a domain metric

Inject `MetricsService` (global) and declare the metric once, at provider
construction:

```ts
private readonly dispatched = this.metrics.domainCounter({
  domain: 'notification',
  name: 'notification_dispatch_total',
  help: 'Notifications dispatched, by channel and outcome',
  labels: { channel: ['email', 'push', 'in_app'], outcome: ['sent', 'failed'] },
});

this.dispatched.inc({ channel: 'push', outcome: 'sent' });
```

Also available: `domainGauge(spec)` and `domainHistogram({ ...spec, buckets })`.

Rules enforced at registration (`domain-metrics.ts`, tested):

- name is `<domain>_<what>[_<unit>]`, snake_case, starts with the domain;
- counters end with `_total`; nothing else may;
- reserved prefixes: `http_`, `dependency_`, `background_job_`, `telemetry_`,
  `process_`, `nodejs_`, `outbox_`;
- at most 4 labels, each declaring its complete value set (1–64 values);
- `other` is reserved for overflow.

At record time an undeclared label value becomes `other` and increments
`telemetry_label_overflow_total{metric=...}`; recording never throws.

**Never** use a user id, provider id, booking id, email, phone, IP, URL,
free-text reason or error message as a label value. Hashing an identifier does
not make it acceptable: a hash is still a stable identifier.

## For boundaries

- External calls: `TelemetryService.callDependency(dependency, operation, fn)`
  — `dependency` is one of `postgres, redis, mongo, smtp, storage, scanner,
payment, maps, push`; `operation` is a short identifier.
- Background work: `TelemetryService.runInstrumentedJob(jobName, fn)` — its log
  lines carry a `traceId`.

## Platform metrics (owned by R23)

| Metric                                   | Type      | Labels                                                             |
| ---------------------------------------- | --------- | ------------------------------------------------------------------ |
| `http_requests_total`                    | counter   | `method`, `route` (pattern or `unmatched`), `status`               |
| `http_request_duration_seconds`          | histogram | same                                                               |
| `dependency_call_duration_seconds`       | histogram | `dependency`, `operation`, `outcome` (`success`/`error`/`timeout`) |
| `background_job_runs_total`              | counter   | `job_name`, `outcome`                                              |
| `background_job_duration_seconds`        | histogram | `job_name`                                                         |
| `background_job_last_success_unixtime`   | gauge     | `job_name`                                                         |
| `dependency_up`                          | gauge     | `dependency`                                                       |
| `telemetry_spans_dropped_total`          | counter   | `reason` (`queue_full`, `backoff`, `export_failed`, `shutdown`)    |
| `telemetry_spans_exported_total`         | counter   | —                                                                  |
| `telemetry_export_failures_total`        | counter   | `reason` (`timeout`, `error`)                                      |
| `telemetry_label_overflow_total`         | counter   | `metric`                                                           |
| `telemetry_instrumentation_errors_total` | counter   | —                                                                  |

`job_name`, not `job`: Prometheus reserves `job` for the scrape target and
would rename a metric's own `job` label to `exported_job`.

## Reserved for domain lanes (alert rules already reference them)

| Metric                                | Type                       | Owner lane                | Rule                            |
| ------------------------------------- | -------------------------- | ------------------------- | ------------------------------- |
| `notification_delivery_delay_seconds` | histogram, label `channel` | notifications (R29+)      | `NotificationDeliveryDelayHigh` |
| `scan_oldest_pending_age_seconds`     | gauge                      | scanning (R31/R32)        | `ScanBacklogStale`              |
| `payment_unknown_outcomes_open`       | gauge                      | payments (policy-blocked) | `PaymentOutcomeUnknown`         |

Until a producer exists these rules match nothing and stay silent; the
dashboards label their panels PENDING.

## Pre-existing metrics (unchanged)

`outbox_*`, `evidence_scan_outcomes_total`,
`verification_case_transitions_total`, `deprecated_route_requests_total`, the
worker metrics in `dispute-maintenance.worker.ts` and
`evidence-retention.worker.ts`, and prom-client default process metrics.
