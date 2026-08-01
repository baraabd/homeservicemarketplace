import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  ConversationListResponse,
  CreateConversationResponse,
  MarkConversationReadResponse,
  MessageListResponse,
  SendMessageResponse,
} from '@homeservicemarketplace/contracts';

import { CurrentUser } from '../iam/authentication/decorators/current-user.decorator';
import { CsrfGuard } from '../iam/authentication/guards/csrf.guard';
import { JwtAuthGuard } from '../iam/authentication/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../iam/authentication/types/authenticated-user';
import { Roles } from '../iam/authorization/decorators/roles.decorator';
import { RolesGuard } from '../iam/authorization/guards/roles.guard';
import { ProviderActiveGuard } from '../provider/guards/provider-active.guard';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ListMessagesQueryDto } from './dto/list-messages.query';
import { SendMessageDto } from './dto/send-message.dto';

// /v1/provider/conversations — Provider-facing chat surface
// (Sprint 5.5, canonical path).
//
// Re-uses the side-aware ConversationsService that the legacy
// /v1/me/conversations controller also calls (commit d7f204e made
// the service handle both seeker- and provider-initiated open-chat
// flows). Only the URL prefix differs.
//
// Class-level guards: JwtAuthGuard + RolesGuard('provider') +
// ProviderActiveGuard. Mutations also CsrfGuard. `userId` taken from
// @CurrentUser; the wire never accepts senderUserId / providerProfileId.
// Foreign conversation surfaces as 404 via the participant gate.
//
// Sprint 01 hardening: ProviderActiveGuard is mounted here to match the
// rest of the provider surface (feed, bids, bookings, wallet,
// earnings). A DRAFT / PENDING_REVIEW / SUSPENDED / REJECTED provider
// may sign in and finish onboarding but must NOT be able to open or
// post in booking chats until an admin approves the profile (status
// === ACTIVE).
@UseGuards(JwtAuthGuard, RolesGuard, ProviderActiveGuard)
@Roles('provider')
@Controller({ path: 'provider/conversations', version: '1' })
export class ProviderConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  list(@CurrentUser() user: AuthenticatedUser): Promise<ConversationListResponse> {
    return this.conversations.list(user.id);
  }

  @UseGuards(CsrfGuard)
  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateConversationDto,
  ): Promise<CreateConversationResponse> {
    return this.conversations.getOrCreateForBooking(user.id, body.bookingId);
  }

  @Get(':conversationId/messages')
  @HttpCode(HttpStatus.OK)
  listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Query() query: ListMessagesQueryDto,
  ): Promise<MessageListResponse> {
    return this.conversations.listMessages(user.id, conversationId, query);
  }

  @UseGuards(CsrfGuard)
  @Post(':conversationId/messages')
  @HttpCode(HttpStatus.CREATED)
  sendMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Body() body: SendMessageDto,
  ): Promise<SendMessageResponse> {
    return this.conversations.sendMessage(user.id, conversationId, body.body);
  }

  @UseGuards(CsrfGuard)
  @Post(':conversationId/read')
  @HttpCode(HttpStatus.OK)
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ): Promise<MarkConversationReadResponse> {
    return this.conversations.markRead(user.id, conversationId);
  }
}
