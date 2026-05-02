import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AuthorizationModule } from '../iam/authorization/authorization.module';
import { ProviderJobsController } from './feed/provider-jobs.controller';
import { ProviderJobsService } from './feed/provider-jobs.service';
import { ProviderActiveGuard } from './guards/provider-active.guard';
import { ProviderController } from './provider.controller';
import { ProviderService } from './provider.service';

// Provider module. Hosts every provider-side surface so the
// AuthenticationModule / AuthorizationModule / ProviderActiveGuard
// wiring is shared across slices:
//
//   slice 5.1   ProviderController   — profile + skills + availability
//   slice 5.2   ProviderJobsController — available-jobs feed
//   slice 5.3+  (TBD)                 — submit-bid, my-bids
//   slice 5.4+  (TBD)                 — provider booking lifecycle
//   slice 5.6+  (TBD)                 — earnings read model
//
// Repositories (UserRepository, RoleRepository, ProviderProfileRepository,
// ServiceCategoryRepository, ServiceRequestRepository, BidRepository)
// are provided globally by PersistenceModule; TransactionRunner by
// PrismaModule.
@Module({
  imports: [AuthenticationModule, AuthorizationModule],
  controllers: [ProviderController, ProviderJobsController],
  providers: [ProviderService, ProviderJobsService, ProviderActiveGuard],
  exports: [ProviderService, ProviderActiveGuard],
})
export class ProviderModule {}
