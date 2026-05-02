import type { EarningsTransaction } from './earnings-transaction';

// GET /v1/provider/earnings/transactions response. Cursor-paginated;
// `nextCursor` is `null` when the caller has reached the tail.
export interface ListProviderEarningsTransactionsResponse {
  items: EarningsTransaction[];
  nextCursor: string | null;
}
