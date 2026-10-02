import type { ScheduleType } from '../enums/schedule-type';

// POST /v1/me/requests
//
// Ownership: `seekerUserId` is intentionally absent. The server derives
// it from the authenticated session — accepting it from the wire would
// be an IDOR vector.
//
// Service identifier: at least one of `categoryId` and `customServiceText`
// MUST be present. The Seeker either picks a curated category from the
// catalog (preferred) or types a free-form description for something the
// catalog doesn't cover yet.
//
// Location: at least one of `addressId` and `manualAddress` MUST be
// present. When `addressId` is supplied, the server reloads the address
// from the DB (validating ownership) and snapshots it onto the request;
// any address fields supplied alongside `addressId` are ignored. When
// `manualAddress` is supplied, the server validates it and snapshots
// the user-typed values directly.
export interface ManualAddressInput {
  label?: string | null;
  line1: string;
  city: string;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface CreateServiceRequestRequest {
  categoryId?: string | null;
  customServiceText?: string | null;
  description?: string | null;
  /** R06 — attachments, by server-issued asset id.
   *
   *  Each id is the `assetId` returned by `POST /v1/media/presigned-url`
   *  for an upload that was then verified by
   *  `POST /v1/media/request-attachments/finalize`. The server attaches the
   *  assets inside the request-creation transaction and derives
   *  `ServiceRequest.mediaUrls` from them. URLs are not accepted on this
   *  wire. Cap is `MAX_REQUEST_MEDIA_ITEMS` (shared constant). */
  mediaAssetIds?: string[];
  /** @deprecated R06 rollout compatibility only. Clients built before R06
   *  always sent this field; the server tolerates an EMPTY list and ignores
   *  it. Any element is rejected. New clients must not send it. */
  mediaUrls?: [];
  scheduleType: ScheduleType;
  scheduledAt?: string | null;
  addressId?: string | null;
  manualAddress?: ManualAddressInput | null;
}
