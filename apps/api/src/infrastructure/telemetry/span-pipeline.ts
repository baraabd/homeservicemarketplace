import { scrubText } from '../logger/redaction';
import type { TraceContext, TraceKind } from './trace-context';

// R23 — a bounded span pipeline.
//
// Telemetry must never be the reason a booking or a verification fails. Every
// limit here exists to keep a slow or absent collector from turning into
// memory growth, event-loop stalls or exceptions on the request path:
//
//   * the queue is a fixed-size array; when full, new spans are dropped and
//     counted, never buffered elsewhere;
//   * an export has a hard timeout and is aborted when it expires;
//   * after a failed export the pipeline backs off and drops (counting) for a
//     cool-down window instead of retrying the same batch in a loop;
//   * `onEnd` never throws and never awaits.
//
// Span attributes are allowlisted by key and scrubbed by value. A span is not a
// place for request bodies, headers or user identifiers.

export type SpanStatus = 'ok' | 'error';

export interface FinishedSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: TraceKind;
  startTimeMs: number;
  durationMs: number;
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
}

export interface SpanExporter {
  /** Must reject on failure. The signal aborts when the export times out. */
  export(spans: readonly FinishedSpan[], signal: AbortSignal): Promise<void>;
}

export const SPAN_ATTRIBUTE_ALLOWLIST: ReadonlySet<string> = new Set([
  'http.request.method',
  'http.route',
  'http.response.status_code',
  'job.name',
  'dependency.name',
  'dependency.operation',
  'outcome',
  'error.type',
  'service.version',
]);

const MAX_ATTRIBUTE_LENGTH = 128;

export function sanitizeSpanAttributes(
  input: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SPAN_ATTRIBUTE_ALLOWLIST.has(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string') out[key] = scrubText(value.slice(0, MAX_ATTRIBUTE_LENGTH));
  }
  return out;
}

export type DropReason = 'queue_full' | 'backoff' | 'export_failed' | 'shutdown';

export interface SpanPipelineHooks {
  onDropped?(reason: DropReason, count: number): void;
  onExportFailure?(reason: 'timeout' | 'error'): void;
  onExported?(count: number): void;
}

export interface SpanPipelineOptions {
  exporter: SpanExporter;
  maxQueueSize?: number;
  maxBatchSize?: number;
  exportTimeoutMs?: number;
  scheduleDelayMs?: number;
  failureBackoffMs?: number;
  hooks?: SpanPipelineHooks;
  /** Injected for tests. */
  now?: () => number;
}

export class SpanPipeline {
  private queue: FinishedSpan[] = [];
  private readonly maxQueueSize: number;
  private readonly maxBatchSize: number;
  private readonly exportTimeoutMs: number;
  private readonly scheduleDelayMs: number;
  private readonly failureBackoffMs: number;
  private readonly hooks: SpanPipelineHooks;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private exporting: Promise<void> | null = null;
  private backoffUntil = 0;
  private closed = false;

  constructor(private readonly opts: SpanPipelineOptions) {
    this.maxQueueSize = clampInt(opts.maxQueueSize ?? 2_048, 1, 65_536);
    this.maxBatchSize = clampInt(opts.maxBatchSize ?? 256, 1, this.maxQueueSize);
    this.exportTimeoutMs = clampInt(opts.exportTimeoutMs ?? 5_000, 10, 60_000);
    this.scheduleDelayMs = clampInt(opts.scheduleDelayMs ?? 2_000, 1, 60_000);
    this.failureBackoffMs = clampInt(opts.failureBackoffMs ?? 30_000, 0, 600_000);
    this.hooks = opts.hooks ?? {};
    this.now = opts.now ?? Date.now;
  }

  get queued(): number {
    return this.queue.length;
  }

  onEnd(span: FinishedSpan): void {
    try {
      if (this.closed) return this.drop('shutdown', 1);
      if (this.now() < this.backoffUntil) return this.drop('backoff', 1);
      if (this.queue.length >= this.maxQueueSize) return this.drop('queue_full', 1);
      this.queue.push(span);
      if (this.queue.length >= this.maxBatchSize) void this.flush();
      else this.schedule();
    } catch {
      // A hook that throws must not reach the caller.
    }
  }

  /** Exports what is queued now, one batch at a time. Never rejects. */
  async flush(): Promise<void> {
    if (this.exporting) return this.exporting;
    this.exporting = this.drain().finally(() => {
      this.exporting = null;
    });
    return this.exporting;
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.flush();
    this.closed = true;
    if (this.queue.length) this.drop('shutdown', this.queue.length);
    this.queue = [];
  }

  private schedule(): void {
    if (this.timer || this.closed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.scheduleDelayMs);
    // A pending export must not keep a finishing process alive.
    this.timer.unref();
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      if (this.now() < this.backoffUntil) {
        this.drop('backoff', this.queue.length);
        this.queue = [];
        return;
      }
      const batch = this.queue.splice(0, this.maxBatchSize);
      const ok = await this.exportBatch(batch);
      if (!ok) {
        // The failed batch is dropped, not requeued: requeueing under a
        // persistent outage is exactly the unbounded retry this avoids.
        this.drop('export_failed', batch.length);
        this.backoffUntil = this.now() + this.failureBackoffMs;
      }
    }
  }

  private async exportBatch(batch: FinishedSpan[]): Promise<boolean> {
    const controller = new AbortController();
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error('export timeout'));
      }, this.exportTimeoutMs);
      timer.unref();
    });
    try {
      // Promise.race, not just the signal: an exporter that ignores the
      // signal must still not hold the drain loop past the timeout.
      await Promise.race([this.opts.exporter.export(batch, controller.signal), timeout]);
      this.safe(() => this.hooks.onExported?.(batch.length));
      return true;
    } catch {
      this.safe(() => this.hooks.onExportFailure?.(timedOut ? 'timeout' : 'error'));
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private drop(reason: DropReason, count: number): void {
    this.safe(() => this.hooks.onDropped?.(reason, count));
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      // Telemetry about telemetry is best-effort.
    }
  }
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

// ── a span builder bound to a trace context ────────────────────────────────

export interface ActiveSpan {
  readonly context: TraceContext;
  setAttribute(key: string, value: string | number | boolean): void;
  end(status: SpanStatus): void;
}

export function startSpan(
  pipeline: SpanPipeline | null,
  context: TraceContext,
  name: string,
  attributes: Record<string, unknown> = {},
  now: () => number = Date.now,
): ActiveSpan {
  const start = now();
  const attrs: Record<string, unknown> = { ...attributes };
  let ended = false;
  return {
    context,
    setAttribute(key, value) {
      attrs[key] = value;
    },
    end(status) {
      if (ended) return;
      ended = true;
      if (!pipeline || !context.sampled) return;
      pipeline.onEnd({
        traceId: context.traceId,
        spanId: context.spanId,
        parentSpanId: context.parentSpanId,
        name: name.slice(0, MAX_ATTRIBUTE_LENGTH),
        kind: context.kind,
        startTimeMs: start,
        durationMs: Math.max(0, now() - start),
        status,
        attributes: sanitizeSpanAttributes(attrs),
      });
    },
  };
}

// ── OTLP/HTTP JSON exporter ────────────────────────────────────────────────

const OTLP_KIND: Record<TraceKind, number> = {
  internal: 1,
  server: 2,
  client: 3,
  // A background job is the consumer side of a schedule or queue.
  job: 5,
};

/**
 * Exports to an OTLP/HTTP collector (`POST {endpoint}/v1/traces`, JSON
 * encoding, OTLP 1.x). Uses the runtime's fetch, so no SDK dependency is
 * needed. Response bodies are never read into errors or logs: a collector
 * error page can echo the request, and the request carries the auth header.
 */
export class OtlpHttpJsonExporter implements SpanExporter {
  constructor(
    private readonly opts: {
      endpoint: string;
      serviceName: string;
      serviceVersion: string | null;
      headers?: Record<string, string>;
      fetchImpl?: typeof fetch;
    },
  ) {
    const url = new URL(opts.endpoint);
    if (url.username || url.password) {
      throw new Error('OTLP endpoint must not embed credentials; use headers');
    }
  }

  async export(spans: readonly FinishedSpan[], signal: AbortSignal): Promise<void> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const res = await doFetch(new URL('/v1/traces', this.opts.endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.opts.headers ?? {}) },
      body: JSON.stringify(this.encode(spans)),
      signal,
      redirect: 'error',
    });
    // Drain without reading into memory we keep.
    await res.body?.cancel().catch(() => undefined);
    if (!res.ok) throw new Error(`collector responded ${res.status}`);
  }

  encode(spans: readonly FinishedSpan[]) {
    const resourceAttrs = [{ key: 'service.name', value: { stringValue: this.opts.serviceName } }];
    if (this.opts.serviceVersion) {
      resourceAttrs.push({
        key: 'service.version',
        value: { stringValue: this.opts.serviceVersion },
      });
    }
    return {
      resourceSpans: [
        {
          resource: { attributes: resourceAttrs },
          scopeSpans: [
            {
              scope: { name: 'hsm-api' },
              spans: spans.map((s) => ({
                traceId: s.traceId,
                spanId: s.spanId,
                ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
                name: s.name,
                kind: OTLP_KIND[s.kind],
                startTimeUnixNano: msToNanos(s.startTimeMs),
                endTimeUnixNano: msToNanos(s.startTimeMs + s.durationMs),
                attributes: Object.entries(s.attributes).map(([key, v]) => ({
                  key,
                  value:
                    typeof v === 'number'
                      ? Number.isInteger(v)
                        ? { intValue: String(v) }
                        : { doubleValue: v }
                      : typeof v === 'boolean'
                        ? { boolValue: v }
                        : { stringValue: v },
                })),
                status: { code: s.status === 'error' ? 2 : 1 },
              })),
            },
          ],
        },
      ],
    };
  }
}

function msToNanos(ms: number): string {
  return (BigInt(Math.round(ms * 1_000)) * 1_000n).toString();
}
