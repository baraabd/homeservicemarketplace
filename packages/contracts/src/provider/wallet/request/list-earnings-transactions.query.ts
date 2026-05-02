import type { BookingStatus } from '../../../seeker/bookings/enums/booking-status';

// GET /v1/me/provider/earnings/transactions
//
// Cursor-paginated list of bookings rendered as transactions.
// Default surface includes COMPLETED rows only; the optional
// `status` filter lets the UI pivot to scheduled / in-progress
// pipelines.
export interface ListEarningsTransactionsQuery {
  status?: BookingStatus;
  limit?: number;
  cursor?: string;
}
