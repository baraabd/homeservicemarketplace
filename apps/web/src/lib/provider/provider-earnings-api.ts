import type {
  EarningsChart,
  EarningsChartRange,
  EarningsSummary,
  ListProviderEarningsTransactionsQuery,
  ListProviderEarningsTransactionsResponse,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Canonical provider earnings API client (Sprint 5.6 refined). Targets
// /v1/provider/earnings/{summary,transactions,chart} — the shape the
// new wallet UI consumes. The legacy /v1/me/provider/earnings endpoints
// remain callable but return the older shape and aren't used by the UI.

export async function getProviderEarningsSummary(): Promise<EarningsSummary> {
  const { data } = await api.get<EarningsSummary>('/v1/provider/earnings/summary');
  return data;
}

export async function listProviderEarningsTransactions(
  query: ListProviderEarningsTransactionsQuery = {},
): Promise<ListProviderEarningsTransactionsResponse> {
  const params: Record<string, string | number> = {};
  if (query.limit !== undefined) params.limit = query.limit;
  if (query.cursor) params.cursor = query.cursor;
  const { data } = await api.get<ListProviderEarningsTransactionsResponse>(
    '/v1/provider/earnings/transactions',
    { params },
  );
  return data;
}

export async function getProviderEarningsChart(
  range: EarningsChartRange = '30d',
): Promise<EarningsChart> {
  const { data } = await api.get<EarningsChart>('/v1/provider/earnings/chart', {
    params: { range },
  });
  return data;
}
