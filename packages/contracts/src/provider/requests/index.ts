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

// R14 — there is deliberately no budget on the provider projection. The
// seeker never states one, so any value here would be fabricated. A future
// seeker budget intent needs an approved product decision first; see
// docs/production-readiness/r14/BUDGET_POLICY.md.

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
