import { Controller, Get, Header, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { MetricsService } from './metrics.service';

// Prometheus scrapes /metrics on a fixed interval; the global rate limit would
// otherwise start dropping scrapes during bursts. Exposure of /metrics itself
// is expected to be constrained by network policy / reverse-proxy rules —
// see Residual Risks in docs/infrastructure.md.
@SkipThrottle()
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
