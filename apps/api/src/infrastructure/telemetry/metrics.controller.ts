import { Controller, Get, Header, Res, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { MetricsAccessGuard } from './metrics-access.guard';
import { MetricsService } from './metrics.service';

// Prometheus scrapes /metrics on a fixed interval; the global rate limit would
// otherwise start dropping scrapes during bursts.
//
// Sprint 3 — exposure is no longer deferred to "network policy / reverse-proxy
// rules". That was a control this repository does not own, configure, or test,
// which meant in practice the endpoint was guarded by nothing anyone here
// could point at. MetricsAccessGuard requires a bearer token; see its header
// for the unset-token behaviour and for why health probes are untouched.
@SkipThrottle()
@UseGuards(MetricsAccessGuard)
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', this.metrics.contentType());
    res.send(await this.metrics.metrics());
  }
}
