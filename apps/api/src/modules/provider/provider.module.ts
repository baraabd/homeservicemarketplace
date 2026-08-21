import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AuthorizationModule } from '../iam/authorization/authorization.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AvailableRequestsController } from './available-requests/available-requests.controller';
import { AvailableRequestsService } from './available-requests/available-requests.service';
import {
  ProviderBidsController,
  ProviderBidsLegacyController,
} from './bids/provider-bids.controller';
import { ProviderBidsService } from './bids/provider-bids.service';
import { ProviderBookingsCanonicalController } from './bookings/provider-bookings-canonical.controller';
import { ProviderBookingsController } from './bookings/provider-bookings.controller';
import { ProviderBookingsService } from './bookings/provider-bookings.service';
import { ProviderJobsController } from './feed/provider-jobs.controller';
import { ProviderJobsService } from './feed/provider-jobs.service';
import { AuditModule } from '../iam/audit/audit.module';
import { ProviderActiveGuard } from './guards/provider-active.guard';
import { ProviderOnboardingService } from './onboarding/provider-onboarding.service';
import { ProviderController } from './provider.controller';
import { ProviderService } from './provider.service';
import { ProviderEarningsController } from './wallet/provider-earnings.controller';
import { ProviderEarningsService } from './wallet/provider-earnings.service';
import { ProviderWalletController } from './wallet/provider-wallet.controller';
import { ProviderWalletService } from './wallet/provider-wallet.service';

// Provider module. Hosts every provider-side surface so the
// AuthenticationModule / AuthorizationModule / ProviderActiveGuard
// wiring is shared across slices:
//
//   slice 5.1   ProviderController     — profile + skills + availability
//   slice 5.2   ProviderJobsController — available-jobs feed
//   slice 5.3   ProviderBidsController — submit-bid, my-bids, withdraw
//   slice 5.4+  (TBD)                  — provider booking lifecycle
//   slice 5.6+  (TBD)                  — earnings read model
//
// Repositories (UserRepository, RoleRepository, ProviderProfileRepository,
// ServiceCategoryRepository, ServiceRequestRepository,
// ServiceRequestEventRepository, BidRepository) are provided globally by
// PersistenceModule; TransactionRunner by PrismaModule;
// NotificationsService by NotificationsModule.
@Module({
  // AuditModule: the onboarding service writes a PROVIDER_ONBOARDING_SUBMITTED
  // audit row inside the same transaction as the state transition.
  imports: [AuthenticationModule, AuthorizationModule, NotificationsModule, AuditModule],
  controllers: [
    ProviderController,
    ProviderJobsController,
    AvailableRequestsController,
    ProviderBidsController,
    ProviderBidsLegacyController,
    ProviderBookingsController,
    ProviderBookingsCanonicalController,
    ProviderWalletController,
    ProviderEarningsController,
  ],
  providers: [
    ProviderService,
    ProviderJobsService,
    AvailableRequestsService,
    ProviderBidsService,
    ProviderBookingsService,
    ProviderWalletService,
    ProviderEarningsService,
    ProviderActiveGuard,
    // Phase 4 — DRAFT → submit-for-review → PENDING_REVIEW.
    ProviderOnboardingService,
  ],
  exports: [ProviderService, ProviderActiveGuard, ProviderOnboardingService],
})
export class ProviderModule {}
