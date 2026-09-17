import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateParticipantDisputeRequest, CreateParticipantDisputeResponse, DisputeBookingChoices, DisputeIntakeContext, ParticipantDisputeDetail, ParticipantDisputeList } from '@homeservicemarketplace/contracts';
import { api } from '../../../lib/api';
const path = '/v1/me/disputes';
export const disputeKeys = { root: ['participant-disputes'] as const, context: (id: string) => ['participant-disputes', 'context', id] as const, detail: (id: string) => ['participant-disputes', 'detail', id] as const };
const privateQuery = { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false } as const;
export function useCaseList() {
  return useInfiniteQuery({ ...privateQuery, queryKey: [...disputeKeys.root, 'list'], initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => (await api.get<ParticipantDisputeList>(path, { params: { limit: 20, cursor: pageParam }, signal })).data,
    getNextPageParam: (last) => last.nextCursor ?? undefined });
}
export function useCaseBookings() {
  return useInfiniteQuery({ ...privateQuery, queryKey: [...disputeKeys.root, 'bookings'], initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => (await api.get<DisputeBookingChoices>(`${path}/bookings`, { params: { limit: 20, cursor: pageParam }, signal })).data,
    getNextPageParam: (last) => last.nextCursor ?? undefined });
}
export function useIntakeContext(id: string) {
  return useQuery({ ...privateQuery, queryKey: disputeKeys.context(id), enabled: !!id,
    queryFn: async ({ signal }) => (await api.get<DisputeIntakeContext>(`${path}/context/${encodeURIComponent(id)}`, { signal })).data });
}
export function useCaseDetail(id: string) {
  return useQuery({ ...privateQuery, queryKey: disputeKeys.detail(id), enabled: !!id,
    queryFn: async ({ signal }) => (await api.get<ParticipantDisputeDetail>(`${path}/${encodeURIComponent(id)}`, { signal })).data });
}
export function useCreateCase() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: async (input: CreateParticipantDisputeRequest) =>
    (await api.post<CreateParticipantDisputeResponse>(path, input)).data,
    // Reconcile only after a confirmed server response; no optimistic case/decision.
    onSuccess: () => { void qc.invalidateQueries({ queryKey: disputeKeys.root }); } });
}
export function caseErrorStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null)?.response?.status;
}
