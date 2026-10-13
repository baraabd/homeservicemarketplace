import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { httpRouteLabel } from './label-bounds';
import { TelemetryService } from './telemetry.service';
import {
  attachTraceContext,
  runWithTraceContext,
  startTraceContext,
  traceContextOf,
} from './trace-context';

// R23 — records http_requests_total and http_request_duration_seconds.
//
// Both metrics were declared in Sprint 1 and exported on /metrics, but nothing
// ever incremented them: every API availability or latency alert written
// against them would have evaluated over an empty series and stayed silent
// through a real outage. This middleware is the missing producer.
//
// The route label is the matched pattern, read when the response finishes
// (Express sets req.route only after routing). The scrape endpoint itself is
// not recorded: Prometheus polling its own target would dominate the request
// rate of an idle instance and dilute every ratio computed from it.

const SELF_PATHS = new Set(['/metrics']);

@Injectable()
export class HttpTelemetryMiddleware implements NestMiddleware {
  constructor(private readonly telemetry: TelemetryService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // originalUrl, not path: inside a mounted middleware `req.path` is
    // relative to the mount point.
    const url = req.originalUrl ?? req.url ?? '';
    const cut = url.search(/[?#]/u);
    if (SELF_PATHS.has(cut === -1 ? url : url.slice(0, cut))) {
      next();
      return;
    }

    // Normally created by the logger's genReqId, which runs first. Created
    // here only when the logger is absent (tests, a stripped-down app).
    let trace = traceContextOf(req);
    if (!trace) {
      trace = startTraceContext({
        kind: 'server',
        traceparent: req.headers.traceparent,
        sampleRatio: 0,
      });
      attachTraceContext(req, trace);
    }

    const startMs = Date.now();
    const start = process.hrtime.bigint();
    let recorded = false;
    const record = (aborted: boolean) => {
      if (recorded) return;
      recorded = true;
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.telemetry.recordHttp(
        {
          method: req.method,
          route: httpRouteLabel(req),
          // 499: the client closed the connection before a response was sent
          // (nginx convention). Kept apart from 5xx so a flaky mobile network
          // does not burn the availability budget.
          status: aborted ? 499 : res.statusCode,
          durationSeconds,
        },
        trace,
        startMs,
      );
    };
    res.once('finish', () => record(false));
    res.once('close', () => record(!res.writableFinished));

    runWithTraceContext(trace, () => next());
  }
}
