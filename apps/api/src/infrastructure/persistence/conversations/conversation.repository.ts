import { Injectable } from '@nestjs/common';
import type {
  Conversation,
  ConversationParticipant,
  Message,
  Prisma,
  PrismaTx,
  ProviderProfile,
} from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

// Eager-loaded shape returned by the list / detail finders. Carries the
// participants (so the renderer can find the "other" party for the
// avatar pill) and the most recent message (for the preview line).
export type ConversationWithRelations = Conversation & {
  participants: (ConversationParticipant & { provider: ProviderProfile | null })[];
  messages: Message[];
};

export interface CreateConversationInput {
  bookingId: string | null;
  requestId: string | null;
}

@Injectable()
export class ConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  create(input: CreateConversationInput, tx?: PrismaTx): Promise<Conversation> {
    return this.db(tx).conversation.create({
      data: {
        bookingId: input.bookingId,
        requestId: input.requestId,
      },
    });
  }

  // Returns the conversation only when the requesting user is a
  // participant. The participant join is the primary ownership gate;
  // a non-participant gets `null` and the service maps that to 404.
  findOwnedByUser(
    conversationId: string,
    userId: string,
    tx?: PrismaTx,
  ): Promise<ConversationWithRelations | null> {
    return this.db(tx).conversation.findFirst({
      where: {
        id: conversationId,
        deletedAt: null,
        participants: { some: { userId, conversationId } },
      },
      include: {
        participants: { include: { provider: true } },
        // Most recent message powers the list preview line; only one
        // is needed.
        messages: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
    });
  }

  findExistingForBooking(
    bookingId: string,
    userId: string,
    tx?: PrismaTx,
  ): Promise<ConversationWithRelations | null> {
    return this.db(tx).conversation.findFirst({
      where: {
        bookingId,
        deletedAt: null,
        participants: { some: { userId } },
      },
      include: {
        participants: { include: { provider: true } },
        messages: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
    });
  }

  // List every non-deleted conversation the user participates in, in
  // active-newest-first order (driven by Conversation.updatedAt which
  // is bumped whenever a new message is sent).
  listForUser(
    args: {
      userId: string;
      take: number;
      cursor?: string;
    },
    tx?: PrismaTx,
  ): Promise<ConversationWithRelations[]> {
    const where: Prisma.ConversationWhereInput = {
      deletedAt: null,
      participants: { some: { userId: args.userId } },
    };
    return this.db(tx).conversation.findMany({
      where,
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: {
        participants: { include: { provider: true } },
        messages: {
          where: { deletedAt: null },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
    });
  }

  // Bumped on every new message so the conversations list stays in
  // freshness order without joining through Message.
  bumpUpdatedAt(conversationId: string, tx?: PrismaTx): Promise<Conversation> {
    return this.db(tx).conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
  }
}
