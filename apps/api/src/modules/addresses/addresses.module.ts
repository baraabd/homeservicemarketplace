import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';

// Saved-address module (Sprint 1, slice 2). The repository is provided
// globally by PersistenceModule and TransactionRunner by PrismaModule;
// this module needs AuthenticationModule for the JwtAuthGuard / CsrfGuard
// it applies on every endpoint.
@Module({
  imports: [AuthenticationModule],
  controllers: [AddressesController],
  providers: [AddressesService],
  exports: [AddressesService],
})
export class AddressesModule {}
