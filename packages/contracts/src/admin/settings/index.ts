// Admin platform settings (Sprint 6.5 refined — whitelisted bulk).
//
//   GET   /v1/admin/settings              — bulk: { values, defaults, schema, lastUpdatedAt }
//   PATCH /v1/admin/settings              — partial bulk update (validated per-key)
//   GET   /v1/admin/settings/:key         — keyed read (legacy, kept callable)
//   PUT   /v1/admin/settings/:key         — keyed upsert (legacy)
//   DELETE /v1/admin/settings/:key        — keyed remove (legacy)
//
// The bulk shape is what the admin UI actually needs: one object
// with the current value of every whitelisted key + the default it
// falls back to + a schema describing each field's editor. Per-key
// writes are validated against the same schema.
//
// Mutations write ADMIN_SETTING_UPDATED audit rows with before/after.

// ─── Whitelist of admin-editable settings ───────────────────────
//
// Each entry defines:
//   • `type` — the editor widget the UI should render
//   • `default` — the value used when the row is absent from the DB
//   • `min` / `max` — numeric bounds (optional)
//   • `description` — short human text shown next to the field
//
// Adding a new key is a contract + service change in lockstep.
export type AdminSettingType = 'integer' | 'string' | 'boolean' | 'email' | 'currency';

export interface AdminSettingFieldSchema {
  key: string;
  type: AdminSettingType;
  description: string;
  default: unknown;
  min?: number;
  max?: number;
}

export const ADMIN_SETTINGS_SCHEMA: readonly AdminSettingFieldSchema[] = [
  {
    key: 'platform_fee_bps',
    type: 'integer',
    description:
      'Marketplace platform fee in basis points (1 bp = 0.01%). 1000 = 10% take. 0 = fee-free. Persisted overrides the env-driven default.',
    default: 1000,
    min: 0,
    max: 10000,
  },
  {
    key: 'default_currency',
    type: 'currency',
    description: 'Default ISO-4217 currency code (e.g., USD, EUR, SAR).',
    default: 'USD',
  },
  {
    key: 'support_email',
    type: 'email',
    description: 'Customer-facing support email shown on the public site footer.',
    default: 'support@homeservicemarketplace.local',
  },
  {
    key: 'feature_show_hourly_rate',
    type: 'boolean',
    description: 'Show the hourly-rate pricing mode in the seeker request wizard.',
    default: false,
  },
] as const;

export type AdminSettingKey = (typeof ADMIN_SETTINGS_SCHEMA)[number]['key'];

// Wire shape of the whitelisted values. Type-safe per key would be
// nice but the lowest-friction wire surface is `Record<string, unknown>`
// — the schema doc above is the source of truth for shape.
export type AdminSettingsValues = Record<string, unknown>;

export interface AdminSettingsBulkResponse {
  values: AdminSettingsValues;
  defaults: AdminSettingsValues;
  schema: readonly AdminSettingFieldSchema[];
  // ISO timestamp of the most recent setting mutation across all
  // whitelisted keys, or null when no row has been written yet.
  lastUpdatedAt: string | null;
}

export interface UpdateAdminSettingsRequest {
  // Partial bulk update — only the keys in `values` are written.
  // Keys not in the whitelist are rejected at the DTO with a
  // VALIDATION_ERROR. Each value is then validated against the
  // schema entry's `type` + `min` / `max` constraints.
  values: AdminSettingsValues;
}

export interface UpdateAdminSettingsResponse {
  values: AdminSettingsValues;
  // Echoes which keys actually changed (server-side compares
  // before/after; idempotent same-value writes return no key in
  // `changedKeys` but still surface the full `values` object).
  changedKeys: string[];
  lastUpdatedAt: string | null;
}

// ─── Legacy keyed endpoints (back-compat) ───────────────────────

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
