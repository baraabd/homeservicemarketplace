import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

// Service-request module (Sprint 1, slice 3). The repositories are
// provided globally by PersistenceModule and TransactionRunner by
// PrismaModule; this module needs AuthenticationModule for the
// JwtAuthGuard / CsrfGuard it applies on every endpoint.
//
// Sprint 6 — NotificationsModule is no longer imported. create() enqueues an
// outbox event instead of fanning out inline, so this module no longer needs
// to know how a notification is written or who receives one. The delivery
// side lives in ./outbox (RequestOutboxModule), wired to the worker by
// AppModule. OutboxRepository comes from the @Global OutboxModule.
@Module({
  imports: [AuthenticationModule],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
