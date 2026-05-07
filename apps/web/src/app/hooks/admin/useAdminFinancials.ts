import { useQuery } from '@tanstack/react-query';
import type {
  ListAdminFinancialsBookingsQuery,
  ListAdminFinancialsProviderEarningsQuery,
} from '@homeservicemarketplace/contracts';

import {
  getAdminFinancialsSummary,
  listAdminFinancialsBookings,
  listAdminFinancialsProviderEarnings,
} from '../../../lib/admin/admin-financials-api';

const REFETCH_MS = 60_000;

export const adminFinancialsQueryKeys = {
  root: ['admin', 'financials'] as const,
  summary: () => ['admin', 'financials', 'summary'] as const,
  bookings: (filters: ListAdminFinancialsBookingsQuery) =>
    ['admin', 'financials', 'bookings', filters] as const,
  providerEarnings: (filters: ListAdminFinancialsProviderEarningsQuery) =>
    ['admin', 'financials', 'provider-earnings', filters] as const,
};

export function useAdminFinancialsSummary() {
  return useQuery({
    queryKey: adminFinancialsQueryKeys.summary(),
    queryFn: getAdminFinancialsSummary,
    refetchInterval: REFETCH_MS,
    staleTime: 15_000,
  });
}

export function useAdminFinancialsBookings(filters: ListAdminFinancialsBookingsQuery = {}) {
  return useQuery({
    queryKey: adminFinancialsQueryKeys.bookings(filters),
    queryFn: () => listAdminFinancialsBookings(filters),
    refetchInterval: REFETCH_MS,
    staleTime: 15_000,
  });
}

export function useAdminFinancialsProviderEarnings(
  filters: ListAdminFinancialsProviderEarningsQuery = {},
) {
  return useQuery({
    queryKey: adminFinancialsQueryKeys.providerEarnings(filters),
    queryFn: () => listAdminFinancialsProviderEarnings(filters),
    refetchInterval: REFETCH_MS,
    staleTime: 15_000,
  });
}
