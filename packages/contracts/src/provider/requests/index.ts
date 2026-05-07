// Provider available-requests feed (Sprint 5.2 canonical).
//
//   GET /v1/provider/available-requests?cursor&limit&category&near
//   GET /v1/provider/available-requests/:requestId
//
// Read-only, gated on JwtAuthGuard + RolesGuard('provider') +
// ProviderActiveGuard (status === ACTIVE). Hides requests the
// calling provider has already bid on (non-WITHDRAWN).
//
// Wire shape is a NARROW projection: never exposes seekerUserId,
// seeker name, email, phone, or precise line1. Provider learns the
// seeker's identity via the Conversation surface only after a bid
// is accepted.
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
