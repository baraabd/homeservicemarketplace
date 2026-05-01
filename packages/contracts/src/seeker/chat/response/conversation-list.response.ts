import type { ConversationSummary } from './conversation-summary';

// Standard envelope. `nextCursor` is non-null when more rows exist
// beyond the current page; the messages tab renders the first page in
// one round-trip — pagination is a future-slice concern.
export interface ConversationListResponse {
  items: ConversationSummary[];
  nextCursor: string | null;
}
