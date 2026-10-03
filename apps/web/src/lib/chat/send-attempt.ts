// R12 — one key per logical message send.
//
// A send whose reply is lost may already be stored. Sending it again with the
// SAME key makes the server return the stored message instead of storing a
// second one. A new message gets a new key. The server, not this module,
// decides what a key may find: keys are scoped to the sender and conversation.

export interface SendAttempt {
  conversationId: string;
  body: string;
  idempotencyKey: string;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * The key for sending `body` now. The previous attempt's key is reused only
 * when that attempt has not been acknowledged and this is the same text in the
 * same conversation, i.e. the person is sending the failed message again.
 */
export function keyForSend(
  unacknowledged: SendAttempt | null,
  conversationId: string,
  body: string,
): string {
  if (
    unacknowledged &&
    unacknowledged.conversationId === conversationId &&
    unacknowledged.body === body
  ) {
    return unacknowledged.idempotencyKey;
  }
  return newIdempotencyKey();
}
