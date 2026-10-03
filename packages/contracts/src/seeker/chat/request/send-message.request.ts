// POST /v1/me/conversations/:conversationId/messages
//
// Text-only. `body` is trimmed and length-validated server-side
// (1–4000 chars). The sender is taken from the authenticated session
// — `senderUserId` / `senderRole` are NOT accepted from the wire.
//
// R12 — `idempotencyKey` (optional, 16–128 characters of [A-Za-z0-9_-]) names
// one logical send. Sending again with the same key and the same body returns
// the message already stored (`replayed: true`) instead of storing it twice;
// the same key with a different body is refused (409). The key is scoped to
// the sender in this conversation. A new message needs a new key; keyless
// sends behave as before.
export interface SendMessageRequest {
  body: string;
  idempotencyKey?: string;
}
