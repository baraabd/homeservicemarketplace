import { LAUNCH_MARKET, todayInZone, zonedWallTimeToUtc } from '@homeservicemarketplace/contracts';

// K02 — the request wizard's date and time inputs are wall-clock values IN
// THE LAUNCH MARKET (Asia/Riyadh), whatever time zone the browser is set to.
// They are converted once to a UTC ISO instant for the API; a wall time that
// cannot exist in the zone returns null instead of a silently shifted time.
export function combineLocalDateTimeToIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  return zonedWallTimeToUtc(date, time, LAUNCH_MARKET.timeZone)?.toISOString() ?? null;
}

/** Today in the launch market, for the date input's `min` (past days disabled). */
export function todayLocalDateString(now: Date = new Date()): string {
  return todayInZone(LAUNCH_MARKET.timeZone, now);
}
