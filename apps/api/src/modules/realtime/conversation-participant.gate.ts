import { Injectable } from '@nestjs/common';

import { ConversationParticipantRepository } from '../../infrastructure/persistence/conversations/conversation-participant.repository';
import { ProviderProfileRepository } from '../../infrastructure/persistence/bids/provider-profile.repository';

// Sprint 7.0 (refined): minimal authorization helper used by the
// Socket.IO gateway to decide:
//   1. Whether the connecting user owns a provider profile (so the
//      gateway can server-join `provider:{profileId}`).
//   2. Whether the user is a participant of a conversation before
//      a `subscribe:conversation` joins `conversation:{id}`.
//
// Wraps the existing repositories the REST surface uses for the
// same checks — same gate, same answer; no separate authz path.
@Injectable()
export class ConversationParticipantGate {
  constructor(
    private readonly providerProfiles: ProviderProfileRepository,
    private readonly participants: ConversationParticipantRepository,
  ) {}

  async findProviderProfileId(userId: string): Promise<string | null> {
    const profile = await this.providerProfiles.findByUserId(userId);
    return profile?.id ?? null;
  }

  async userIsParticipant(userId: string, conversationId: string): Promise<boolean> {
    const participant = await this.participants.findByConversationAndUser(conversationId, userId);
    return participant !== null;
  }
}
