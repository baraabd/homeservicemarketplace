import type { ProviderEarningsTransaction } from './provider-earnings-transaction';

export interface ListEarningsTransactionsResponse {
  items: ProviderEarningsTransaction[];
  nextCursor: string | null;
}
