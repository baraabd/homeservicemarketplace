// Identifies the kind of party in a conversation. Mirrors the Prisma
// `ConversationParticipantRole` enum so the wire shape is identical to
// the persisted shape.
//
// SEEKER messages are sent by the authenticated Seeker. PROVIDER
// messages will be sent by the booked Provider once the Provider app
// ships. SYSTEM messages are reserved for ops broadcasts (booking
// confirmation, cancellation, etc.) and are not user-authored.
export const ConversationParticipantRole = {
  Seeker: 'SEEKER',
  Provider: 'PROVIDER',
  System: 'SYSTEM',
} as const;
export type ConversationParticipantRole =
  (typeof ConversationParticipantRole)[keyof typeof ConversationParticipantRole];
