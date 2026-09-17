import { Module } from '@nestjs/common';
import { DisputeIntakeController } from './dispute-intake.controller';
import { DisputeIntakeRepository } from './dispute-intake.repository';
import { DisputeIntakeService } from './dispute-intake.service';
import { DisputeIntakeEventsHandler } from './dispute-intake.events-handler';

@Module({
  controllers: [DisputeIntakeController],
  providers: [DisputeIntakeRepository, DisputeIntakeService, DisputeIntakeEventsHandler],
  exports: [DisputeIntakeEventsHandler],
})
export class DisputesModule {}
