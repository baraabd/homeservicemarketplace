# CR-04 — adopt the job and dependency instrumentation at the boundaries

Owner of the files: the owning lanes (outbox, mail, storage, scanner, workers)
or the coordinator. Requested by: R23. Dependency or migration consequences:
none.

## Paths and one-line changes

| Path                                                                                      | Change                                                                                                                     |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/infrastructure/outbox/outbox.worker.ts`                                     | wrap one tick: `await this.telemetry.runInstrumentedJob('outbox.tick', () => this.runOnce())`                              |
| `apps/api/src/infrastructure/mail/nodemailer-mail.adapter.ts`                             | `await this.telemetry.callDependency('smtp', 'send', () => this.transporter.sendMail(...))`                                |
| `apps/api/src/infrastructure/storage/*`                                                   | `callDependency('storage', 'put_object' \| 'get_object' \| 'head_object' \| 'delete_object', ...)`                         |
| scanner client                                                                            | `callDependency('scanner', 'scan', ...)`                                                                                   |
| `apps/api/src/dispute-maintenance.worker.ts`, `apps/api/src/evidence-retention.worker.ts` | wrap each sweep in `runInstrumentedJob('dispute.maintenance' \| 'evidence.retention', ...)` (existing worker metrics stay) |

`TelemetryService` is exported by the global `MetricsModule`, so injection
needs no module change. Operation and job names must be short identifiers;
the service collapses anything else into `other`.

## Reason

Without adoption, `MailSendFailureRatioHigh`, `BackgroundJobStale` and the
dependency panels have no producer. R23 cannot edit these files (single-writer
rule). The rules are written so a missing producer stays silent rather than
paging.

## Tests

Each owner adds one test: the call's result and error pass through unchanged,
and the metric increments with the expected bounded labels.
