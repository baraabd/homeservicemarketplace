import { Injectable, OnModuleInit } from '@nestjs/common';
import { Registry, collectDefaultMetrics, Counter, Gauge, Histogram } from 'prom-client';

import {
  defineDomainCounter,
  defineDomainGauge,
  defineDomainHistogram,
  type DomainCounter,
  type DomainGauge,
  type DomainHistogram,
  type DomainMetricSpec,
} from './domain-metrics';

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  readonly httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  // ── Sprint 6: outbox ─────────────────────────────────────────────────────
  //
  // A background worker with no metrics is a system that fails silently: the
  // symptom of a stalled outbox is that notifications simply do not arrive,
  // and nobody files that ticket for hours.
  //
  // `outbox_oldest_pending_age_seconds` is the one to alert on. Depth alone is
  // ambiguous — a large backlog draining quickly is healthy — but a rising
  // oldest-age means arrivals have overtaken throughput, which is always
  // worth waking someone for.

  readonly outboxEventsProcessedTotal = new Counter({
    name: 'outbox_events_processed_total',
    help: 'Outbox events that reached a terminal state, by event type and outcome',
    // `outcome` distinguishes the states that matter operationally:
    // processed / retried / dead / skipped-duplicate.
    labelNames: ['event_type', 'outcome'] as const,
    registers: [this.registry],
  });

  readonly outboxEventDurationSeconds = new Histogram({
    name: 'outbox_event_duration_seconds',
    help: 'Wall-clock duration of a single outbox handler run',
    labelNames: ['event_type'] as const,
    buckets: [0.005, 0.025, 0.1, 0.5, 1, 5, 15, 60],
    registers: [this.registry],
  });

  readonly outboxQueueDepth = new Gauge({
    name: 'outbox_queue_depth',
    help: 'Outbox rows currently in each status',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });

  readonly outboxOldestPendingAgeSeconds = new Gauge({
    name: 'outbox_oldest_pending_age_seconds',
    help: 'Age of the oldest claimable outbox event; the primary staleness alarm',
    registers: [this.registry],
  });

  readonly outboxClaimedTotal = new Counter({
    name: 'outbox_claimed_total',
    help: 'Outbox events claimed by this worker',
    registers: [this.registry],
  });

  readonly outboxReclaimedTotal = new Counter({
    name: 'outbox_reclaimed_total',
    help: 'Outbox events returned to PENDING after a worker crashed mid-flight',
    registers: [this.registry],
  });

  // ── Sprint 6: deprecated route usage ─────────────────────────────────────
  //
  // Removing a route on a schedule is a guess; removing it when this counter
  // reaches zero is a decision. Labelled by the canonical replacement so the
  // migration table in the sprint report can be generated from live data
  // rather than from someone's memory of what maps to what.
  /** Sprint 9B.4 — scan outcomes by terminal state.
   *
   *  Labelled by state and nothing else. A per-asset or per-owner label would
   *  turn a metrics endpoint into a list of whose identity documents were
   *  quarantined, and Prometheus retains far longer than the documents do. */
  readonly evidenceScanOutcomesTotal = new Counter({
    name: 'evidence_scan_outcomes_total',
    help: 'Restricted evidence scan outcomes by terminal scan state.',
    labelNames: ['state'] as const,
    registers: [this.registry],
  });

  /** Sprint 9B.5 — verification case transitions, by destination state.
   *
   *  Labelled by state alone. A per-case or per-provider label would turn the
   *  metrics endpoint into a list of who is under review, retained far longer
   *  than the case is. */
  readonly verificationCaseTransitionsTotal = new Counter({
    name: 'verification_case_transitions_total',
    help: 'Verification case transitions by destination state.',
    labelNames: ['to_state'],
    registers: [this.registry],
  });

  readonly deprecatedRouteRequestsTotal = new Counter({
    name: 'deprecated_route_requests_total',
    help: 'Requests served by a deprecated route',
    labelNames: ['route', 'canonical', 'method'] as const,
    registers: [this.registry],
  });

  // ── R23: dependency calls, background jobs, diagnostics ───────────────────
  //
  // Labels are bounded by construction: `dependency` is an enum, `operation`
  // and `job_name` are identifier tokens admitted through a cardinality limiter
  // (see telemetry.service.ts). None carries an id, a URL or an error message.

  readonly dependencyCallDurationSeconds = new Histogram({
    name: 'dependency_call_duration_seconds',
    help: 'Duration of calls to an external dependency, by outcome',
    labelNames: ['dependency', 'operation', 'outcome'] as const,
    buckets: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [this.registry],
  });

  readonly backgroundJobRunsTotal = new Counter({
    name: 'background_job_runs_total',
    help: 'Background job runs, by job and outcome',
    labelNames: ['job_name', 'outcome'] as const,
    registers: [this.registry],
  });

  readonly backgroundJobDurationSeconds = new Histogram({
    name: 'background_job_duration_seconds',
    help: 'Wall-clock duration of a background job run',
    labelNames: ['job_name'] as const,
    buckets: [0.01, 0.05, 0.25, 1, 5, 15, 60, 300],
    registers: [this.registry],
  });

  readonly backgroundJobLastSuccessUnixtime = new Gauge({
    name: 'background_job_last_success_unixtime',
    help: 'Unix time of the last successful run of a background job',
    labelNames: ['job_name'] as const,
    registers: [this.registry],
  });

  /** Deep diagnostics (SMTP, storage, scanner, payment). 1 = reachable.
   *  Deliberately separate from /health/ready: a vendor outage is an alert,
   *  not a reason for an orchestrator to restart or unroute the API. */
  readonly dependencyUp = new Gauge({
    name: 'dependency_up',
    help: 'Result of the last deep diagnostic probe (1 up, 0 down)',
    labelNames: ['dependency'] as const,
    registers: [this.registry],
  });

  // ── R23: telemetry self-observation ───────────────────────────────────────

  readonly telemetrySpansDroppedTotal = new Counter({
    name: 'telemetry_spans_dropped_total',
    help: 'Spans dropped before export, by reason',
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });

  readonly telemetrySpansExportedTotal = new Counter({
    name: 'telemetry_spans_exported_total',
    help: 'Spans accepted by the trace exporter',
    registers: [this.registry],
  });

  readonly telemetryExportFailuresTotal = new Counter({
    name: 'telemetry_export_failures_total',
    help: 'Failed trace export attempts, by reason',
    labelNames: ['reason'] as const,
    registers: [this.registry],
  });

  readonly telemetryLabelOverflowTotal = new Counter({
    name: 'telemetry_label_overflow_total',
    help: 'Label values collapsed into "other" by a cardinality bound',
    labelNames: ['metric'] as const,
    registers: [this.registry],
  });

  readonly telemetryInstrumentationErrorsTotal = new Counter({
    name: 'telemetry_instrumentation_errors_total',
    help: 'Errors raised inside instrumentation code and contained there',
    registers: [this.registry],
  });

  // ── R23: stable extension interface for domain metrics ────────────────────
  //
  // R29–R34 instrument their own domains through these three methods instead
  // of editing this file. See domain-metrics.ts for the naming rules; the
  // returned handles never throw into the caller.

  domainCounter<L extends string>(spec: DomainMetricSpec<L>): DomainCounter<L> {
    return defineDomainCounter(this.registry, spec, this.telemetryLabelOverflowTotal);
  }

  domainGauge<L extends string>(spec: DomainMetricSpec<L>): DomainGauge<L> {
    return defineDomainGauge(this.registry, spec, this.telemetryLabelOverflowTotal);
  }

  domainHistogram<L extends string>(
    spec: DomainMetricSpec<L> & { buckets: readonly number[] },
  ): DomainHistogram<L> {
    return defineDomainHistogram(this.registry, spec, this.telemetryLabelOverflowTotal);
  }

  onModuleInit(): void {
    collectDefaultMetrics({ register: this.registry });
  }

  async metrics(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }
}
