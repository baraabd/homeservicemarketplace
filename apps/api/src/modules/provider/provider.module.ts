import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AuthorizationModule } from '../iam/authorization/authorization.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProviderBidsController } from './bids/provider-bids.controller';
import { ProviderBidsService } from './bids/provider-bids.service';
import { ProviderJobsController } from './feed/provider-jobs.controller';
import { ProviderJobsService } from './feed/provider-jobs.service';
import { ProviderActiveGuard } from './guards/provider-active.guard';
import { ProviderController } from './provider.controller';
import { ProviderService } from './provider.service';

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
  imports: [AuthenticationModule, AuthorizationModule, NotificationsModule],
  controllers: [ProviderController, ProviderJobsController, ProviderBidsController],
  providers: [ProviderService, ProviderJobsService, ProviderBidsService, ProviderActiveGuard],
  exports: [ProviderService, ProviderActiveGuard],
})
export class ProviderModule {}
