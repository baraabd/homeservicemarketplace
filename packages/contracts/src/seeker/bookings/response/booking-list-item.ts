import type { ProviderBidSummary } from '../../bids/response/provider-bid-summary';
import type { PricingType } from '../../bids/enums/pricing-type';
import type { AddressSnapshot } from '../../requests/response/address-snapshot';
import type { BookingStatus } from '../enums/booking-status';

// Row shape returned by the bookings list endpoint. Carries everything
// the Bookings tab card needs to render: status badge, service label,
// scheduled time, provider strip (avatar + name + rating), price, and
// the address snapshot.
//
// `service` is denormalized from the service-request the booking was
// created against; `provider` re-uses the Bid's ProviderBidSummary
// shape so the frontend has one Provider DTO across both surfaces.
//
// Private fields (seekerUserId, providerId-on-the-bid, deletedAt) are
// intentionally NOT included — the seeker only ever sees their own
// bookings, so denormalizing those would only widen the leak surface.
export interface BookingListItem {
  id: string;
  requestId: string;
  bidId: string;
  status: BookingStatus;
  scheduledAt: string | null;
  priceAmount: number;
  currency: string;
  pricingType: PricingType;
  createdAt: string;
  // Service that was booked (snapshotted at acceptance time via the
  // request the bid was placed against). Either categoryLabel* or
  // customServiceText is populated — the frontend should prefer the
  // category label when present.
  service: {
    categorySlug: string | null;
    categoryLabelEn: string | null;
    categoryLabelAr: string | null;
    customServiceText: string | null;
  };
  // Lightweight provider summary — public reputation signals only.
  provider: ProviderBidSummary;
  // Snapshot at request-create time; matches ServiceRequestSummary
  // so future surfaces can re-use existing render code.
  addressSnapshot: AddressSnapshot;
}
