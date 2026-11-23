// K02 — the Saudi launch market and timezone-safe schedule conversion.
//
// A schedule is entered as a wall-clock date and time IN THE MARKET
// (Asia/Riyadh), stored as a UTC instant, and shown back in the market's
// zone. The browser's own time zone never takes part: a seeker travelling
// with a laptop set to Europe/Stockholm who picks "2026-11-04 00:30" for a
// Riyadh job gets 2026-11-03T21:30:00.000Z stored, and sees "00:30" again.
//
// The conversion is generic (any IANA zone, DST included) and uses only
// Intl, so it runs identically in Node and the browser.

export const LAUNCH_MARKET = Object.freeze({
  countryCode: 'SA',
  timeZone: 'Asia/Riyadh',
  dialCode: '+966',
  currency: 'SAR',
} as const);

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/u;

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function wallPartsAt(instantMs: number, timeZone: string): WallParts & { second: number } {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function offsetMsAt(instantMs: number, timeZone: string): number {
  const w = wallPartsAt(instantMs, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * Wall-clock date ("YYYY-MM-DD") and time ("HH:mm") in `timeZone` → the UTC
 * instant. Returns null for malformed input or a wall time that does not
 * exist in that zone (a DST spring-forward gap) — never a silently shifted
 * time.
 */
export function zonedWallTimeToUtc(date: string, time: string, timeZone: string): Date | null {
  const d = DATE_PATTERN.exec(date);
  const t = TIME_PATTERN.exec(time);
  if (!d || !t) return null;
  const wall: WallParts = {
    year: Number(d[1]),
    month: Number(d[2]),
    day: Number(d[3]),
    hour: Number(t[1]),
    minute: Number(t[2]),
  };
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31) return null;
  if (wall.hour > 23 || wall.minute > 59) return null;
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  // Two passes settle the offset across a DST transition.
  let guess = naive - offsetMsAt(naive, timeZone);
  guess = naive - offsetMsAt(guess, timeZone);
  const back = wallPartsAt(guess, timeZone);
  if (
    back.year !== wall.year ||
    back.month !== wall.month ||
    back.day !== wall.day ||
    back.hour !== wall.hour ||
    back.minute !== wall.minute
  ) {
    return null;
  }
  return new Date(guess);
}

/** UTC instant → wall-clock { date: "YYYY-MM-DD", time: "HH:mm" } in `timeZone`. */
export function utcToZonedWallTime(
  instant: Date | string,
  timeZone: string,
): { date: string; time: string } | null {
  const ms = typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  if (Number.isNaN(ms)) return null;
  const w = wallPartsAt(ms, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${w.year}-${pad(w.month)}-${pad(w.day)}`,
    time: `${pad(w.hour)}:${pad(w.minute)}`,
  };
}

/** Today's date ("YYYY-MM-DD") in `timeZone`, for a date picker's `min`. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return utcToZonedWallTime(now, timeZone)!.date;
}
