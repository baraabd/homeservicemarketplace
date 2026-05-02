import { Global, Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { RealtimeEventsController } from './realtime-events.controller';
import { RealtimeEventsPublisher } from './realtime-events.publisher';

// @Global so service-layer modules (NotificationsService etc.)
// can inject `RealtimeEventsPublisher` without each module importing
// RealtimeModule explicitly. This keeps the realtime layer
// additive — the existing service code only needs to call
// `.publishFor()` post-commit.
@Global()
@Module({
  imports: [AuthenticationModule],
  controllers: [RealtimeEventsController],
  providers: [RealtimeEventsPublisher],
  exports: [RealtimeEventsPublisher],
})
export class RealtimeModule {}
