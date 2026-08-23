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

  // ── Sprint 8: settings the provider onboarding wizard actually reads ────
  // docs/adr/0008-category-hierarchy-and-onboarding-draft.md
  //
  // Every key below is consumed by a specific step. A setting nothing reads is
  // a lever that does nothing, which is worse than no lever — an operator
  // changes it, observes no effect, and stops trusting the whole screen.
  {
    key: 'provider_consent_policy_version',
    type: 'string',
    description:
      'Version of the provider terms currently published. Pinned onto each application at consent time, so "they agreed" stays answerable after the terms change. Bump this when the document changes; providers mid-application keep the version they accepted until they re-consent.',
    default: 'v1',
  },
  {
    key: 'provider_onboarding_max_service_areas',
    type: 'integer',
    description:
      'How many cities, districts, or neighborhoods one provider may cover. An upper bound, not a target — the cap exists so a single PATCH cannot amplify into thousands of rows.',
    default: 20,
    min: 1,
    max: 200,
  },
  {
    key: 'provider_onboarding_max_specialties',
    type: 'integer',
    description:
      'How many leaf specialties one provider may hold or apply for. Each one is a separate admin decision, so this is also a bound on how much review work a single submission can create.',
    default: 15,
    min: 1,
    max: 100,
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

// ─── Sprint 8: change history ───────────────────────────────────
//
//   GET /v1/admin/settings/:key/history
//
// PlatformSetting keeps only the CURRENT value and who last touched it, which
// cannot answer "what was the threshold when this provider was rejected?" —
// the question that actually gets asked, usually by someone disputing a
// decision. Every write appends a row here, so the answer survives the next
// write.
//
// Append-only. There is no edit and no delete on this surface: a mutable audit
// trail is not one.

export interface AdminSettingHistoryEntry {
  id: string;
  key: string;
  /** Null for the first write of a key that had no row. */
  previousValue: unknown;
  newValue: unknown;
  /** The admin who made the change, or null for a system write. */
  changedBy: string | null;
  changedAt: string;
  /** Justification captured at change time, when the caller supplied one. */
  reason: string | null;
}

export interface AdminSettingHistoryResponse {
  key: string;
  /** Newest first. */
  items: AdminSettingHistoryEntry[];
  /** Cursor for the next page, or null when the list is exhausted. */
  nextCursor: string | null;
}
