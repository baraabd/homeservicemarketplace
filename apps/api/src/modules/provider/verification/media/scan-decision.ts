import type { ScanVerdict } from './malware-scanner.port';

// Sprint 9B.4 — may this scan result change what is already on the row?
//
// docs/adr/0009-restricted-identity-media.md §5
//
// `scanStateForVerdict` in malware-scanner.port.ts answers "what does this
// verdict mean?". This answers the harder question: given what we ALREADY
// recorded, is this verdict allowed to overwrite it?
//
// That second question is where the security lives, because the scan path is
// retried, replayed and eventually re-run against newer signatures:
//
//   - a retry must not undo a verdict     SCAN_FAILED -> CLEAN is progress;
//                                          CLEAN -> SCAN_FAILED is amnesia
//   - a duplicate must be a no-op          the worker can see an event twice
//   - an outage must never clear a file    UNAVAILABLE is not evidence
//   - a rescan may only TIGHTEN            CLEAN -> QUARANTINED yes;
//                                          QUARANTINED -> CLEAN never
//
// Pure, so all of it is testable without a database or a scanner.

export type PersistedScanState =
  | 'PENDING'
  | 'CLEAN'
  | 'QUARANTINED'
  | 'SCAN_FAILED'
  /** Sprint 9B.4 — we refused the file itself: disallowed, malformed,
   *  truncated, or dishonestly labelled. Distinct from QUARANTINED, which
   *  means a scanner positively identified malware. Conflating the two would
   *  report a corrupted upload as an attack, and would hold an ordinary
   *  provider's broken PDF under the malware retention window. */
  | 'REJECTED';

/**
 * States that represent a decision already made about the file.
 *
 * SCAN_FAILED is deliberately NOT terminal: nobody judged the file, the
 * infrastructure did. That is precisely the case worth retrying.
 */
export const TERMINAL_SCAN_STATES = ['CLEAN', 'QUARANTINED', 'REJECTED'] as const;

export function isTerminalScanState(state: PersistedScanState): boolean {
  return (TERMINAL_SCAN_STATES as readonly string[]).includes(state);
}

/**
 * The read gate, in one place.
 *
 * Compared against CLEAN rather than against a list of bad states, so a state
 * added later is unreadable until someone deliberately makes it readable.
 */
export function isReadableScanState(state: PersistedScanState): boolean {
  return state === 'CLEAN';
}

export type ScanWriteDecision =
  | { write: true; next: PersistedScanState }
  | { write: false; reason: 'NO_CHANGE' | 'ALREADY_TERMINAL' };

const NO_CHANGE = { write: false, reason: 'NO_CHANGE' } as const;
const ALREADY_TERMINAL = { write: false, reason: 'ALREADY_TERMINAL' } as const;

/**
 * Whether this verdict may be written over the current state, and to what.
 *
 * Two distinct refusals, because they mean different things to an operator:
 * NO_CHANGE is "the row already says this" (a duplicate, or an outage that
 * changes nothing), ALREADY_TERMINAL is "we are refusing to loosen a decision
 * that has been made".
 */
export function decideScanWrite(input: {
  current: PersistedScanState;
  verdict: ScanVerdict;
  scanner: { isRealScanner: boolean };
}): ScanWriteDecision {
  const { current, verdict, scanner } = input;

  // Tightening first, and unconditionally. A positive malware identification
  // overrides everything except a decision that is already at least as
  // restrictive — including CLEAN, because signature databases improve and a
  // file cleared last month can be recognised today.
  if (verdict.state === 'INFECTED') {
    if (current === 'QUARANTINED' || current === 'REJECTED') {
      return current === 'QUARANTINED' ? NO_CHANGE : ALREADY_TERMINAL;
    }
    return { write: true, next: 'QUARANTINED' };
  }

  // Nothing below this line may loosen a decision that has been made.
  if (isTerminalScanState(current)) {
    if (current === 'CLEAN' && verdict.state === 'CLEAN') return NO_CHANGE;
    return ALREADY_TERMINAL;
  }

  switch (verdict.state) {
    case 'CLEAN':
      // The ONLY route to CLEAN, and it needs two conditions rather than one.
      // A misconfigured adapter that returns CLEAN without scanning must not
      // be able to clear evidence, so the adapter's own claim to be real is
      // part of the check.
      return scanner.isRealScanner ? { write: true, next: 'CLEAN' } : NO_CHANGE;

    case 'FAILED':
      // Recorded once, then left alone: rewriting it on every retry would make
      // updatedAt useless for spotting an asset that is genuinely stuck.
      return current === 'SCAN_FAILED' ? NO_CHANGE : { write: true, next: 'SCAN_FAILED' };

    case 'UNAVAILABLE':
      // Nothing to retry until someone configures a scanner, and the asset is
      // already unreadable. Leave the row alone.
      return NO_CHANGE;
  }
}
