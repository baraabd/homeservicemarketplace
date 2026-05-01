import type { ServiceRequestStatus } from '../enums/service-request-status';
import type { ScheduleType } from '../enums/schedule-type';
import type { AddressSnapshot } from './address-snapshot';

// Lightweight category breakout used inside ServiceRequestSummary /
// ServiceRequestDetail. We deliberately do NOT reuse
// ServiceCategorySummary from the services contract because that one
// includes presentation fields (`icon`, `sortOrder`) the request views
// don't need — and we don't want a request response to silently widen
// when the catalog contract evolves. `null` when the request was
// posted with `customServiceText` instead of a curated category.
export interface ServiceRequestCategoryRef {
  id: string;
  slug: string;
  labelEn: string;
  labelAr: string;
}

export interface ServiceRequestSummary {
  id: string;
  status: ServiceRequestStatus;
  category: ServiceRequestCategoryRef | null;
  customServiceText: string | null;
  description: string | null;
  scheduleType: ScheduleType;
  scheduledAt: string | null;
  addressSnapshot: AddressSnapshot;
  // Bids are out of scope for this slice. The field exists on the
  // contract so the future Provider-bidding slice doesn't break the
  // wire; until then it is always 0.
  bidsCount: number;
  createdAt: string;
  updatedAt: string;
}

// GET /v1/me/requests
export interface ServiceRequestListResponse {
  items: ServiceRequestSummary[];
  // Cursor for the next page (id of the last item in this page) when a
  // further page may exist; null when this is the last page.
  nextCursor: string | null;
}

// GET /v1/me/requests/:requestId
//
// For slice 3 the detail shape is identical to the summary. We keep a
// distinct interface name so future slices can safely add fields
// (timeline preview, accepted bid, booked provider) without breaking
// existing list-shape consumers.
export type ServiceRequestDetail = ServiceRequestSummary;
