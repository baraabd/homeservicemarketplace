import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

// Bookings module (Sprint 2, slice 2.3). Repositories are provided
// globally by PersistenceModule and TransactionRunner by PrismaModule;
// this module needs AuthenticationModule for the JwtAuthGuard /
// CsrfGuard it applies on the routes.
@Module({
  imports: [AuthenticationModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
