import type { MessageSummary } from './message-summary';

// POST /v1/me/conversations/:id/messages returns the persisted message
// (with `sentByMe: true`) so the optimistic-pending UI can be
// reconciled against the server-issued `id` + `createdAt`.
export interface SendMessageResponse {
  message: MessageSummary;
}
