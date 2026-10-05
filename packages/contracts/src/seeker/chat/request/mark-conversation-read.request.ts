// POST /v1/me/conversations/:conversationId/read
// POST /v1/provider/conversations/:conversationId/read
//
// R17 — `upToMessageId` (optional) names the newest message the reader has
// actually been shown. The participant's `lastReadAt` becomes that message's
// stored `createdAt`, so a message that arrived after it stays unread. The
// message must belong to the conversation (otherwise 404). `lastReadAt` never
// moves backwards: an older id, or a late request from another tab, leaves a
// newer read position in place.
//
// Without a body the server marks the conversation read as of now, as before.
export interface MarkConversationReadRequest {
  upToMessageId?: string;
}
