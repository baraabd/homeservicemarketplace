import { Controller, Get, HttpCode, HttpStatus, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

import { HealthService } from './health.service';

// Orchestrator probes (k8s liveness/readiness, ELB, Docker healthcheck) poll
// these endpoints every few seconds. The global ThrottlerGuard would otherwise
// return 429 under bursty probe load and make the pod appear unhealthy.
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  live() {
    return this.health.liveness();
  }

  @Get('ready')
  async ready(@Res() res: Response): Promise<void> {
    const report = await this.health.readiness();
    res.status(report.ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json(report);
  }
}
