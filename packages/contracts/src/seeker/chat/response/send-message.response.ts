import type { MessageSummary } from './message-summary';

// POST /v1/me/conversations/:id/messages returns the persisted message
// (with `sentByMe: true`) so the optimistic-pending UI can be
// reconciled against the server-issued `id` + `createdAt`.
//
// R12 — `replayed` is true when the request's idempotency key named a message
// that was already stored; nothing new was written.
export interface SendMessageResponse {
  message: MessageSummary;
  replayed?: boolean;
}
