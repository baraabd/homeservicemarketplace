// POST /v1/me/conversations/:conversationId/messages
//
// Text-only. `body` is trimmed and length-validated server-side
// (1–4000 chars). The sender is taken from the authenticated session
// — `senderUserId` / `senderRole` are NOT accepted from the wire.
export interface SendMessageRequest {
  body: string;
}
