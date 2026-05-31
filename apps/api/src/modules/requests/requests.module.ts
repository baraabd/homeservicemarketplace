import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

// Service-request module (Sprint 1, slice 3). The repositories are
// provided globally by PersistenceModule and TransactionRunner by
// PrismaModule; this module needs AuthenticationModule for the
// JwtAuthGuard / CsrfGuard it applies on every endpoint.
//
// Sprint 7.x — also imports NotificationsModule so create() can fan
// out REQUEST_AVAILABLE notifications to matching providers via
// NotificationsService.createForUser. RealtimeEventsPublisher is
// `@Global` (RealtimeModule), so no import is needed for the
// request.available realtime publish.
@Module({
  imports: [AuthenticationModule, NotificationsModule],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
