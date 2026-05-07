import type { AddressSnapshot } from '../../../seeker/requests/response/address-snapshot';
import type { BookingStatus } from '../../../seeker/bookings/enums/booking-status';
import type { PricingType } from '../../../seeker/bids/enums/pricing-type';

// Lightweight ref to the seeker on a booking the provider can see.
// At this point a bid has been accepted, so revealing the seeker's
// first name and the address is necessary for the provider to
// actually do the job. Email + phone are NOT included — those flow
// through the Conversation surface instead.
export interface ProviderBookingSeekerRef {
  firstName: string;
  // City + country is repeated under addressSnapshot but kept here as
  // a convenience for list-card UIs that don't want to dig into the
  // snapshot.
  city: string;
}

export interface ProviderBookingServiceRef {
  categorySlug: string | null;
  categoryLabelEn: string | null;
  categoryLabelAr: string | null;
  customServiceText: string | null;
}

// Row shape for the provider's booking list. Carries the full address
// snapshot (line1 included) because acceptance has already happened —
// the provider needs the precise location to perform the job.
export interface ProviderBookingSummary {
  id: string;
  requestId: string;
  bidId: string;
  status: BookingStatus;
  scheduledAt: string | null;
  priceAmount: number;
  currency: string;
  pricingType: PricingType;
  bidNote: string | null;
  createdAt: string;
  updatedAt: string;
  service: ProviderBookingServiceRef;
  seeker: ProviderBookingSeekerRef;
  addressSnapshot: AddressSnapshot;
}
