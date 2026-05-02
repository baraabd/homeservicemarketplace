import type { BookingStatus } from '../../../seeker/bookings/enums/booking-status';

// One transaction-shaped view of a provider booking. Currently the
// only revenue source is bookings, so the read model is a linear
// projection of the BookingRepository — but the contract leaves
// `kind` open for future sources (referrals, bonuses).
export interface ProviderEarningsTransaction {
  id: string;
  bookingId: string;
  status: BookingStatus;
  amount: number;
  currency: string;
  // ISO-8601 timestamp. For COMPLETED bookings this is the most
  // recent updatedAt (the moment the provider marked it done); for
  // SCHEDULED / IN_PROGRESS rows it's the booking's createdAt.
  occurredAt: string;
  // Lightweight ref so the UI can show "Plumbing — Riyadh".
  service: {
    categorySlug: string | null;
    categoryLabelEn: string | null;
    categoryLabelAr: string | null;
    customServiceText: string | null;
  };
  city: string;
}
