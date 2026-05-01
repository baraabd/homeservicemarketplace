import type { BookingSummary } from '../../bookings/response/booking-summary';
import type { ServiceRequestStatus } from '../../requests/enums/service-request-status';
import type { BidSummary } from './bid-summary';

// POST /v1/me/requests/:requestId/bids/:bidId/accept
//
// Returned after a successful transactional accept. Carries:
//   - the post-acceptance bid (status now ACCEPTED)
//   - the freshly created booking
//   - the updated request status so the frontend can transition the
//     parent UI without a follow-up GET
//
// Sibling bids on the same request that were PENDING are also moved
// to REJECTED inside the same transaction; the response does NOT
// echo them — the frontend re-reads the bids list via React Query
// invalidation, which is cheap and avoids a chunky response payload.
export interface AcceptBidResponse {
  bid: BidSummary;
  booking: BookingSummary;
  requestStatus: ServiceRequestStatus;
}
