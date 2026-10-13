import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

// R23 — trace context without a tracing SDK.
//
// The repository pins no OpenTelemetry SDK, and adding one is a lockfile change
// owned by the coordinator (docs/production-readiness/r23/shared-change-requests).
// What every boundary needs today is much smaller: a W3C-compatible trace id
// that is carried from an inbound request (or minted for a background job)
// into every log line and span written while that unit of work runs. The
// formats below are the W3C Trace Context level 1 wire formats, so an SDK added
// later reads and continues the same ids instead of starting a second scheme.
//
// Inbound values are untrusted. A `traceparent` that is not exactly the
// version-00 shape is discarded rather than repaired, and its `sampled` flag is
// ignored unless the caller opts in: an anonymous client that could force
// sampling could also force the exporter's whole budget onto its own traffic.

export type TraceKind = 'server' | 'job' | 'internal' | 'client';

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly sampled: boolean;
  readonly kind: TraceKind;
}

export interface ParsedTraceparent {
  traceId: string;
  parentSpanId: string;
  sampled: boolean;
}

// Exactly version 00: 2 + 1 + 32 + 1 + 16 + 1 + 2 = 55 characters. Later
// versions may append fields; the specification lets a version-00 parser
// reject them, and rejecting is the bounded choice.
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/u;
const ZERO_TRACE = '0'.repeat(32);
const ZERO_SPAN = '0'.repeat(16);

export function parseTraceparent(value: unknown): ParsedTraceparent | null {
  // Repeated headers arrive as an array; two parents are ambiguous, so neither
  // is continued.
  if (typeof value !== 'string' || value.length !== 55) return null;
  const match = TRACEPARENT.exec(value);
  if (!match) return null;
  const [, traceId, parentSpanId, flags] = match;
  if (traceId === ZERO_TRACE || parentSpanId === ZERO_SPAN) return null;
  return { traceId, parentSpanId, sampled: (parseInt(flags, 16) & 0x01) === 0x01 };
}

export function formatTraceparent(
  ctx: Pick<TraceContext, 'traceId' | 'spanId' | 'sampled'>,
): string {
  return `00-${ctx.traceId}-${ctx.spanId}-${ctx.sampled ? '01' : '00'}`;
}

export function newTraceId(): string {
  let id = randomBytes(16).toString('hex');
  while (id === ZERO_TRACE) id = randomBytes(16).toString('hex');
  return id;
}

export function newSpanId(): string {
  let id = randomBytes(8).toString('hex');
  while (id === ZERO_SPAN) id = randomBytes(8).toString('hex');
  return id;
}

/**
 * Deterministic ratio sampler: the decision is a function of the trace id, so
 * every process that sees the same trace makes the same choice without
 * coordinating. Uses the low 32 bits of the id (randomly generated).
 */
export function isSampledByRatio(traceId: string, ratio: number): boolean {
  if (!(ratio > 0)) return false;
  if (ratio >= 1) return true;
  const low = parseInt(traceId.slice(-8), 16);
  return low / 0x1_0000_0000 < ratio;
}

export interface StartTraceOptions {
  kind: TraceKind;
  /** Raw inbound `traceparent` header, if any. Validated here. */
  traceparent?: unknown;
  sampleRatio: number;
  /** Honor the inbound sampled flag. Only for trusted internal callers. */
  trustInboundSampling?: boolean;
}

export function startTraceContext(opts: StartTraceOptions): TraceContext {
  const parent = parseTraceparent(opts.traceparent);
  const traceId = parent?.traceId ?? newTraceId();
  const sampled =
    parent && opts.trustInboundSampling
      ? parent.sampled
      : isSampledByRatio(traceId, opts.sampleRatio);
  return {
    traceId,
    spanId: newSpanId(),
    parentSpanId: parent?.parentSpanId ?? null,
    sampled,
    kind: opts.kind,
  };
}

export function childTraceContext(parent: TraceContext, kind: TraceKind): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: newSpanId(),
    parentSpanId: parent.spanId,
    sampled: parent.sampled,
    kind,
  };
}

const storage = new AsyncLocalStorage<TraceContext>();

export function currentTraceContext(): TraceContext | undefined {
  return storage.getStore();
}

export function runWithTraceContext<T>(ctx: TraceContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

// Request-scoped attachment. pino-http creates its per-request child logger
// before any Nest middleware runs, so the logger reads the context from the
// request object rather than from AsyncLocalStorage.
const REQUEST_TRACE = Symbol.for('hsm.telemetry.traceContext');

type Carrier = object & { [REQUEST_TRACE]?: TraceContext };

export function attachTraceContext(carrier: object, ctx: TraceContext): void {
  (carrier as Carrier)[REQUEST_TRACE] = ctx;
}

export function traceContextOf(carrier: object | null | undefined): TraceContext | undefined {
  return carrier ? (carrier as Carrier)[REQUEST_TRACE] : undefined;
}

// Correlation id accepted from `x-request-id`. Mirrors the pattern in
// infrastructure/http/request-id.middleware.ts; both must accept the same set,
// or the id in the log and the id echoed to the client diverge.
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._-]{1,128}$/u;

export function isSafeCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_CORRELATION_ID.test(value);
}
