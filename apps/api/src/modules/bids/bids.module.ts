import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BidsController } from './bids.controller';
import { BidsService } from './bids.service';

// Bids module (Sprint 2, slice 2.1 + 2.2; Sprint 3 slice 3.1 adds
// NotificationsModule import for accept-bid fan-out). Repositories are
// provided globally by PersistenceModule; this module needs
// AuthenticationModule for the JwtAuthGuard it applies on every
// endpoint, and NotificationsModule for the createForUser hook used
// inside the accept-bid transaction.
@Module({
  imports: [AuthenticationModule, NotificationsModule],
  controllers: [BidsController],
  providers: [BidsService],
  exports: [BidsService],
})
export class BidsModule {}
