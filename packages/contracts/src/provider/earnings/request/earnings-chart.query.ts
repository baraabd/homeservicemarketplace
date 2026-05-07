import type { EarningsChartRange } from '../response/earnings-chart';

// GET /v1/provider/earnings/chart?range=
//
// `range` defaults to '30d' on the server when absent or empty. Invalid
// values are rejected at the DTO layer (no silent coercion).
export interface EarningsChartQuery {
  range?: EarningsChartRange;
}
