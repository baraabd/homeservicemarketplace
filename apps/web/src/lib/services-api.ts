import type {
  ServiceCategoryListResponse,
  ServiceCategorySummary,
} from '@homeservicemarketplace/contracts';
import { api } from './api';

// Thin typed wrapper around GET /v1/services. The endpoint is public
// (no auth required) so this never coexists with the 401-refresh
// interceptor's no-retry list — it's just a plain GET.
export async function listServiceCategories(): Promise<ServiceCategorySummary[]> {
  const { data } = await api.get<ServiceCategoryListResponse>('/v1/services');
  return data.items;
}
