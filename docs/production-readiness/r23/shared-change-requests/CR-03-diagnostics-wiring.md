# CR-03 — deep diagnostics wiring (never liveness)

Owner of the files: coordinator (health module), with the mail, storage and
scanner module owners for their probe functions. Requested by: R23.
Dependency or migration consequences: none.

## Paths

- `apps/api/src/infrastructure/health/health.module.ts` (or a new
  `diagnostics.scheduler.ts` registered by the coordinator)
- `apps/api/src/infrastructure/mail/nodemailer-mail.adapter.ts` — expose
  `verify(): Promise<unknown>` delegating to `transporter.verify()`
- `apps/api/src/infrastructure/storage/*` — expose a `HeadBucket` check per
  configured bucket
- the scanner client — expose a clamd `PING`

## Reason

R23 ships `runDiagnostics` and the probe adapters in
`telemetry/dependency-diagnostics.ts`. They are deliberately not mounted:

- `/health/live` must stay process-local, or a vendor outage becomes an
  orchestrator restart loop;
- `/health/ready` must stay limited to what serving requires (Postgres, Redis,
  Mongo when enabled), or an SMTP outage removes every instance from the load
  balancer.

## Proposed wiring

A scheduler (every 60 s, timer `unref()`, one run at a time) calls
`runDiagnostics([smtpProbe(mail.verify), storageProbe(storage.headBuckets),
scannerProbe(scanner.ping), paymentProbe(null)], { metrics, timeoutMs: 3000 })`.
Results feed `dependency_up`; `DependencyDiagnosticDown` alerts on it. If an
HTTP view is wanted, mount it behind the admin guard, never on `/health/*`.

## Tests

- Scheduler: a hung probe does not delay the next run beyond the timeout; a
  throwing probe does not stop the scheduler.
- Health: `/health/live` and `/health/ready` responses are unchanged.
