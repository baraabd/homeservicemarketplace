import {
  AmountUnitError,
  LAUNCH_CURRENCY,
  parseApprovedBidAmount,
} from '@homeservicemarketplace/contracts';

/**
 * K02 — the server's exact bid rule (parseApprovedBidAmount), run in the
 * form for an early message. Returns the refusal code, or null when the
 * decimal is acceptable. The server re-checks; this never decides alone.
 */
export function bidPriceError(value: string): AmountUnitError['code'] | null {
  try {
    parseApprovedBidAmount(value, LAUNCH_CURRENCY);
    return null;
  } catch (err) {
    if (err instanceof AmountUnitError) return err.code;
    throw err;
  }
}
