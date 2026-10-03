import { Injectable } from '@nestjs/common';
import { ProviderCapability } from '@homeservicemarketplace/contracts';
import { ConversationParticipantRole } from '@homeservicemarketplace/database';

import { ConversationParticipantRepository } from '../../infrastructure/persistence/conversations/conversation-participant.repository';
import { ProviderProfileRepository } from '../../infrastructure/persistence/bids/provider-profile.repository';
import { SessionRepository } from '../../infrastructure/persistence/iam/session.repository';
import { ProviderCapabilityService } from '../provider/capability/provider-capability.service';

/** Whether a user may receive a conversation's events, and as which side. */
export type ConversationReceipt =
  | { allowed: false }
  | { allowed: true; side: 'SEEKER' }
  | { allowed: true; side: 'PROVIDER'; providerProfileId: string | null };

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
    private readonly capabilities: ProviderCapabilityService,
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

  /**
   * R12 — may this user receive this conversation's events?
   *
   * The same answer REST gives for reading it. A seeker-side participant reads
   * through /v1/me/conversations (session only). A provider-side participant
   * reads through /v1/provider/conversations, which also requires the provider
   * to be allowed to manage bookings; the realtime room must not be a way
   * round that. Both participants may share the room.
   */
  async mayReceiveConversation(
    userId: string,
    conversationId: string,
  ): Promise<ConversationReceipt> {
    const participant = await this.participants.findByConversationAndUser(conversationId, userId);
    if (!participant) return { allowed: false };
    if (participant.role === ConversationParticipantRole.SEEKER) {
      return { allowed: true, side: 'SEEKER' };
    }
    const working = await this.capabilities.can(userId, ProviderCapability.ManageBookings);
    if (!working) return { allowed: false };
    return { allowed: true, side: 'PROVIDER', providerProfileId: participant.providerProfileId };
  }

  async userIsParticipant(userId: string, conversationId: string): Promise<boolean> {
    const participant = await this.participants.findByConversationAndUser(conversationId, userId);
    return participant !== null;
  }
}
