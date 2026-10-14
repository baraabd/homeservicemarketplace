import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { REQUEST_ID_HEADER } from '../http/request-id.middleware';
import {
  attachTraceContext,
  currentTraceContext,
  isSafeCorrelationId,
  startTraceContext,
  traceContextOf,
} from '../telemetry/trace-context';
import {
  REDACT_PATHS,
  scrubLogArgument,
  scrubText,
  serializeRequest,
  serializeResponse,
} from './redaction';

// R23 — the production pino-http options, kept free of the configuration
// module so tests and the synthetic alert target can boot exactly this
// configuration without a validated environment. LoggerModule adds the
// level from configuration and the dev-only transport.

type WithId = IncomingMessage & { id?: string };

// Every argument of every log call passes through the scrubber, including the
// message string: Nest's Logger forwards `logger.error(`failed: ${err}`)` as a
// plain string, which is exactly where driver errors carry credentials. An
// Error passed first is moved under `err` so pino keeps its error shape.
export function scrubbingLogMethod(
  this: unknown,
  args: unknown[],
  method: (...a: unknown[]) => void,
): void {
  const scrubbed = args.map((arg, i) => {
    if (typeof arg === 'string') return scrubText(arg);
    if (i === 0 && arg instanceof Error) return { err: scrubLogArgument(arg) };
    return scrubLogArgument(arg);
  });
  method.apply(this, scrubbed);
}

// The ratio of requests whose spans are exported. Trace ids are always minted
// (log correlation needs them); sampling only decides export. It stays 0 until
// the coordinator wires a validated configuration key
// (docs/production-readiness/r23/shared-change-requests/CR-02).
let sampleRatio = 0;

export function setTraceSampleRatio(ratio: number): void {
  sampleRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
}

// pino-http runs before RequestIdMiddleware and used to take the raw
// `x-request-id` header: up to the server's header limit of client-chosen
// bytes went into every log line of the request. The id is now validated with
// the same rule as the middleware.
export function generateRequestId(req: IncomingMessage, res: ServerResponse): string {
  const r = req as WithId;
  const headerVal = req.headers[REQUEST_ID_HEADER];
  const fromHeader = Array.isArray(headerVal) ? undefined : headerVal;
  const id = isSafeCorrelationId(r.id)
    ? r.id
    : isSafeCorrelationId(fromHeader)
      ? fromHeader
      : randomUUID();
  r.id = id;
  if (!res.getHeader(REQUEST_ID_HEADER)) res.setHeader(REQUEST_ID_HEADER, id);
  // The trace context is created here, by the first code to see the request,
  // so the per-request child logger can carry it. HttpTelemetryMiddleware
  // reuses it rather than minting a second one.
  if (!traceContextOf(req)) {
    attachTraceContext(
      req,
      startTraceContext({
        kind: 'server',
        traceparent: req.headers.traceparent,
        sampleRatio,
      }),
    );
  }
  return id;
}

export function requestLogBindings(req: IncomingMessage): Record<string, string | undefined> {
  const trace = traceContextOf(req);
  return {
    requestId: (req as WithId).id,
    ...(trace ? { traceId: trace.traceId, spanId: trace.spanId } : {}),
  };
}

// Background jobs have no request; their ids come from the AsyncLocalStorage
// context opened by runInstrumentedJob. Server contexts are skipped because
// requestLogBindings already bound them to the request logger, and a key must
// not appear twice in one line.
export function traceLogMixin(): Record<string, string> {
  const trace = currentTraceContext();
  return trace && trace.kind !== 'server' ? { traceId: trace.traceId, spanId: trace.spanId } : {};
}

export function buildPinoHttpOptions(level: string) {
  return {
    level,
    genReqId: generateRequestId,
    customProps: requestLogBindings,
    // Allowlisted request/response shapes; see redaction.ts.
    serializers: { req: serializeRequest, res: serializeResponse },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    mixin: traceLogMixin,
    hooks: { logMethod: scrubbingLogMethod },
  };
}
