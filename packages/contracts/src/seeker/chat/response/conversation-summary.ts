// Lightweight provider summary embedded in the conversation row so the
// list can render the avatar pill without a second fetch. `userId` is
// NOT exposed (same PII boundary as ProviderBidSummary on the bids
// contract).
export interface ConversationOtherParticipant {
  displayName: string;
  initials: string;
  avatarUrl: string | null;
}

// Row shape returned by GET /v1/me/conversations. `lastMessageBody` is
// populated when the conversation has any non-soft-deleted messages,
// so the list can show a preview line. `unreadCount` is derived from
// the participant's `lastReadAt` against the message stream.
export interface ConversationSummary {
  id: string;
  bookingId: string | null;
  requestId: string | null;
  otherParticipant: ConversationOtherParticipant;
  lastMessageBody: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}
