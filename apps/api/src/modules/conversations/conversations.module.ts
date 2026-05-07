import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AuthorizationModule } from '../iam/authorization/authorization.module';
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
@Module({
  imports: [AuthenticationModule, AuthorizationModule],
  controllers: [ConversationsController, ProviderConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
