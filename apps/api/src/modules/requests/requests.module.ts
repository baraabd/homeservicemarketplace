import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

// Service-request module (Sprint 1, slice 3). The repositories are
// provided globally by PersistenceModule and TransactionRunner by
// PrismaModule; this module needs AuthenticationModule for the
// JwtAuthGuard / CsrfGuard it applies on every endpoint.
@Module({
  imports: [AuthenticationModule],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
