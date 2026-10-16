import { DiagnosticsScheduler } from './diagnostics.scheduler';
import { StorageModule } from '../storage/storage.module';
import { MailModule } from '../mail/mail.module';
import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [StorageModule, MailModule],
  controllers: [HealthController],
  providers: [HealthService, DiagnosticsScheduler],
  exports: [HealthService],
})
export class HealthModule {}
