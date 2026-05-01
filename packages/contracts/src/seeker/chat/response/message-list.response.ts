import type { MessageSummary } from './message-summary';

// Standard envelope. Slice 3.3 returns the most recent N messages in
// chronological (oldest-first) order so the renderer can append new
// messages at the bottom without re-sorting. The `nextCursor` carries
// the id of the OLDEST message in the page; passing it back loads
// older messages (infinite-scroll-up pattern in a future slice).
export interface MessageListResponse {
  items: MessageSummary[];
  nextCursor: string | null;
}
