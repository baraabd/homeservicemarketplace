// POST /v1/me/conversations/:id/read returns the timestamp the
// participant's `lastReadAt` was set to. Idempotent: re-marking a
// conversation that has no new messages still returns a fresh
// `lastReadAt`.
export interface MarkConversationReadResponse {
  lastReadAt: string;
}
