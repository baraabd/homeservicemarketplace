import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AuthorizationModule } from '../iam/authorization/authorization.module';
import { ProviderActiveGuard } from '../provider/guards/provider-active.guard';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ProviderConversationsController } from './provider-conversations.controller';

// Conversations module (Sprint 3, slice 3.3; Sprint 5.5 added the
// canonical /v1/provider/conversations controller). Repositories
// (Conversation / ConversationParticipant / Message / Booking +
// ProviderProfile) are provided globally by PersistenceModule;
// TransactionRunner by PrismaModule. AuthenticationModule supplies
// the JwtAuthGuard / CsrfGuard guards; AuthorizationModule supplies
// the RolesGuard the canonical provider controller mounts.
//
// Sprint 01 hardening: ProviderActiveGuard is provided locally so the
// canonical /v1/provider/conversations controller can gate on
// status === ACTIVE. The guard's only dependency
// (ProviderProfileRepository) is provided globally by PersistenceModule,
// so we avoid importing ProviderModule and the circular-dependency risk
// that would come with it.
@Module({
  imports: [AuthenticationModule, AuthorizationModule],
  controllers: [ConversationsController, ProviderConversationsController],
  providers: [ConversationsService, ProviderActiveGuard],
  exports: [ConversationsService],
})
export class ConversationsModule {}
