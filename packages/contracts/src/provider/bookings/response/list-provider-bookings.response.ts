import type { ProviderBookingSummary } from './provider-booking-summary';

export interface ListProviderBookingsResponse {
  items: ProviderBookingSummary[];
  nextCursor: string | null;
}
