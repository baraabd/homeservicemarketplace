import type {
  CurrencyBookedValue,
  ExcludedAmountGroup,
  ExcludedAmountReason,
} from '@homeservicemarketplace/contracts';

// K02 — the single place booking amounts are aggregated for read models
// (provider wallet, legacy earnings, admin financials).
//
// Input is one row per (currency, amountScale, pricingType) group, as
// produced by BookingRepository.bookedValueGroups. Rules
// (hsm.amount-unit.v1):
//   • currencies are never added together;
//   • only verified (non-null scale) FIXED-price amounts are summed;
//   • legacy-unit and hourly-rate groups are reported as counts in
//     `excluded`, never dropped and never converted.

export interface BookedValueGroupRow {
  currency: string;
  amountScale: number | null;
  pricingType: 'FIXED' | 'HOURLY';
  completedCount: number;
  completedValue: number;
  currentMonthValue: number;
  inFlightCount: number;
  inFlightValue: number;
}

export interface BookedValueSummary {
  byCurrency: CurrencyBookedValue[];
  excluded: ExcludedAmountGroup[];
  completedCount: number;
}

export function summarizeBookedValue(rows: readonly BookedValueGroupRow[]): BookedValueSummary {
  const byCurrency = new Map<string, CurrencyBookedValue>();
  const excluded = new Map<string, ExcludedAmountGroup>();
  let completedCount = 0;
  for (const row of rows) {
    completedCount += row.completedCount;
    const reason: ExcludedAmountReason | null =
      row.amountScale === null
        ? 'LEGACY_UNVERIFIED'
        : row.pricingType === 'HOURLY'
          ? 'HOURLY_RATE'
          : null;
    if (reason) {
      const key = `${reason}:${row.currency}`;
      const hit = excluded.get(key) ?? {
        currency: row.currency,
        reason,
        completedCount: 0,
        inFlightCount: 0,
      };
      hit.completedCount += row.completedCount;
      hit.inFlightCount += row.inFlightCount;
      excluded.set(key, hit);
      continue;
    }
    // A verified row's scale is fixed per currency by the DB CHECK
    // constraint, so keying by currency alone cannot merge two scales. The
    // key still carries the scale so a future constraint change cannot
    // silently add amounts of different units.
    const key = `${row.currency}:${row.amountScale}`;
    const hit = byCurrency.get(key) ?? {
      currency: row.currency,
      amountScale: row.amountScale!,
      completedValue: 0,
      completedCount: 0,
      currentMonthValue: 0,
      inFlightValue: 0,
      inFlightCount: 0,
    };
    hit.completedValue = safeAdd(hit.completedValue, row.completedValue);
    hit.completedCount += row.completedCount;
    hit.currentMonthValue = safeAdd(hit.currentMonthValue, row.currentMonthValue);
    hit.inFlightValue = safeAdd(hit.inFlightValue, row.inFlightValue);
    hit.inFlightCount += row.inFlightCount;
    byCurrency.set(key, hit);
  }
  const order = (a: { currency: string }, b: { currency: string }) =>
    a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0;
  return {
    byCurrency: [...byCurrency.values()].sort(order),
    excluded: [...excluded.values()].sort(
      (a, b) => order(a, b) || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0),
    ),
    completedCount,
  };
}

function safeAdd(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    throw new Error('Booked value total exceeds the safe integer range');
  }
  return sum;
}

/** PostgreSQL SUM/COUNT come back as bigint; refuse a lossy conversion. */
export function toSafeNumber(value: bigint | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(n)) throw new Error('Aggregate exceeds the safe integer range');
  return n;
}
