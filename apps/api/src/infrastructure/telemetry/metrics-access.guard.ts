import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

import { AppConfigService } from '../../config/app-config.service';

// Sprint 3 — gate /metrics.
//
// The endpoint publishes request volumes, latencies, and error rates per
// route: a free map of which endpoints exist, which are slow, and which are
// currently failing. It was open to anyone, with a code comment deferring the
// problem to "network policy / reverse-proxy rules" — a control this
// repository neither owns, configures, nor tests, which in practice means the
// endpoint was protected by nothing that anyone here can point at.
//
// Health probes are deliberately NOT affected. They live on /health/live and
// /health/ready, are served by a different controller, and this guard is
// mounted only on the metrics controller — so a kubelet, an ALB target group,
// or a Docker HEALTHCHECK keeps working untouched. That separation is the
// reason metrics can be closed at all.
//
// Behaviour:
//   METRICS_TOKEN set      → require `Authorization: Bearer <token>`.
//   unset, non-production  → open, so local runs and `docker compose up` are
//                            unchanged.
//   unset, production      → 404. Not 401: an unauthenticated 401 confirms the
//                            endpoint exists and invites guessing, while a 404
//                            leaves a scanner with nothing. Fail-closed is the
//                            only safe default for an endpoint whose whole
//                            purpose is to describe the system.
@Injectable()
export class MetricsAccessGuard implements CanActivate {
  private readonly logger = new Logger(MetricsAccessGuard.name);
  private warned = false;

  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const token = this.config.get('METRICS_TOKEN');

    if (!token) {
      if (this.config.isProduction) {
        // Logged once, not per scrape: Prometheus polls on an interval and
        // this would otherwise become the loudest line in the log.
        if (!this.warned) {
          this.warned = true;
          this.logger.warn(
            'METRICS_TOKEN is not set; /metrics is disabled in production. ' +
              'Set METRICS_TOKEN and send it as a bearer token to enable scraping.',
          );
        }
        throw new NotFoundException();
      }
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header('authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';

    if (!safeEquals(presented, token)) {
      // Same 404 as the unconfigured case. A wrong token and a missing
      // endpoint are indistinguishable from outside, so this cannot be used to
      // probe whether a token happens to be valid.
      throw new NotFoundException();
    }
    return true;
  }
}

// Constant-time comparison, so the number of leading bytes a guess got right
// cannot be read off the response time. Lengths are compared first because
// timingSafeEqual throws on a length mismatch — that leak is unavoidable and
// harmless, since token length is not the secret.
function safeEquals(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
