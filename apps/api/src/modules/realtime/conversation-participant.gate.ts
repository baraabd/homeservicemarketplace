import { Injectable } from '@nestjs/common';

import { ConversationParticipantRepository } from '../../infrastructure/persistence/conversations/conversation-participant.repository';
import { ProviderProfileRepository } from '../../infrastructure/persistence/bids/provider-profile.repository';
import { SessionRepository } from '../../infrastructure/persistence/iam/session.repository';

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
    private readonly sessions: SessionRepository,
  ) {}

  // D-4 — used to revalidate a security-sensitive socket event. The socket
  // does not keep the raw access token, so the jti is read back from the
  // session row and fed through the same assertSessionActive the handshake
  // used. A revoked or missing session yields null, which cannot match and is
  // therefore rejected.
  async currentJtiForSession(sessionId: string): Promise<string | null> {
    const row = await this.sessions.findByIdWithUserStanding(sessionId);
    if (!row || row.revokedAt !== null) return null;
    return row.currentJti;
  }

  async findProviderProfileId(userId: string): Promise<string | null> {
    const profile = await this.providerProfiles.findByUserId(userId);
    return profile?.id ?? null;
  }

  async userIsParticipant(userId: string, conversationId: string): Promise<boolean> {
    const participant = await this.participants.findByConversationAndUser(conversationId, userId);
    return participant !== null;
  }
}
