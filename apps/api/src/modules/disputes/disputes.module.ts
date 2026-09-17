import { Module } from '@nestjs/common';
import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { DisputeIntakeController } from './dispute-intake.controller';
import { DisputeIntakeRepository } from './dispute-intake.repository';
import { DisputeIntakeService } from './dispute-intake.service';
import { DisputeIntakeEventsHandler } from './dispute-intake.events-handler';

@Module({
  imports: [AuthenticationModule],
  controllers: [DisputeIntakeController],
  providers: [DisputeIntakeRepository, DisputeIntakeService, DisputeIntakeEventsHandler],
  exports: [DisputeIntakeEventsHandler],
})
export class DisputesModule {}
