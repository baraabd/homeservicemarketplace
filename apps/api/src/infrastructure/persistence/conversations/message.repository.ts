import { Injectable } from '@nestjs/common';
import type {
  ConversationParticipantRole,
  Message,
  Prisma,
  PrismaTx,
} from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateMessageInput {
  conversationId: string;
  senderUserId: string | null;
  senderRole: ConversationParticipantRole;
  body: string;
  idempotencyKey?: string | null;
}

@Injectable()
export class MessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  create(input: CreateMessageInput, tx?: PrismaTx): Promise<Message> {
    return this.db(tx).message.create({
      data: {
        conversationId: input.conversationId,
        senderUserId: input.senderUserId,
        senderRole: input.senderRole,
        body: input.body,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
  }

  /**
   * The message this sender already stored in this conversation under
   * `idempotencyKey` (R12). The sender is part of the lookup, so a key can
   * only ever find the caller's own message.
   */
  findByIdempotencyKey(
    conversationId: string,
    senderUserId: string,
    idempotencyKey: string,
    tx?: PrismaTx,
  ): Promise<Message | null> {
    return this.db(tx).message.findFirst({
      where: { conversationId, senderUserId, idempotencyKey },
    });
  }

  /** A live message of this conversation, or null (R17 read position). */
  findInConversation(
    conversationId: string,
    messageId: string,
    tx?: PrismaTx,
  ): Promise<Message | null> {
    return this.db(tx).message.findFirst({
      where: { id: messageId, conversationId, deletedAt: null },
    });
  }

  // Cursor-paginated, newest-first. The contract returns
  // chronologically (oldest-first) but we paginate from the bottom up
  // (infinite-scroll-up). The service reverses the page so the
  // renderer sees oldest-first.
  listForConversation(
    args: { conversationId: string; take: number; cursor?: string },
    tx?: PrismaTx,
  ): Promise<Message[]> {
    const where: Prisma.MessageWhereInput = {
      conversationId: args.conversationId,
      deletedAt: null,
    };
    return this.db(tx).message.findMany({
      where,
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  // Counts messages in a conversation that arrived strictly AFTER the
  // participant's `lastReadAt` and were NOT sent by them. Drives the
  // unread badge on the conversations list.
  countUnreadForParticipant(
    conversationId: string,
    selfUserId: string,
    lastReadAt: Date | null,
    tx?: PrismaTx,
  ): Promise<number> {
    const where: Prisma.MessageWhereInput = {
      conversationId,
      deletedAt: null,
      // Don't count own messages.
      NOT: { senderUserId: selfUserId },
      ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
    };
    return this.db(tx).message.count({ where });
  }
}
