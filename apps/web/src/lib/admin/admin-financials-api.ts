import type {
  AdminFinancialsSummary,
  ListAdminFinancialsBookingsQuery,
  ListAdminFinancialsBookingsResponse,
  ListAdminFinancialsProviderEarningsQuery,
  ListAdminFinancialsProviderEarningsResponse,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Admin financials API client (Sprint 6.4). Targets the canonical
// /v1/admin/financials/* read-only surface.

export async function getAdminFinancialsSummary(): Promise<AdminFinancialsSummary> {
  const { data } = await api.get<AdminFinancialsSummary>('/v1/admin/financials/summary');
  return data;
}

export async function listAdminFinancialsBookings(
  query: ListAdminFinancialsBookingsQuery = {},
): Promise<ListAdminFinancialsBookingsResponse> {
  const params: Record<string, string | number> = {};
  if (query.limit !== undefined) params.limit = query.limit;
  if (query.cursor) params.cursor = query.cursor;
  const { data } = await api.get<ListAdminFinancialsBookingsResponse>(
    '/v1/admin/financials/bookings',
    { params },
  );
  return data;
}

export async function listAdminFinancialsProviderEarnings(
  query: ListAdminFinancialsProviderEarningsQuery = {},
): Promise<ListAdminFinancialsProviderEarningsResponse> {
  const params: Record<string, string | number> = {};
  if (query.limit !== undefined) params.limit = query.limit;
  if (query.cursor) params.cursor = query.cursor;
  const { data } = await api.get<ListAdminFinancialsProviderEarningsResponse>(
    '/v1/admin/financials/provider-earnings',
    { params },
  );
  return data;
}
