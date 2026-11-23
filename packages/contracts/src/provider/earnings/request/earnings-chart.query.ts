import type { EarningsChartRange } from '../response/earnings-chart';

// GET /v1/provider/earnings/chart?range=
//
// `range` defaults to '30d' on the server when absent or empty. Invalid
// values are rejected at the DTO layer (no silent coercion).
// K02 — `currency` selects one approved currency (default: the launch
// currency, SAR). A chart never mixes currencies.
export interface EarningsChartQuery {
  range?: EarningsChartRange;
  currency?: string;
}
