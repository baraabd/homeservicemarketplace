import type {
  ListEarningsTransactionsQuery,
  ListEarningsTransactionsResponse,
  ProviderEarningsSummary,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Provider wallet read model (Sprint 5 slice 5.6). Read-only; no
// mutations, no CSRF token required. Polled at the screen level.

export async function getProviderEarningsSummary(): Promise<ProviderEarningsSummary> {
  const { data } = await api.get<ProviderEarningsSummary>('/v1/me/provider/earnings');
  return data;
}

export async function listProviderEarningsTransactions(
  query: ListEarningsTransactionsQuery = {},
): Promise<ListEarningsTransactionsResponse> {
  const params: Record<string, string | number> = {};
  if (query.status) params.status = query.status;
  if (query.limit !== undefined) params.limit = query.limit;
  if (query.cursor) params.cursor = query.cursor;
  const { data } = await api.get<ListEarningsTransactionsResponse>(
    '/v1/me/provider/earnings/transactions',
    { params },
  );
  return data;
}
