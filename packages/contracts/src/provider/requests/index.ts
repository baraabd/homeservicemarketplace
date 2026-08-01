// Provider available-requests feed (Sprint 5.2 canonical;
// Sprint 7.4 completed the privacy-safe summary projection).
//
//   GET /v1/provider/available-requests?cursor&limit&category&near
//   GET /v1/provider/available-requests/:requestId
//
// Read-only, gated on JwtAuthGuard + RolesGuard('provider') +
// ProviderActiveGuard (status === ACTIVE). Hides requests the
// calling provider has already bid on (non-WITHDRAWN).
//
// Wire shape is a NARROW projection: never exposes seekerUserId,
// seeker full name, email, phone, exact line1, or any other
// identifying field. Provider learns the seeker's identity via the
// Conversation surface only AFTER a bid is accepted. The seeker
// preview here is a privacy-safe label only ("Layla M.").
import type { ScheduleType } from '../../seeker/requests/enums/schedule-type';

export interface ProviderAvailableRequestsQuery {
  /**
   * Service category id. When omitted, the server defaults to the
   * provider's configured `serviceCategories` (or, when the provider
   * has no categories configured, returns the global feed).
   */
  category?: string;
  /**
   * City name (case-insensitive exact match) for the snapshotted
   * address. When omitted, the feed is global.
   */
  near?: string;
  limit?: number;
  cursor?: string;
}

export interface ProviderAvailableRequestCategoryRef {
  id: string;
  slug: string;
  labelEn: string;
  labelAr: string;
}

export interface ProviderAvailableRequestLocation {
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
}

// Sprint 7.4 — seeker preview embedded on the available-request
// summary. INTENTIONALLY narrow: a public-safe label and an optional
// reputation hint, nothing else. Specifically: no userId, no full
// name, no email, no phone, no avatar. The provider only learns the
// seeker's identity AFTER bid acceptance, via the conversation
// participant relation.
//
// `publicLabel` is the seeker's first name + last initial
// (e.g. "Layla M."), or a neutral "Customer" fallback when the
// underlying user row has no usable name. The mapping is identical
// to the conversation summary's seeker projection so a provider sees
// the same label in both surfaces.
//
// `rating` is optional and `null` until a seeker-reputation source
// lands. Surfacing the field on the contract now keeps the
// downstream UI render path stable when the data starts flowing.
export interface ProviderAvailableRequestSeekerPreview {
  publicLabel: string;
  rating: number | null;
}

// Sprint 7.4 — budget hint embedded on the available-request summary.
// The seeker may declare a budget range, a single amount, or leave it
// open. The shape covers all three so the wire DTO is stable
// regardless of how the seeker scoped their ask:
//
//   - amountMin / amountMax: integer marketplace units (cents-equiv).
//     Either may be null. `amountMin == null && amountMax == null`
//     means "open budget"; the renderer should treat that as "no
//     fixed cap, please bid your true price".
//   - currency: ISO 4217 (e.g. "USD"). Null when the request has no
//     stated budget at all (caller falls back to the marketplace
//     default for the bid form).
//   - label: a pre-formatted, locale-neutral display string the
//     server emits so each client renders identically. Examples:
//       "Open budget"
//       "$50"           (single amount)
//       "$50 – $100"    (range)
//     The renderer treats this as opaque text — currency formatting
//     is owned server-side so the marketplace can change rules in
//     one place. Null when the request has no budget data and the
//     UI prefers to render its own "Open budget" copy in-locale.
//
// All four fields are nullable to accommodate the existing data set
// (no seeker-side budget input today). The Sprint 7.4 mapper emits
// `{ amountMin: null, amountMax: null, currency: null, label: null }`
// until the seeker create-request wizard grows a budget input, at
// which point the mapper threads the persisted columns through
// without a contract change.
export interface ProviderAvailableRequestBudget {
  amountMin: number | null;
  amountMax: number | null;
  currency: string | null;
  label: string | null;
}

export interface ProviderAvailableRequestSummary {
  id: string;
  category: ProviderAvailableRequestCategoryRef | null;
  customServiceText: string | null;
  description: string | null;
  /**
   * Seeker-uploaded photos of the issue (e.g. leaky faucet, broken AC).
   * Always an array — empty when the seeker didn't attach any media.
   * URLs are absolute and ready to render directly in an <img>; the
   * frontend should fall back to a neutral placeholder if a URL fails
   * to load.
   */
  media: string[];
  scheduleType: ScheduleType;
  scheduledAt: string | null;
  location: ProviderAvailableRequestLocation;
  /**
   * Sprint 7.4 — Haversine distance from the provider's configured
   * `serviceAreaLat` / `serviceAreaLng` to the request snapshot's
   * `lat` / `lng`, in kilometres, rounded server-side to one decimal
   * place. Null when either end is missing coordinates. UI must
   * gate on `!== null` rather than truthiness — 0 km is a real
   * value (provider standing on top of the request).
   */
  distanceKm: number | null;
  /**
   * Sprint 7.4 — seeker's stated budget (always present in shape,
   * fields nullable when no source). See
   * `ProviderAvailableRequestBudget` for field semantics.
   */
  budget: ProviderAvailableRequestBudget;
  /**
   * Sprint 7.4 — privacy-safe seeker preview (label + optional
   * rating). NEVER carries userId, full name, email, phone, or
   * avatar. See `ProviderAvailableRequestSeekerPreview`.
   */
  seeker: ProviderAvailableRequestSeekerPreview;
  bidsCount: number;
  createdAt: string;
}

// Detail view layered on top of the summary. Reserved as a distinct
// type so future slices can add detail-only fields (richer schedule
// notes, attachments) without breaking list consumers.
export type ProviderAvailableRequestDetail = ProviderAvailableRequestSummary;

export interface ProviderAvailableRequestListResponse {
  items: ProviderAvailableRequestSummary[];
  nextCursor: string | null;
}

// Detail responses use the bare detail type — no envelope — so the
// frontend's React Query cache can drop it directly into the
// detail-by-id slot without a `.detail` unwrap.
export type ProviderAvailableRequestDetailResponse = ProviderAvailableRequestDetail;
