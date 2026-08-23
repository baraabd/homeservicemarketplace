import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { AuthorizationModule } from '../iam/authorization/authorization.module';
import { ProviderCapabilityModule } from '../provider/capability/provider-capability.module';
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
// Sprint 01 hardening: the canonical /v1/provider/conversations controller
// gates on ProviderActiveGuard.
//
// Sprint 7: that guard used to be declared LOCALLY here, on the reasoning that
// its only dependency (ProviderProfileRepository) was global, so importing
// ProviderModule — and its circular-dependency risk — could be avoided. Sprint
// 7 gave the guard a non-global dependency and that local copy became
// unconstructable, crashing the whole application at boot.
//
// It now comes from ProviderCapabilityModule, which owns the guard and the
// service it needs. That module depends only on PrismaService, so this import
// carries none of the cycle risk the original comment was avoiding.
@Module({
  imports: [AuthenticationModule, AuthorizationModule, ProviderCapabilityModule],
  controllers: [ConversationsController, ProviderConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
