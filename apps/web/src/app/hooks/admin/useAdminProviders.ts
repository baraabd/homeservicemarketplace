import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListAdminProvidersQuery } from '@homeservicemarketplace/contracts';

import {
  approveAdminProvider,
  getAdminProvider,
  getAdminProviderAudit,
  listAdminProviders,
  reactivateAdminProvider,
  rejectAdminProvider,
  suspendAdminProvider,
  updateAdminProviderReviewNotes,
} from '../../../lib/admin/admin-providers-api';

// Admin provider verification hooks (Sprint 6.2 refined). Polling
// kept slow — the verification queue is event-driven from the
// admin's perspective, not a real-time surface. Mutations always
// invalidate the providers root + the specific profile's detail
// and audit keys, so the detail drawer + history feed reconcile in
// one round-trip.
const LIST_REFETCH_MS = 60_000;

export const adminProvidersQueryKeys = {
  root: ['admin', 'providers'] as const,
  list: (filters: ListAdminProvidersQuery) => ['admin', 'providers', 'list', filters] as const,
  detail: (providerProfileId: string) =>
    ['admin', 'providers', 'detail', providerProfileId] as const,
  audit: (providerProfileId: string) => ['admin', 'providers', 'audit', providerProfileId] as const,
};

export function useAdminProviders(filters: ListAdminProvidersQuery = {}) {
  return useQuery({
    queryKey: adminProvidersQueryKeys.list(filters),
    queryFn: () => listAdminProviders(filters),
    refetchInterval: LIST_REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

export function useAdminProviderDetail(providerProfileId: string | null | undefined) {
  return useQuery({
    queryKey: adminProvidersQueryKeys.detail(providerProfileId ?? ''),
    queryFn: () => getAdminProvider(providerProfileId!),
    enabled: Boolean(providerProfileId),
    staleTime: 5_000,
  });
}

export function useAdminProviderAudit(providerProfileId: string | null | undefined) {
  return useQuery({
    queryKey: adminProvidersQueryKeys.audit(providerProfileId ?? ''),
    queryFn: () => getAdminProviderAudit(providerProfileId!),
    enabled: Boolean(providerProfileId),
    staleTime: 5_000,
  });
}

function invalidateProvider(qc: ReturnType<typeof useQueryClient>, providerProfileId: string) {
  qc.invalidateQueries({ queryKey: adminProvidersQueryKeys.root });
  qc.invalidateQueries({ queryKey: adminProvidersQueryKeys.detail(providerProfileId) });
  qc.invalidateQueries({ queryKey: adminProvidersQueryKeys.audit(providerProfileId) });
}

export function useUpdateAdminProviderReviewNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ providerProfileId, notes }: { providerProfileId: string; notes: string }) =>
      updateAdminProviderReviewNotes(providerProfileId, notes),
    onSuccess: (_data, vars) => invalidateProvider(qc, vars.providerProfileId),
  });
}

export function useAdminProviderDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      providerProfileId: string;
      action: 'approve' | 'reject' | 'suspend' | 'reactivate';
      reason?: string | null;
    }) => {
      const id = vars.providerProfileId;
      switch (vars.action) {
        case 'approve':
          return approveAdminProvider(id, vars.reason ?? null);
        case 'reject':
          return rejectAdminProvider(id, vars.reason ?? null);
        case 'suspend':
          return suspendAdminProvider(id, vars.reason ?? null);
        case 'reactivate':
          return reactivateAdminProvider(id);
      }
    },
    onSuccess: (_data, vars) => invalidateProvider(qc, vars.providerProfileId),
  });
}
