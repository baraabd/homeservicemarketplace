// Daily earnings buckets for the provider wallet chart.
//
// The server is the bucket authority — the API returns one row per
// calendar day in UTC across the requested range, zero-filled for days
// with no completed bookings. The client renders the array as-is; no
// JS-side date math required.
export type EarningsChartRange = '7d' | '30d' | '90d';

// K02 — one currency per chart. Buckets sum verified FIXED-price
// COMPLETED bookings in `currency` only (minor units at `amountScale`).
export interface EarningsChartBucket {
  // 'YYYY-MM-DD' (UTC). Stable, sortable, locale-independent.
  date: string;
  grossEarnings: number;
  completedBookings: number;
}

export interface EarningsChart {
  range: EarningsChartRange;
  // Inclusive ISO-8601 timestamps on the wire so the client can display
  // "Jan 12 → Feb 11" without recomputing the window.
  windowStart: string;
  windowEnd: string;
  currency: string;
  amountScale: number;
  buckets: EarningsChartBucket[];
}
