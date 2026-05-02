import type {
  AdminSettingsBulkResponse,
  UpdateAdminSettingsRequest,
  UpdateAdminSettingsResponse,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Admin platform settings API client (Sprint 6.5 refined). Targets
// the canonical bulk surface — the keyed `/v1/admin/settings/:key`
// endpoints are still callable but the UI doesn't use them.

export async function getAdminSettings(): Promise<AdminSettingsBulkResponse> {
  const { data } = await api.get<AdminSettingsBulkResponse>('/v1/admin/settings');
  return data;
}

export async function updateAdminSettings(
  body: UpdateAdminSettingsRequest,
): Promise<UpdateAdminSettingsResponse> {
  const { data } = await api.patch<UpdateAdminSettingsResponse>('/v1/admin/settings', body);
  return data;
}
