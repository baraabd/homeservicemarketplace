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
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ListMessagesQueryDto } from './dto/list-messages.query';
import { SendMessageDto } from './dto/send-message.dto';

// /v1/me/conversations — Seeker-facing chat surface (Sprint 3, slice 3.3).
//
// Read endpoints require JwtAuthGuard. Mutating endpoints
// (create-conversation, send-message, mark-read) additionally require
// CsrfGuard so a stolen access cookie alone cannot drive chat state
// from a hostile origin.
//
// `userId` is sourced exclusively from the authenticated session via
// @CurrentUser. Path / body params are the only client input.
// `senderUserId` and `providerProfileId` are NEVER on the wire — the
// service derives the seeker's identity from the session and resolves
// the provider through the booking.
//
// Foreign conversationId / bookingId always surface as 404 NOT_FOUND
// (via the participant gate), identical to "doesn't exist" — so an
// attacker cannot enumerate other users' chat resources.
@UseGuards(JwtAuthGuard)
@Controller({ path: 'me/conversations', version: '1' })
export class ConversationsController {
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
