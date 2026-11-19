/** Keep digit order and leading zeroes while accepting Arabic and Persian keyboards. */
export function normalizeDecimalDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/gu, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code - (code <= 0x669 ? 0x660 : 0x6f0));
  });
}
