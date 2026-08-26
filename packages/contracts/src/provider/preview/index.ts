// Sprint 9B.9 — the redacted marketplace preview contract.
//
//   GET /v1/me/provider/marketplace-preview?cursor
//
// Read-only by construction. There is no companion POST, PATCH or DELETE in
// this family and there must never be one: the preview exists for providers
// who may NOT act on the marketplace, so a mutation route here would be a
// contradiction rather than a missing feature.
//
// The item shape is an ALLOWLIST, not a filtered version of the real feed. It
// is written as its own type rather than a `Pick<>` or `Omit<>` of
// ProviderAvailableRequestSummary on purpose: an Omit silently gains every
// field later added to the source type, so the day someone adds a phone number
// to the real feed, an Omit-based preview would start emitting it. This type
// gains nothing it is not given.

/** How recently a request was posted. Bands, never a timestamp — a precise
 *  createdAt is close to a unique key and would let a harvested preview set be
 *  joined to the real feed later. */
export type ProviderPreviewFreshness = 'TODAY' | 'THIS_WEEK' | 'EARLIER';

export interface ProviderPreviewArea {
  /** Coarse city key. Never a street, a line1 or a postcode. */
  cityKey: string | null;
  /** Centre of the grid cell the request falls in — NEVER the request's own
   *  coordinates. Null when the request has no location at all. */
  cellLat: number | null;
  cellLng: number | null;
  /** Edge length of that cell in km, so a client renders honest uncertainty
   *  (a shaded area) instead of a pin that implies precision it does not have. */
  cellKm: number;
}

export interface ProviderPreviewItem {
  /** Opaque, per-viewer pseudonym. NOT the request id: two providers see
   *  different refs for the same request, so harvests cannot be aligned. */
  ref: string;
  categorySlug: string | null;
  categoryLabelEn: string | null;
  categoryLabelAr: string | null;
  scheduleType: string;
  area: ProviderPreviewArea;
  freshness: ProviderPreviewFreshness;
}

/** Why the caller is seeing a preview instead of the marketplace, in both
 *  locales, so the client never has to infer the reason from a status code. */
export interface ProviderPreviewNotice {
  code: 'PREVIEW_ONLY';
  titleEn: string;
  titleAr: string;
  bodyEn: string;
  bodyAr: string;
}

export interface ProviderMarketplacePreviewResponse {
  /** True when the policy is on and the caller is eligible. */
  available: boolean;
  items: ProviderPreviewItem[];
  nextCursor: string | null;
  /** How many items this preview will EVER show. Surfaced so the client can
   *  say so plainly rather than implying an endless feed. */
  totalReach: number;
  /** The grid size in force, for the uncertainty shading. */
  cellKm: number;
  notice: ProviderPreviewNotice;
}
