import { Injectable, OnApplicationShutdown } from '@nestjs/common';

import { scrubText } from '../logger/redaction';
import {
  CardinalityLimiter,
  EnumLabel,
  OVERFLOW_LABEL,
  httpMethodLabel,
  httpStatusLabel,
  nameToken,
} from './label-bounds';
import { MetricsService } from './metrics.service';
import {
  SpanPipeline,
  startSpan,
  type SpanExporter,
  type SpanPipelineOptions,
} from './span-pipeline';
import {
  childTraceContext,
  currentTraceContext,
  runWithTraceContext,
  startTraceContext,
  type TraceContext,
} from './trace-context';

// R23 — instrumentation entry points for the three boundaries the sprint
// traces: inbound HTTP, background jobs and calls to external providers.
//
// Every public method contains its own failures. If a metric, a span or a
// label guard throws, the error is counted in
// telemetry_instrumentation_errors_total and the business operation proceeds
// exactly as if telemetry were absent.

export const DEPENDENCIES = [
  'postgres',
  'redis',
  'mongo',
  'smtp',
  'storage',
  'scanner',
  'payment',
  'maps',
  'push',
] as const;
export type Dependency = (typeof DEPENDENCIES)[number];

const DEPENDENCY_LABEL = new EnumLabel(DEPENDENCIES);

// Upper bounds on distinct label values per process. Route patterns are
// finite (they come from decorators) but are capped anyway; job and operation
// names come from code, and the cap turns a bug into one `other` series.
const MAX_ROUTES = 400;
const MAX_JOBS = 64;
const MAX_OPERATIONS_PER_DEPENDENCY = 32;

export interface HttpObservation {
  method: unknown;
  route: string;
  status: unknown;
  durationSeconds: number;
}

@Injectable()
export class TelemetryService implements OnApplicationShutdown {
  private pipeline: SpanPipeline | null = null;
  private readonly routes = new CardinalityLimiter(MAX_ROUTES);
  private readonly jobs = new CardinalityLimiter(MAX_JOBS);
  private readonly operations = new Map<string, CardinalityLimiter>();

  constructor(private readonly metrics: MetricsService) {}

  /**
   * Turns on span export. Off by default: the coordinator wires this from
   * validated configuration (shared-change-requests/CR-02). Logs and metrics
   * carry trace ids either way.
   */
  enableSpanExport(
    exporter: SpanExporter,
    opts: Omit<SpanPipelineOptions, 'exporter' | 'hooks'> = {},
  ): void {
    const previous = this.pipeline;
    this.pipeline = new SpanPipeline({
      ...opts,
      exporter,
      hooks: {
        onDropped: (reason, count) =>
          this.metrics.telemetrySpansDroppedTotal.inc({ reason }, count),
        onExportFailure: (reason) => this.metrics.telemetryExportFailuresTotal.inc({ reason }),
        onExported: (count) => this.metrics.telemetrySpansExportedTotal.inc(count),
      },
    });
    void previous?.shutdown();
  }

  get spanPipeline(): SpanPipeline | null {
    return this.pipeline;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pipeline?.shutdown();
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  recordHttp(obs: HttpObservation, trace: TraceContext | undefined, startMs: number): void {
    this.contain(() => {
      const route = this.admit(this.routes, obs.route, 'http_requests_total');
      const labels = {
        method: httpMethodLabel(obs.method),
        route,
        status: httpStatusLabel(obs.status),
      };
      this.metrics.httpRequestsTotal.inc(labels);
      if (Number.isFinite(obs.durationSeconds) && obs.durationSeconds >= 0) {
        this.metrics.httpRequestDurationSeconds.observe(labels, obs.durationSeconds);
      }
      if (trace) {
        const status = typeof obs.status === 'number' ? obs.status : 0;
        startSpan(
          this.pipeline,
          trace,
          `${labels.method} ${route}`,
          {
            'http.request.method': labels.method,
            'http.route': route,
            'http.response.status_code': status,
          },
          clockFrom(startMs, obs.durationSeconds),
        ).end(status >= 500 ? 'error' : 'ok');
      }
    });
  }

  // ── background jobs ───────────────────────────────────────────────────────

  /**
   * Runs one unit of background work in its own trace (kind `job`), so its
   * log lines carry a traceId, and records run count, duration and last
   * success. The job's own result or error is returned/rethrown unchanged.
   */
  async runInstrumentedJob<T>(jobName: string, fn: () => Promise<T>, sampleRatio = 0): Promise<T> {
    let job: string = OVERFLOW_LABEL;
    let ctx: TraceContext | undefined;
    this.contain(() => {
      job = this.admit(this.jobs, nameToken(jobName), 'background_job_runs_total');
      ctx = startTraceContext({ kind: 'job', sampleRatio });
    });
    const start = performance.now();
    const startMs = Date.now();
    const run = () => fn();
    let outcome: 'success' | 'failure' = 'failure';
    try {
      const result = await (ctx ? runWithTraceContext(ctx, run) : run());
      outcome = 'success';
      return result;
    } finally {
      const seconds = (performance.now() - start) / 1_000;
      this.contain(() => {
        this.metrics.backgroundJobRunsTotal.inc({ job_name: job, outcome });
        this.metrics.backgroundJobDurationSeconds.observe({ job_name: job }, seconds);
        if (outcome === 'success') {
          this.metrics.backgroundJobLastSuccessUnixtime.set(
            { job_name: job },
            Math.floor(Date.now() / 1_000),
          );
        }
        if (ctx) {
          startSpan(
            this.pipeline,
            ctx,
            `job ${job}`,
            { 'job.name': job, outcome },
            clockFrom(startMs, seconds),
          ).end(outcome === 'success' ? 'ok' : 'error');
        }
      });
    }
  }

  // ── external providers ────────────────────────────────────────────────────

  /**
   * Measures one call to an external dependency. `operation` must be a short
   * identifier (`send`, `put_object`, `scan`); never pass a URL, a key or an
   * id. The callee's result or error passes through unchanged — only the
   * error's class name is recorded, and only on the span.
   */
  async callDependency<T>(
    dependency: Dependency,
    operation: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    let dep: string = OVERFLOW_LABEL;
    let op: string = OVERFLOW_LABEL;
    let ctx: TraceContext | undefined;
    this.contain(() => {
      dep = DEPENDENCY_LABEL.value(dependency);
      let limiter = this.operations.get(dep);
      if (!limiter) {
        limiter = new CardinalityLimiter(MAX_OPERATIONS_PER_DEPENDENCY);
        this.operations.set(dep, limiter);
      }
      op = this.admit(limiter, nameToken(operation), 'dependency_call_duration_seconds');
      const parent = currentTraceContext();
      if (parent) ctx = childTraceContext(parent, 'client');
    });
    const start = performance.now();
    const startMs = Date.now();
    let outcome: 'success' | 'error' | 'timeout' = 'error';
    let errorType: string | undefined;
    try {
      const result = await fn();
      outcome = 'success';
      return result;
    } catch (err) {
      errorType = errorClass(err);
      outcome = isTimeout(err) ? 'timeout' : 'error';
      throw err;
    } finally {
      const seconds = (performance.now() - start) / 1_000;
      this.contain(() => {
        this.metrics.dependencyCallDurationSeconds.observe(
          { dependency: dep, operation: op, outcome },
          seconds,
        );
        if (ctx) {
          startSpan(
            this.pipeline,
            ctx,
            `${dep} ${op}`,
            {
              'dependency.name': dep,
              'dependency.operation': op,
              outcome,
              ...(errorType ? { 'error.type': errorType } : {}),
            },
            clockFrom(startMs, seconds),
          ).end(outcome === 'success' ? 'ok' : 'error');
        }
      });
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private admit(limiter: CardinalityLimiter, value: string, metric: string): string {
    const admitted = limiter.admit(value);
    if (admitted === OVERFLOW_LABEL && value !== OVERFLOW_LABEL) {
      this.metrics.telemetryLabelOverflowTotal.inc({ metric });
    }
    return admitted;
  }

  private contain(fn: () => void): void {
    try {
      fn();
    } catch {
      try {
        this.metrics.telemetryInstrumentationErrorsTotal.inc();
      } catch {
        // Nothing further to do without risking the caller.
      }
    }
  }
}

/** A two-reading clock: first call returns the start, second the end. */
function clockFrom(startMs: number, durationSeconds: number): () => number {
  let calls = 0;
  return () => (calls++ === 0 ? startMs : startMs + durationSeconds * 1_000);
}

function errorClass(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  // Class names only, and scrubbed in case a library put data in `name`.
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(name) ? name : scrubText('UnknownError');
}

function isTimeout(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  return (
    err.name === 'TimeoutError' ||
    err.name === 'AbortError' ||
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT' ||
    code === 'ETIMEOUT'
  );
}
