import type { ServiceRequestStatus } from '../enums/service-request-status';

// GET /v1/me/requests
//
// All filters optional. The server scopes results to the authenticated
// Seeker — there is no userId / seekerUserId filter on the wire because
// it would only ever be the calling user's id anyway.
//
// `limit` is clamped server-side to keep responses bounded. `cursor`
// is the id of the last row from the previous page (cursor-by-id is
// stable; the underlying ordering uses [createdAt DESC, id DESC] so
// two rows sharing a createdAt never get skipped or duplicated).
export interface ListServiceRequestsQuery {
  status?: ServiceRequestStatus;
  limit?: number;
  cursor?: string;
}
