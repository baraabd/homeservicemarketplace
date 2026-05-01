import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AuthorizationModule } from '../iam/authorization/authorization.module';
import { ProviderActiveGuard } from './guards/provider-active.guard';
import { ProviderController } from './provider.controller';
import { ProviderService } from './provider.service';

// Provider profile module (Sprint 5 slice 5.1, hardened in 5.1.2).
// Repositories (UserRepository, RoleRepository, ProviderProfileRepository,
// ServiceCategoryRepository) are provided globally by PersistenceModule;
// TransactionRunner by PrismaModule. AuthenticationModule supplies the
// JwtAuthGuard / CsrfGuard guards; AuthorizationModule supplies the
// RolesGuard the controller wires onto every read/write route.
//
// `ProviderActiveGuard` is exported for the Sprint 5.2 marketplace
// endpoints (available-requests feed, submit-bid, my-bids). It is NOT
// mounted here in 5.1.2.
@Module({
  imports: [AuthenticationModule, AuthorizationModule],
  controllers: [ProviderController],
  providers: [ProviderService, ProviderActiveGuard],
  exports: [ProviderService, ProviderActiveGuard],
})
export class ProviderModule {}
