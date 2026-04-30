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
  findByConversationAndUser(
    conversationId: string,
    userId: string,
    tx?: PrismaTx,
  ): Promise<ConversationParticipant | null> {
    return this.db(tx).conversationParticipant.findFirst({
      where: { conversationId, userId },
    });
  }

  // Sets the seeker participant's lastReadAt to `now` so the unread
  // count derived against the message stream goes to zero.
  setLastReadAt(participantId: string, at: Date, tx?: PrismaTx): Promise<ConversationParticipant> {
    return this.db(tx).conversationParticipant.update({
      where: { id: participantId },
      data: { lastReadAt: at },
    });
  }
}
