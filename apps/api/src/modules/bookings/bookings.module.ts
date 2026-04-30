import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

// Bookings module (Sprint 2, slice 2.3; Sprint 3 slice 3.1 adds
// NotificationsModule import for cancel-booking fan-out). Repositories
// are provided globally by PersistenceModule and TransactionRunner by
// PrismaModule; this module needs AuthenticationModule for the
// JwtAuthGuard / CsrfGuard guards, and NotificationsModule for the
// createForUser hook used inside the cancel-booking transaction.
@Module({
  imports: [AuthenticationModule, NotificationsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
