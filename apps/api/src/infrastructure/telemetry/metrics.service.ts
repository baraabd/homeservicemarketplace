import { Injectable, OnModuleInit } from '@nestjs/common';
import { Registry, collectDefaultMetrics, Counter, Gauge, Histogram } from 'prom-client';

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
