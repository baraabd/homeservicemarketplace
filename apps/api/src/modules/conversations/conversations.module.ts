import { Module } from '@nestjs/common';

import { AuthenticationModule } from '../iam/authentication/authentication.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

// Conversations module (Sprint 3, slice 3.3). Repositories
// (Conversation / ConversationParticipant / Message / Booking) are
// provided globally by PersistenceModule; TransactionRunner by
// PrismaModule. AuthenticationModule supplies the JwtAuthGuard /
// CsrfGuard guards.
@Module({
  imports: [AuthenticationModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
