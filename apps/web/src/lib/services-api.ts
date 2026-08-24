import type {
  EquipmentCatalogListResponse,
  EquipmentCatalogSummary,
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

// Sprint 8 — the equipment catalogue, on the same public terms as the
// category list above. The onboarding wizard needs it before a provider has
// any standing to speak of, so gating it on a session would mean the EXPERIENCE
// step could not render for the people it exists for.
export async function listEquipmentCatalog(): Promise<EquipmentCatalogSummary[]> {
  const { data } = await api.get<EquipmentCatalogListResponse>('/v1/services/equipment');
  return data.items;
}
