import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateServiceRequestRequest,
  ListServiceRequestsQuery,
  ServiceRequestDetail,
  ServiceRequestListResponse,
  ServiceRequestSummary,
  ServiceRequestTimelineResponse,
  UpdateServiceRequestRequest,
} from '@homeservicemarketplace/contracts';

import {
  cancelServiceRequest,
  createServiceRequest,
  getServiceRequest,
  getServiceRequestTimeline,
  listServiceRequests,
  reopenServiceRequest,
  updateServiceRequest,
} from '../../../lib/seeker/requests-api';
import { seekerQueryKeys } from '../../../lib/seeker/query-keys';

// ─── Queries ─────────────────────────────────────────────────────────────────

export function useRequests(query: ListServiceRequestsQuery = {}) {
  return useQuery<ServiceRequestListResponse>({
    queryKey: seekerQueryKeys.requests.list(query.status ? { status: query.status } : undefined),
    queryFn: () => listServiceRequests(query),
    staleTime: 30 * 1000,
  });
}

export function useRequestDetail(requestId: string | null | undefined) {
  return useQuery<ServiceRequestDetail>({
    queryKey: requestId
      ? seekerQueryKeys.requests.detail(requestId)
      : ['seeker', 'requests', 'detail', '__noop__'],
    queryFn: () => getServiceRequest(requestId as string),
    enabled: typeof requestId === 'string' && requestId.length > 0,
    staleTime: 30 * 1000,
  });
}

export function useRequestTimeline(requestId: string | null | undefined) {
  return useQuery<ServiceRequestTimelineResponse>({
    queryKey: requestId
      ? seekerQueryKeys.requests.timeline(requestId)
      : ['seeker', 'requests', 'timeline', '__noop__'],
    queryFn: () => getServiceRequestTimeline(requestId as string),
    enabled: typeof requestId === 'string' && requestId.length > 0,
    staleTime: 15 * 1000,
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────
// All four mutations invalidate the requests root key on success so list
// + detail + timeline pick up the new state. Detail-targeted mutations
// also seed the new row into the detail cache (saves one round-trip).

function useRequestsInvalidator() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: seekerQueryKeys.requests.root });
}

export function useCreateServiceRequest() {
  const qc = useQueryClient();
  const invalidate = useRequestsInvalidator();
  return useMutation<ServiceRequestSummary, Error, CreateServiceRequestRequest>({
    mutationFn: createServiceRequest,
    onSuccess: (created) => {
      qc.setQueryData(seekerQueryKeys.requests.detail(created.id), created);
      return invalidate();
    },
  });
}

export function useUpdateServiceRequest() {
  const qc = useQueryClient();
  const invalidate = useRequestsInvalidator();
  return useMutation<
    ServiceRequestDetail,
    Error,
    { requestId: string; input: UpdateServiceRequestRequest }
  >({
    mutationFn: ({ requestId, input }) => updateServiceRequest(requestId, input),
    onSuccess: (detail) => {
      qc.setQueryData(seekerQueryKeys.requests.detail(detail.id), detail);
      return invalidate();
    },
  });
}

export function useCancelServiceRequest() {
  const qc = useQueryClient();
  const invalidate = useRequestsInvalidator();
  return useMutation<ServiceRequestDetail, Error, string>({
    mutationFn: cancelServiceRequest,
    onSuccess: (detail) => {
      qc.setQueryData(seekerQueryKeys.requests.detail(detail.id), detail);
      return invalidate();
    },
  });
}

export function useReopenServiceRequest() {
  const qc = useQueryClient();
  const invalidate = useRequestsInvalidator();
  return useMutation<ServiceRequestDetail, Error, string>({
    mutationFn: reopenServiceRequest,
    onSuccess: (detail) => {
      qc.setQueryData(seekerQueryKeys.requests.detail(detail.id), detail);
      return invalidate();
    },
  });
}
