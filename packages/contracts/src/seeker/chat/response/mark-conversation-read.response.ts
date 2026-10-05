// POST /v1/me/conversations/:id/read returns the participant's `lastReadAt`
// after the call. Without `upToMessageId` it is a fresh "now"; with it, it is
// the later of the stored position and that message's `createdAt` (R17).
export interface MarkConversationReadResponse {
  lastReadAt: string;
}
