# R23 — alert runbook

Each section is named after the alert that links to it. Thresholds are
**PROPOSED** (`docs/production-readiness/r23/SLO.md`); owners marked
`-unassigned` are placeholders until the product owner names them. This
extends `docs/production-readiness/r18/INCIDENT_RUNBOOK.md`; it does not
replace it.

Rules for every incident:

- Record the time, the deployed `sourceSha` (from `/health/live`) and a
  `requestId` or `traceId` of an affected request.
- Never paste tokens, OTPs, cookies, message text, receipts, identity documents
  or precise locations into the incident record, a ticket or a chat.
- Search logs by `traceId` / `requestId`. Logs do not contain request bodies,
  query strings or credentials by design; do not turn on body logging to debug.
- Do not bypass scanning, verification, rate limits or payment idempotency to
  make an alert go away.

Escalation, unless a section says otherwise: platform on-call → (15 min
without acknowledgement) platform lead → (data loss, security or money
suspicion) owner and the security incident path. Production contacts are not
configured yet (R23-EXT-1); until they are, alerts reach test receivers only.

## ApiAvailabilityFastBurn

More than 7.2 % of API requests (excluding probes and client aborts) returned
5xx over both the last hour and the last 5 minutes, with at least 20 requests.

1. API overview dashboard: which routes carry the 5xx.
2. `/health/ready` on each instance. If Postgres or Redis is down, go to
   _Dependency down_ in the R18 incident runbook.
3. Compare the start time with the last deployment (`sourceSha`). If they
   match, roll back (`docs/production-readiness/r18/ROLLBACK_RUNBOOK.md`).
4. Read `Unhandled exception` log lines by `traceId` for the failing route.

Recovery: the 5-minute ratio drops below 7.2 %; the alert resolves at the next
evaluation and the receiver gets a `resolved` notification.

## ApiAvailabilitySlowBurn

3 % 5xx sustained over 6 h and 30 min. Same checks as the fast burn, with a
6-hour view; look for one route failing for one class of input. Suppressed
while the fast burn of the same SLO fires.

## ApiAvailabilityBudgetTicket

The 3-day 5xx ratio exceeds the proposed 0.5 % objective. Open a reliability
ticket listing the top failing routes; no immediate action.

## ApiLatencyFastBurn

More than 14.4 % of requests took longer than 1 second. Check the p95 by route,
database pool saturation and slow queries, and Redis latency. Scale API
instances only when the database has headroom.

## ApiLatencySlowBurn

6 % of requests slower than 1 second over 6 h and 30 min. Ticket: identify the
slowest route and its query plan.

## ApiScrapeTargetDown

Prometheus cannot scrape an instance for 2 minutes.

1. `/health/live` on the instance (process-local, no dependencies).
2. Container state and restart count.
3. A rotated `METRICS_TOKEN`: a wrong token returns 404, exactly like a missing
   endpoint, by design.

## OutboxLagHigh

The oldest claimable outbox event is older than 5 minutes for 10 minutes.
Notifications and verification side effects are delayed, not lost.

1. `outbox_queue_depth` by status and `outbox_oldest_pending_age_seconds`.
2. `OUTBOX_WORKER_ENABLED` and worker readiness on every replica.
3. `outbox_reclaimed_total` rising means workers crash mid-event.
4. `outbox_events_processed_total{outcome="retried"}` by event type points at
   the failing handler.

## OutboxDeadEvents

Events exhausted their retries. Find the handler errors by `traceId`, fix the
cause, then let the owning domain team decide on replay. Do not edit outbox
rows by hand.

## NotificationDeliveryDelayHigh

INSTRUMENTATION_PENDING (R29+). p99 delay from event to delivery above 2
minutes. Check `OutboxLagHigh` first, then push and SMTP dependency errors.

## MailSendFailureRatioHigh

More than 5 % of SMTP sends failed over 15 minutes (at least 5 sends). Sign-in
OTP and password recovery mail are affected.

1. `dependency_up{dependency="smtp"}` and the timeout/error split.
2. SMTP credential rotation and sender verification.
3. Never enable a test mailbox or an OTP bypass in production.

## DependencyDiagnosticDown

A deep diagnostic (SMTP, storage, scanner, payment) has failed for 10 minutes.
The API intentionally stays live and ready. Check the vendor status page,
credential rotation and egress from the API host. Escalate to a page if the
matching functional alert (mail, scan) also fires.

## ScanBacklogStale

INSTRUMENTATION_PENDING (R31/R32). An upload waited more than 15 minutes for a
malware scan. Restore ClamAV; never mark uploads clean or skip scanning.

## PaymentOutcomeUnknown

INSTRUMENTATION_PENDING and POLICY_BLOCKED: no payment rail is enabled (R16,
R18 D-1). When one exists: look the attempt up at the provider by idempotency
key, check webhook delivery, and reconcile through the approved procedure.
Never retry a charge or rewrite the ledger by hand.

## BackgroundJobStale

A background job has not succeeded for 30 minutes. Check
`background_job_runs_total` by outcome and the job's log lines by `traceId`.

## TelemetrySpanExportFailing

Trace export has failed for 15 minutes; spans are dropped by design and the
API is unaffected. Check the collector, then `telemetry_spans_dropped_total`
by reason.

## TelemetryLabelOverflow

A metric received label values outside its declared set, which were recorded
as `other`. Usually a caller passing an id or free text as a label; fix the
caller (see `docs/production-readiness/r23/METRICS_CATALOG.md` for the owner).
