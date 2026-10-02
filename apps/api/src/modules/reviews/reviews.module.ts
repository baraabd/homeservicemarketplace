import { Module } from '@nestjs/common';

import { BookingReviewRepository } from '../../infrastructure/persistence/reviews/booking-review.repository';
import { AuditModule } from '../iam/audit/audit.module';
import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AuthorizationModule } from '../iam/authorization/authorization.module';
import { AdminReviewsService } from './admin-reviews.service';
import { BookingReviewsService } from './booking-reviews.service';
import { AdminReviewsController, BookingReviewsController } from './reviews.controllers';

// R11 — customer reviews of completed bookings, and their moderation.
//
// Not provider verification, not onboarding review and not dispute review:
// this module is the seeker's review of the provider who did the job.
//
// The repository is provided here rather than globally: nothing outside this
// module writes a review. Booking completion recomputes the completed-jobs
// count through the booking repository it already holds.
@Module({
  imports: [AuthenticationModule, AuthorizationModule, AuditModule],
  controllers: [BookingReviewsController, AdminReviewsController],
  providers: [BookingReviewRepository, BookingReviewsService, AdminReviewsService],
  exports: [BookingReviewsService],
})
export class ReviewsModule {}
