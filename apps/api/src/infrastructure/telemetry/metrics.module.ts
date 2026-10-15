import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';

import { HttpTelemetryMiddleware } from './http-telemetry.middleware';
import { MetricsAccessGuard } from './metrics-access.guard';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { TelemetryService } from './telemetry.service';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsAccessGuard, TelemetryService, HttpTelemetryMiddleware],
  exports: [MetricsService, TelemetryService],
})
export class MetricsModule implements NestModule {
  // R23 — the HTTP producer is mounted by the module that owns the metrics,
  // so AppModule (coordinator-owned) does not change. See
  // docs/production-readiness/r23/IMPLEMENTATION.md § Wiring.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpTelemetryMiddleware).forRoutes('*');
  }
}
