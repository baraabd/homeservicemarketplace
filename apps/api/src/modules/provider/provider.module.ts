import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AuthorizationModule } from '../iam/authorization/authorization.module';
import { ProviderController } from './provider.controller';
import { ProviderService } from './provider.service';

// Provider profile module (Sprint 5 slice 5.1). Repositories
// (UserRepository, RoleRepository, ProviderProfileRepository,
// ServiceCategoryRepository) are provided globally by PersistenceModule;
// TransactionRunner by PrismaModule. AuthenticationModule supplies the
// JwtAuthGuard / CsrfGuard guards; AuthorizationModule supplies the
// RolesGuard the controller wires onto every read/write route.
@Module({
  imports: [AuthenticationModule, AuthorizationModule],
  controllers: [ProviderController],
  providers: [ProviderService],
  exports: [ProviderService],
})
export class ProviderModule {}
