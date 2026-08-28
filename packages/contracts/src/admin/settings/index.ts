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
  {
    // Sprint 9B.2 — a publication-time ceiling on how much one policy version
    // may demand. It bounds the checklist a provider is handed, so a mistyped
    // policy cannot create a list nobody can finish.
    //
    // A ceiling, never a grant: it can only refuse a publish. That is why an
    // absent or malformed row safely falls back to this default instead of
    // failing closed — refusing every publish because a settings row is
    // missing would be a worse outage than a slightly low ceiling.
    //
    // min 1, not 0: parsePolicyRequirements already refuses a policy that
    // requires verification while naming no documents, so a ceiling of 0 would
    // make every verifying policy unpublishable.
    key: 'verification_policy_max_documents',
    type: 'integer',
    description:
      'How many document kinds a single verification policy version may require. A publication-time ceiling only — policies already published are never re-validated against it, because a rule added today must not invalidate a decision made honestly last month.',
    default: 10,
    min: 1,
    max: 20,
  },
  {
    // Sprint 9B.3 — the largest single piece of identity evidence accepted.
    //
    // A ceiling on attack surface as much as on disk: every byte accepted is a
    // byte a parser, a scanner and a reviewer's browser must handle. 10 MB
    // comfortably holds a phone photo of a passport or a multi-page PDF.
    //
    // Enforced server-side against the RECEIVED length, never against the
    // declared one, so a lying Content-Length cannot widen it.
    key: 'verification_evidence_max_bytes',
    type: 'integer',
    description:
      'Maximum size in bytes of a single piece of identity evidence. Enforced against the bytes actually received, not against the declared length.',
    default: 10 * 1024 * 1024,
    min: 64 * 1024,
    max: 25 * 1024 * 1024,
  },
  {
    // Sprint 9B.3 — how many live documents one case may hold.
    //
    // Bounds both the review workload and the blast radius of a compromised
    // provider account: without it, an attacker with a session can fill the
    // restricted bucket. Superseded documents do not count, so resubmitting
    // after a rejection is never blocked by this.
    key: 'verification_evidence_max_documents_per_case',
    type: 'integer',
    description:
      'How many live (non-superseded) evidence documents one verification case may hold. Superseded documents are not counted, so resubmission is never blocked by this limit.',
    default: 10,
    min: 1,
    max: 25,
  },
  {
    // Sprint 9B.3 — how long a prepared upload stays usable.
    //
    // Short on purpose: the prepare response authorises a write into the
    // restricted namespace, so it is a capability with a blast radius, and a
    // stale one left in a browser history or a proxy log should be inert.
    // Long enough for a slow mobile upload of the size ceiling above.
    key: 'verification_evidence_upload_ttl_seconds',
    type: 'integer',
    description:
      'How long a prepared evidence upload stays valid, in seconds. The prepare response authorises a write into the restricted namespace, so this is deliberately short.',
    default: 900,
    min: 60,
    max: 3600,
  },
  {
    // Sprint 9B.7 — how long a work-access grant issued by an approval lasts.
    //
    // ADR 0013: `endsAt = decidedAt + VERIFICATION_GRANT_DAYS` (default 365,
    // configurable). This IS that number, and it lives here rather than as a
    // constant in the approval service for the reason every other limit does:
    // the value an admin is shown must be the value the code enforces.
    //
    // The floor is 1 day, not 0. A zero-day grant would be born already
    // expired — an approval that authorises nothing, reported to the provider
    // as success — and no legitimate configuration wants that. A policy that
    // means "never grant" says so by requiring verification the provider
    // cannot satisfy, not by issuing dead grants.
    //
    // The ceiling is 10 years. Grants are deliberately finite: an open-ended
    // one is how a provider verified once in 2026 is still trading on it in
    // 2040 with nobody having looked again.
    key: 'verification_work_grant_validity_days',
    type: 'integer',
    description:
      'How many days a work-access grant issued by an approved verification lasts. Existing grants keep the duration in force when they were issued; changing this affects future approvals only.',
    default: 365,
    min: 1,
    max: 3650,
  },
  {
    // ── Sprint 9B.9 — the redacted marketplace preview ───────────────────
    //
    // OFF by default, and that is the whole posture: the preview shows part of
    // the marketplace to providers who have NOT been verified, so the safe
    // state is showing nothing. An operator turns it on deliberately, per
    // environment, after reading what it discloses.
    key: 'marketplace_preview_enabled',
    type: 'boolean',
    description:
      'Show a heavily redacted marketplace preview to providers who finished onboarding but do not yet have work access. Off by default.',
    default: false,
  },
  {
    // Grid size for coarse location, in km. LARGER IS MORE PRIVATE, which is
    // the opposite of most limits here, so the floor matters more than the
    // ceiling: 5 km is the tightest an operator may set, because a preview
    // user is unverified and a tighter cell starts to identify a street.
    key: 'marketplace_preview_cell_km',
    type: 'integer',
    description:
      'Edge length in km of the grid cell a preview request is snapped to. Larger is more private; the preview never shows exact coordinates.',
    default: 25,
    min: 5,
    max: 200,
  },
  {
    // Small on purpose. A preview is a taste of the marketplace, not a feed.
    key: 'marketplace_preview_page_size',
    type: 'integer',
    description: 'Items per page in the redacted preview.',
    default: 10,
    min: 1,
    max: 25,
  },
  {
    // The anti-scraping ceiling: the TOTAL number of items reachable through
    // pagination, ever. Without it, a small page size only slows a harvest
    // down instead of bounding it.
    key: 'marketplace_preview_max_items',
    type: 'integer',
    description:
      'Total items reachable through preview pagination. Bounds a harvest rather than merely slowing it.',
    default: 30,
    min: 1,
    max: 200,
  },
  {
    // ── Sprint 9B.10 — provider portfolio ────────────────────────────────
    //
    // How many published pieces of work a provider may show. A ceiling rather
    // than a target: the gallery is a sample, and an unbounded one becomes a
    // storage bill and a moderation queue nobody drains.
    key: 'provider_portfolio_max_items',
    type: 'integer',
    description:
      'Maximum published portfolio items per provider. Existing items over a lowered limit are kept; only new additions are refused.',
    default: 12,
    min: 1,
    max: 60,
  },
  {
    // Per-file ceiling, in bytes. Below the platform-wide media cap on
    // purpose: a portfolio photo is a phone snapshot of finished work, and the
    // gallery renders many of them at once.
    key: 'provider_portfolio_max_file_bytes',
    type: 'integer',
    description: 'Maximum size of a single portfolio image, in bytes.',
    default: 5 * 1024 * 1024,
    min: 64 * 1024,
    max: 10 * 1024 * 1024,
  },
  {
    // ── Sprint 9B.19 — service-radius policy ─────────────────────────────
    //
    // How far a provider is suggested to travel, BY TRANSPORT. One key per
    // mode rather than a table baked into a client, because the honest answer
    // differs per market — 25 km by car is a suburb in one city and three
    // cities in another — and an operator has to be able to change it without
    // a deploy.
    //
    // These are SUGGESTIONS. The provider may always go lower; the ceiling
    // below is the only hard bound, and it is policy too.
    key: 'provider_service_radius_on_foot_km',
    type: 'integer',
    description:
      'Suggested service radius for a provider who travels on foot. A suggestion the provider may reduce, never a floor.',
    default: 3,
    min: 1,
    max: 100,
  },
  {
    key: 'provider_service_radius_motorcycle_km',
    type: 'integer',
    description: 'Suggested service radius for a provider who travels by motorcycle.',
    default: 12,
    min: 1,
    max: 200,
  },
  {
    key: 'provider_service_radius_public_transport_km',
    type: 'integer',
    description: 'Suggested service radius for a provider who travels by public transport.',
    default: 15,
    min: 1,
    max: 200,
  },
  {
    key: 'provider_service_radius_car_km',
    type: 'integer',
    description: 'Suggested service radius for a provider who travels by car.',
    default: 25,
    min: 1,
    max: 300,
  },
  {
    key: 'provider_service_radius_van_km',
    type: 'integer',
    description: 'Suggested service radius for a provider who travels by van.',
    default: 35,
    min: 1,
    max: 300,
  },
  {
    key: 'provider_service_radius_truck_km',
    type: 'integer',
    description: 'Suggested service radius for a provider who travels by truck.',
    default: 50,
    min: 1,
    max: 400,
  },
  {
    // The one HARD bound. Everything above is advice; this is the ceiling the
    // server enforces regardless of what a client sends, and it exists because
    // an unbounded radius turns the feed's bounding-box query into a table
    // scan (see MAX_SERVICE_AREA_RADIUS_KM, which is the blast radius this
    // must stay at or below).
    //
    // Deliberately NOT derived from the per-transport values: an operator
    // raising the truck suggestion should not silently raise what every
    // provider may set by hand.
    key: 'provider_service_radius_max_km',
    type: 'integer',
    description:
      'Hard ceiling on any provider service radius, whatever their transport. Enforced server-side.',
    default: 100,
    min: 1,
    max: 500,
  },
  {
    // The floor. A radius of zero matches nothing and reads to the provider as
    // "the marketplace is empty" rather than "you chose not to travel".
    key: 'provider_service_radius_min_km',
    type: 'integer',
    description: 'Smallest service radius a provider may set. Below this they would match nothing.',
    default: 1,
    min: 1,
    max: 50,
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
