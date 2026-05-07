import type { ProviderBookingDetail } from './provider-booking-detail';

// Returned by start / complete / cancel. The mutation echoes the full
// detail shape so the frontend can replace its cached row in one
// step.
export interface ProviderBookingMutationResponse {
  booking: ProviderBookingDetail;
}
