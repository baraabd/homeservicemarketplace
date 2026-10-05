import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { NotificationCreatedHandler } from './notification-created.handler';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

// Notifications module (Sprint 3, slice 3.1). The repository is provided
// globally by PersistenceModule. AuthenticationModule supplies the
// JwtAuthGuard / CsrfGuard the controller applies.
//
// `NotificationsService` is exported so other domain modules
// (BidsModule, BookingsModule) can inject it and call
// `createForUser(...)` from inside their existing transactions.
//
// R17-B — NotificationCreatedHandler is exported for the outbox registration
// in AppModule: it announces a notification only after it has committed.
@Module({
  imports: [AuthenticationModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationCreatedHandler],
  exports: [NotificationsService, NotificationCreatedHandler],
})
export class NotificationsModule {}
