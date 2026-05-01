import { Injectable } from '@nestjs/common';
import type {
  ConversationListResponse,
  ConversationOtherParticipant,
  ConversationSummary,
  CreateConversationResponse,
  MarkConversationReadResponse,
  MessageListResponse,
  MessageSummary,
  SendMessageResponse,
} from '@homeservicemarketplace/contracts';
import { ConversationParticipantRole } from '@homeservicemarketplace/database';
import type { Message } from '@homeservicemarketplace/database';

import { BookingRepository } from '../../infrastructure/persistence/bookings/booking.repository';
import {
  ConversationRepository,
  type ConversationWithRelations,
} from '../../infrastructure/persistence/conversations/conversation.repository';
import { ConversationParticipantRepository } from '../../infrastructure/persistence/conversations/conversation-participant.repository';
import { MessageRepository } from '../../infrastructure/persistence/conversations/message.repository';
import { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';

const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly participants: ConversationParticipantRepository,
    private readonly messages: MessageRepository,
    private readonly bookings: BookingRepository,
    private readonly tx: TransactionRunner,
  ) {}

  // ─── list ──────────────────────────────────────────────────────────────────
  async list(userId: string): Promise<ConversationListResponse> {
    const rows = await this.conversations.listForUser({ userId, take: DEFAULT_PAGE_SIZE + 1 });
    const page = rows.slice(0, DEFAULT_PAGE_SIZE);
    const items = await Promise.all(page.map((row) => toSummary(row, userId, this.messages)));
    const nextCursor = rows.length > DEFAULT_PAGE_SIZE ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  // ─── getOrCreateForBooking ─────────────────────────────────────────────────
  // Idempotent. If the seeker already has a conversation tied to this
  // booking, return it. Otherwise create one in a transaction:
  //   1. resolve the booking + assert ownership (foreign bookingId →
  //      404, identical to "doesn't exist", so an attacker cannot
  //      enumerate other seekers' bookings)
  //   2. create the Conversation
  //   3. create the seeker participant (userId = self, role = SEEKER)
  //   4. create the provider participant (providerProfileId = booking
  //      provider, userId nullable, role = PROVIDER)
  //
  // If any step fails, the whole thing rolls back.
  async getOrCreateForBooking(
    userId: string,
    bookingId: string,
  ): Promise<CreateConversationResponse> {
    // Fast path: the conversation already exists.
    const existing = await this.conversations.findExistingForBooking(bookingId, userId);
    if (existing) {
      return { conversation: await toSummary(existing, userId, this.messages) };
    }

    const created = await this.tx.run(async (tx) => {
      // Ownership: the booking must belong to the seeker (and not be
      // soft-deleted).
      const booking = await this.bookings.findOwned(bookingId, userId, tx);
      if (!booking) {
        throw new AppError('NOT_FOUND', 'Booking not found.', 404);
      }

      const conversation = await this.conversations.create(
        { bookingId: booking.id, requestId: booking.requestId },
        tx,
      );

      // Seeker participant — userId is always set because the auth
      // session guarantees a real User.
      await this.participants.create(
        {
          conversationId: conversation.id,
          userId,
          providerProfileId: null,
          role: ConversationParticipantRole.SEEKER,
        },
        tx,
      );

      // Provider participant — userId is nullable because the
      // Provider app is out of scope; the providerProfileId slot is
      // populated so a future Provider sign-up can be linked.
      await this.participants.create(
        {
          conversationId: conversation.id,
          userId: null,
          providerProfileId: booking.providerId,
          role: ConversationParticipantRole.PROVIDER,
        },
        tx,
      );

      return conversation.id;
    });

    const reloaded = await this.conversations.findOwnedByUser(created, userId);
    if (!reloaded) {
      // Should be unreachable — we just created it — but defend
      // against a concurrent race.
      throw new AppError('INTERNAL_ERROR', 'Conversation could not be loaded.', 500);
    }
    return { conversation: await toSummary(reloaded, userId, this.messages) };
  }

  // ─── listMessages ──────────────────────────────────────────────────────────
  async listMessages(
    userId: string,
    conversationId: string,
    args: { limit?: number; cursor?: string },
  ): Promise<MessageListResponse> {
    await this.assertParticipant(userId, conversationId);
    const take = Math.min(Math.max(args.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.messages.listForConversation({
      conversationId,
      take: take + 1,
      cursor: args.cursor,
    });
    const page = rows.slice(0, take);
    // Repository returns newest-first for cursor pagination; the
    // contract ships oldest-first so the renderer can append new
    // messages at the bottom.
    const oldestFirst = [...page].reverse();
    const items = oldestFirst.map((m) => toMessageSummary(m, userId));
    const nextCursor = rows.length > take ? page[page.length - 1].id : null;
    return { items, nextCursor };
  }

  // ─── sendMessage ───────────────────────────────────────────────────────────
  // Inside a transaction: insert the message + bump
  // Conversation.updatedAt so the conversations list re-orders this
  // conversation to the top.
  async sendMessage(
    userId: string,
    conversationId: string,
    body: string,
  ): Promise<SendMessageResponse> {
    await this.assertParticipant(userId, conversationId);
    const created = await this.tx.run(async (tx) => {
      const message = await this.messages.create(
        {
          conversationId,
          senderUserId: userId,
          senderRole: ConversationParticipantRole.SEEKER,
          body,
        },
        tx,
      );
      await this.conversations.bumpUpdatedAt(conversationId, tx);
      return message;
    });
    return { message: toMessageSummary(created, userId) };
  }

  // ─── markRead ──────────────────────────────────────────────────────────────
  async markRead(userId: string, conversationId: string): Promise<MarkConversationReadResponse> {
    const participant = await this.participants.findByConversationAndUser(conversationId, userId);
    if (!participant) {
      throw new AppError('NOT_FOUND', 'Conversation not found.', 404);
    }
    const at = new Date();
    await this.participants.setLastReadAt(participant.id, at);
    return { lastReadAt: at.toISOString() };
  }

  // ─── invariants ────────────────────────────────────────────────────────────
  // Primary ownership gate. Any read / write surface that takes a
  // conversationId must call this first.
  private async assertParticipant(userId: string, conversationId: string): Promise<void> {
    const participant = await this.participants.findByConversationAndUser(conversationId, userId);
    if (!participant) {
      throw new AppError('NOT_FOUND', 'Conversation not found.', 404);
    }
  }
}

// ─── DTO mappers ──────────────────────────────────────────────────────────────

async function toSummary(
  row: ConversationWithRelations,
  selfUserId: string,
  messages: MessageRepository,
): Promise<ConversationSummary> {
  const self = row.participants.find((p) => p.userId === selfUserId);
  const other = row.participants.find((p) => p.userId !== selfUserId);
  const otherProfile = other?.provider;
  const lastMessage = row.messages[0];
  const unreadCount = await messages.countUnreadForParticipant(
    row.id,
    selfUserId,
    self?.lastReadAt ?? null,
  );
  return {
    id: row.id,
    bookingId: row.bookingId,
    requestId: row.requestId,
    otherParticipant: toOtherParticipant(otherProfile),
    lastMessageBody: lastMessage ? lastMessage.body : null,
    lastMessageAt: lastMessage ? lastMessage.createdAt.toISOString() : null,
    unreadCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toOtherParticipant(
  provider: { displayName: string; initials: string; avatarUrl: string | null } | null | undefined,
): ConversationOtherParticipant {
  if (!provider) {
    // Defensive fallback for system-only or malformed conversations —
    // never return undefined / a half-shape on the wire.
    return { displayName: 'Provider', initials: 'P', avatarUrl: null };
  }
  return {
    displayName: provider.displayName,
    initials: provider.initials,
    avatarUrl: provider.avatarUrl,
  };
}

function toMessageSummary(row: Message, selfUserId: string): MessageSummary {
  return {
    id: row.id,
    senderRole: row.senderRole,
    body: row.body,
    sentByMe: row.senderUserId === selfUserId,
    createdAt: row.createdAt.toISOString(),
  };
}
