import type { BidListResponse, BidSummary, ListBidsQuery } from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Thin typed wrappers around the /v1/me/requests/:requestId/bids
// endpoints. All requests carry credentials (api.ts sets
// `withCredentials: true`); the 401-refresh interceptor handles
// transparent access-token refresh.

export async function listBidsForRequest(
  requestId: string,
  query: ListBidsQuery = {},
): Promise<BidListResponse> {
  const { data } = await api.get<BidListResponse>(`/v1/me/requests/${requestId}/bids`, {
    params: query.sort ? { sort: query.sort } : {},
  });
  return data;
}

export async function getBidDetail(requestId: string, bidId: string): Promise<BidSummary> {
  const { data } = await api.get<BidSummary>(`/v1/me/requests/${requestId}/bids/${bidId}`);
  return data;
}
