/** UTC wall-clock value for the manual settlement input (step=1). */
export function utcDatetimeLocal(date: Date): string {
  const seconds = date.toISOString().slice(0, 19);
  // Chromium omits zero seconds. Dropping nonzero seconds would backdate funds.
  return seconds.endsWith(':00') ? seconds.slice(0, 16) : seconds;
}
