// Admin platform settings (Sprint 6.5).
//
//   GET   /v1/admin/settings           — list all settings
//   GET   /v1/admin/settings/:key      — read one
//   PUT   /v1/admin/settings/:key      — upsert with audit
//   DELETE /v1/admin/settings/:key     — remove with audit
//
// Setting values are arbitrary JSON — the admin UI is responsible
// for shape validation per key. The mutations write
// ADMIN_SETTING_UPDATED audit rows.
export interface AdminSettingValue {
  key: string;
  value: unknown;
  updatedAt: string;
  updatedBy: string | null;
}

export interface UpsertSettingRequest {
  value: unknown;
}

export interface ListSettingsResponse {
  items: AdminSettingValue[];
}

export interface SettingMutationResponse {
  setting: AdminSettingValue;
}
