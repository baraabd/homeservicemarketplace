import type {
  AdminProviderReview,
  AdminProviderReviewHistoryResponse,
  AdminProviderReviewMutationResponse,
  ApproveAdminProviderReviewRequest,
  RequestAdminProviderReviewChangesRequest,
  ReviewCategoryApplicationRequest,
} from '@homeservicemarketplace/contracts';
import { api } from '../../../lib/api';
import { adminProvidersQueryKeys } from '../../hooks/admin/useAdminProviders';

export const reviewQueryKey = (id: string) =>
  [...adminProvidersQueryKeys.detail(id), 'review'] as const;
const reviewPath = (id: string) => `/v1/admin/providers/${encodeURIComponent(id)}/review`;
export const reviewHistoryQueryKey = (id: string) =>
  [...adminProvidersQueryKeys.detail(id), 'review-history'] as const;
export async function getProviderReviewHistory(
  id: string,
  cursor: string | undefined,
  signal?: AbortSignal,
): Promise<AdminProviderReviewHistoryResponse> {
  const response = await api.get<AdminProviderReviewHistoryResponse>(`${reviewPath(id)}/history`, {
    params: { limit: 20, ...(cursor ? { cursor } : {}) },
    signal,
  });
  return response.data;
}
export async function getProviderReview(
  id: string,
  signal?: AbortSignal,
): Promise<AdminProviderReview> {
  const response = await api.get<AdminProviderReview>(reviewPath(id), { signal });
  return response.data;
}
export async function approveProviderReview(
  id: string,
  body: ApproveAdminProviderReviewRequest,
): Promise<AdminProviderReviewMutationResponse> {
  const response = await api.post<AdminProviderReviewMutationResponse>(
    `${reviewPath(id)}/approve`,
    body,
  );
  return response.data;
}
export async function requestProviderReviewChanges(
  id: string,
  body: RequestAdminProviderReviewChangesRequest,
): Promise<AdminProviderReviewMutationResponse> {
  const response = await api.post<AdminProviderReviewMutationResponse>(
    `${reviewPath(id)}/request-changes`,
    body,
  );
  return response.data;
}
export async function reviewProviderCategory(
  id: string,
  body: ReviewCategoryApplicationRequest,
): Promise<void> {
  await api.patch(`/v1/admin/category-applications/${encodeURIComponent(id)}/review`, body);
}
export function requestStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null)?.response?.status;
}
