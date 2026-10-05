import { Injectable } from '@nestjs/common';
import type {
  ConversationParticipant,
  ConversationParticipantRole,
  PrismaTx,
} from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateParticipantInput {
  conversationId: string;
  userId: string | null;
  providerProfileId: string | null;
  role: ConversationParticipantRole;
}

@Injectable()
export class ConversationParticipantRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  create(input: CreateParticipantInput, tx?: PrismaTx): Promise<ConversationParticipant> {
    return this.db(tx).conversationParticipant.create({
      data: {
        conversationId: input.conversationId,
        userId: input.userId,
        providerProfileId: input.providerProfileId,
        role: input.role,
      },
    });
  }

  // Primary ownership gate. Returns null if the user is not a
  // participant of the conversation; service maps that to 404.
  /**
   * The user's participation in a conversation. With `role`, only as that
   * side: the seeker routes act for the SEEKER side and the provider routes
   * for the PROVIDER side (R12). Without it, either side, which only the
   * realtime room gate uses.
   */
  findByConversationAndUser(
    conversationId: string,
    userId: string,
    role?: ConversationParticipantRole,
    tx?: PrismaTx,
  ): Promise<ConversationParticipant | null> {
    return this.db(tx).conversationParticipant.findFirst({
      where: { conversationId, userId, ...(role ? { role } : {}) },
    });
  }

  /**
   * Moves the participant's read position forward to `at`, never backwards
   * (R17). A late request from another tab, or a clock behind another
   * replica's, cannot un-read what a newer request already read. Returns the
   * row as stored after the call.
   */
  async advanceLastReadAt(
    participantId: string,
    at: Date,
    tx?: PrismaTx,
  ): Promise<ConversationParticipant> {
    const db = this.db(tx);
    await db.conversationParticipant.updateMany({
      where: { id: participantId, OR: [{ lastReadAt: null }, { lastReadAt: { lt: at } }] },
      data: { lastReadAt: at },
    });
    return db.conversationParticipant.findUniqueOrThrow({ where: { id: participantId } });
  }
}
