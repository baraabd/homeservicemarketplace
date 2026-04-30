import type { ConversationParticipantRole } from '../enums/conversation-participant-role';

// One row on the messages list. The renderer keys bubble alignment
// off `sentByMe` (true = right-aligned amber bubble for the seeker;
// false = left-aligned slate bubble for the provider / system). The
// `senderUserId` is intentionally NOT exposed — surfacing it would
// leak the Provider's user id once they sign up.
export interface MessageSummary {
  id: string;
  senderRole: ConversationParticipantRole;
  body: string;
  sentByMe: boolean;
  createdAt: string;
}
