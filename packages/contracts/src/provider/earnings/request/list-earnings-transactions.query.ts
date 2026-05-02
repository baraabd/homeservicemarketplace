// GET /v1/provider/earnings/transactions
//
// Cursor-paginated list of COMPLETED-only earnings transactions. No
// status filter — the canonical wallet endpoint is COMPLETED-only.
// In-flight bookings surface on the summary via `pendingBalance`.
export interface ListProviderEarningsTransactionsQuery {
  cursor?: string;
  limit?: number;
}
