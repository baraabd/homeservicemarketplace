import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ListAdminDisputesQuery,
  ResolveDisputeRequest,
  UpdateDisputeRequest,
} from '@homeservicemarketplace/contracts';

import {
  getAdminDispute,
  listAdminDisputes,
  resolveAdminDispute,
  updateAdminDispute,
} from '../../../lib/admin/admin-disputes-api';

// Admin disputes hooks (Sprint 6.3 refined). Same polling cadence
// as the verification queue — the list polls at 60 s; the detail
// drawer polls at 30 s while open. Mutations always invalidate the
// disputes root + the row's detail key so the timeline reconciles
// in one round-trip.
const LIST_REFETCH_MS = 60_000;
const DETAIL_REFETCH_MS = 30_000;

export const adminDisputesQueryKeys = {
  root: ['admin', 'disputes'] as const,
  list: (filters: ListAdminDisputesQuery) => ['admin', 'disputes', 'list', filters] as const,
  detail: (disputeId: string) => ['admin', 'disputes', 'detail', disputeId] as const,
};

export function useAdminDisputes(filters: ListAdminDisputesQuery = {}) {
  return useQuery({
    queryKey: adminDisputesQueryKeys.list(filters),
    queryFn: () => listAdminDisputes(filters),
    refetchInterval: LIST_REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

export function useAdminDisputeDetail(disputeId: string | null | undefined) {
  return useQuery({
    queryKey: adminDisputesQueryKeys.detail(disputeId ?? ''),
    queryFn: () => getAdminDispute(disputeId!),
    enabled: Boolean(disputeId),
    refetchInterval: DETAIL_REFETCH_MS,
    staleTime: 5_000,
  });
}

function invalidateDispute(qc: ReturnType<typeof useQueryClient>, disputeId: string) {
  qc.invalidateQueries({ queryKey: adminDisputesQueryKeys.root });
  qc.invalidateQueries({ queryKey: adminDisputesQueryKeys.detail(disputeId) });
}

export function useUpdateAdminDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ disputeId, body }: { disputeId: string; body: UpdateDisputeRequest }) =>
      updateAdminDispute(disputeId, body),
    onSuccess: (_data, vars) => invalidateDispute(qc, vars.disputeId),
  });
}

export function useResolveAdminDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ disputeId, body }: { disputeId: string; body: ResolveDisputeRequest }) =>
      resolveAdminDispute(disputeId, body),
    onSuccess: (_data, vars) => invalidateDispute(qc, vars.disputeId),
  });
}
