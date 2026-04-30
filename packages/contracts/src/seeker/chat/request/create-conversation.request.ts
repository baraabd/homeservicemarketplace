// POST /v1/me/conversations
//
// Conversations are scoped to a booking — the Seeker can only start a
// conversation against a booking they own. The other participant is
// the booked Provider; the server resolves it from the booking row, so
// the client never names a counter-party directly.
//
// `senderUserId` is intentionally NOT on this contract — `forbidNonWhitelisted`
// rejects payloads that try to smuggle a foreign user id.
export interface CreateConversationRequest {
  bookingId: string;
}
