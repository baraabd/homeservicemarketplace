import { Global, Module } from '@nestjs/common';

import { MetricsAccessGuard } from './metrics-access.guard';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsAccessGuard],
  exports: [MetricsService],
})
export class MetricsModule {}
