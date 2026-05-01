import type {
  CreateServiceRequestRequest,
  ListServiceRequestsQuery,
  ServiceRequestDetail,
  ServiceRequestListResponse,
  ServiceRequestSummary,
  ServiceRequestTimelineResponse,
  UpdateServiceRequestRequest,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Thin typed wrappers around the /v1/me/requests endpoints. All requests
// carry credentials (api.ts sets `withCredentials: true`) and mutations
// pick up the X-CSRF-Token header from the request interceptor. The
// 401-refresh interceptor handles transparent access-token refresh.

export async function listServiceRequests(
  query: ListServiceRequestsQuery = {},
): Promise<ServiceRequestListResponse> {
  const { data } = await api.get<ServiceRequestListResponse>('/v1/me/requests', {
    params: {
      ...(query.status ? { status: query.status } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    },
  });
  return data;
}

export async function getServiceRequest(requestId: string): Promise<ServiceRequestDetail> {
  const { data } = await api.get<ServiceRequestDetail>(`/v1/me/requests/${requestId}`);
  return data;
}

export async function createServiceRequest(
  input: CreateServiceRequestRequest,
): Promise<ServiceRequestSummary> {
  const { data } = await api.post<ServiceRequestSummary>('/v1/me/requests', input);
  return data;
}

export async function updateServiceRequest(
  requestId: string,
  input: UpdateServiceRequestRequest,
): Promise<ServiceRequestDetail> {
  const { data } = await api.patch<ServiceRequestDetail>(`/v1/me/requests/${requestId}`, input);
  return data;
}

export async function cancelServiceRequest(requestId: string): Promise<ServiceRequestDetail> {
  const { data } = await api.post<ServiceRequestDetail>(`/v1/me/requests/${requestId}/cancel`);
  return data;
}

export async function reopenServiceRequest(requestId: string): Promise<ServiceRequestDetail> {
  const { data } = await api.post<ServiceRequestDetail>(`/v1/me/requests/${requestId}/reopen`);
  return data;
}

export async function getServiceRequestTimeline(
  requestId: string,
): Promise<ServiceRequestTimelineResponse> {
  const { data } = await api.get<ServiceRequestTimelineResponse>(
    `/v1/me/requests/${requestId}/timeline`,
  );
  return data;
}
