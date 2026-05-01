import type { ConversationSummary } from './conversation-summary';

// POST /v1/me/conversations returns the conversation summary. If a
// conversation already exists for the supplied booking, the server
// returns the existing row (idempotent get-or-create) — the response
// shape is identical for both cases so the client can route to the
// chat surface uniformly.
export interface CreateConversationResponse {
  conversation: ConversationSummary;
}
