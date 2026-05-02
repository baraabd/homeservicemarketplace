import type {
  ListMyBidsQuery,
  ListMyBidsResponse,
  SubmitBidRequest,
  SubmitBidResponse,
  WithdrawBidResponse,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Sprint 7.1 — frontend uses the CANONICAL `/v1/provider/bids` paths.
// The legacy `/v1/me/provider/bids` mount is kept on the API server
// for backwards compatibility with older clients but the web app
// now talks to canonical exclusively. All requests carry credentials;
// mutations pick up the X-CSRF-Token header from the request
// interceptor; the 401-refresh interceptor handles transparent
// access-token refresh.

export async function submitBid(input: SubmitBidRequest): Promise<SubmitBidResponse> {
  const { data } = await api.post<SubmitBidResponse>('/v1/provider/bids', input);
  return data;
}

export async function listMyBids(query: ListMyBidsQuery = {}): Promise<ListMyBidsResponse> {
  const params: Record<string, string | number> = {};
  if (query.status) params.status = query.status;
  if (query.limit !== undefined) params.limit = query.limit;
  if (query.cursor) params.cursor = query.cursor;
  const { data } = await api.get<ListMyBidsResponse>('/v1/provider/bids', { params });
  return data;
}

export async function withdrawBid(bidId: string): Promise<WithdrawBidResponse> {
  const { data } = await api.post<WithdrawBidResponse>(
    `/v1/provider/bids/${encodeURIComponent(bidId)}/withdraw`,
  );
  return data;
}
