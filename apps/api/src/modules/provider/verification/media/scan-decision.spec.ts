import {
  decideScanWrite,
  isTerminalScanState,
  isReadableScanState,
  TERMINAL_SCAN_STATES,
  type PersistedScanState,
} from './scan-decision';
import type { ScanVerdict } from './malware-scanner.port';

// Sprint 9B.4 — which scan results are allowed to change what is on the row.
//
// The scanner decides what a file IS. This decides whether that answer may
// overwrite what we already recorded, which is a different question and the one
// that carries the security weight:
//
//   - a retry must not undo a verdict         (SCAN_FAILED -> CLEAN is fine;
//                                              CLEAN -> SCAN_FAILED is not)
//   - a duplicate result must be a no-op      (the worker may see an event twice)
//   - an outage must never clear a file       (UNAVAILABLE is not CLEAN)
//   - a rescan may only tighten               (CLEAN -> QUARANTINED yes,
//                                              QUARANTINED -> CLEAN never)
//
// Pure, so every one of those is asserted without a database or a scanner.

const REAL = { isRealScanner: true };
const FAKE = { isRealScanner: false };

const clean = (): ScanVerdict => ({ state: 'CLEAN', scannerId: 'test' });
const infected = (): ScanVerdict => ({
  state: 'INFECTED',
  scannerId: 'test',
  signature: 'EICAR-Test-File',
});
const failed = (): ScanVerdict => ({ state: 'FAILED', scannerId: 'test', reason: 'timeout' });
const unavailable = (): ScanVerdict => ({ state: 'UNAVAILABLE', reason: 'none configured' });

const decide = (current: PersistedScanState, verdict: ScanVerdict, scanner = REAL) =>
  decideScanWrite({ current, verdict, scanner });

describe('the state model itself', () => {
  it('treats exactly CLEAN, QUARANTINED and REJECTED as terminal', () => {
    expect([...TERMINAL_SCAN_STATES].sort()).toEqual(['CLEAN', 'QUARANTINED', 'REJECTED']);
    expect(isTerminalScanState('PENDING')).toBe(false);
    expect(isTerminalScanState('SCAN_FAILED')).toBe(false);
  });

  it('makes ONLY CLEAN readable', () => {
    // The single assertion the whole quarantine story rests on. Compared
    // against CLEAN rather than against a list of bad states, so a state added
    // later is unreadable by default.
    const all: PersistedScanState[] = [
      'PENDING',
      'CLEAN',
      'QUARANTINED',
      'SCAN_FAILED',
      'REJECTED',
    ];
    expect(all.filter(isReadableScanState)).toEqual(['CLEAN']);
  });
});

describe('a file nobody has judged yet', () => {
  it('becomes CLEAN when a real scanner clears it', () => {
    expect(decide('PENDING', clean())).toEqual({ write: true, next: 'CLEAN' });
  });

  it('becomes QUARANTINED when a scanner finds something', () => {
    expect(decide('PENDING', infected())).toEqual({ write: true, next: 'QUARANTINED' });
  });

  it('becomes SCAN_FAILED when the scanner errored', () => {
    expect(decide('PENDING', failed())).toEqual({ write: true, next: 'SCAN_FAILED' });
  });

  it('stays PENDING, with no write, when no scanner is configured', () => {
    // Not a failure to record — there is nothing to retry until someone
    // configures a scanner, and rewriting PENDING onto PENDING would churn
    // updatedAt on every sweep.
    expect(decide('PENDING', unavailable())).toEqual({ write: false, reason: 'NO_CHANGE' });
  });
});

describe('a fake scanner can never launder a verdict', () => {
  it('REFUSES to write CLEAN when the adapter is not a real scanner', () => {
    // The interesting failure is not a scanner that breaks. It is an adapter
    // that returns CLEAN without scanning anything.
    expect(decide('PENDING', clean(), FAKE)).toEqual({ write: false, reason: 'NO_CHANGE' });
  });

  it('still lets a non-real adapter QUARANTINE', () => {
    // Tightening is always allowed, whoever says so.
    expect(decide('PENDING', infected(), FAKE)).toEqual({ write: true, next: 'QUARANTINED' });
  });
});

describe('retrying after the scanner broke', () => {
  it('clears a file whose earlier scan failed', () => {
    expect(decide('SCAN_FAILED', clean())).toEqual({ write: true, next: 'CLEAN' });
  });

  it('quarantines a file whose earlier scan failed', () => {
    expect(decide('SCAN_FAILED', infected())).toEqual({ write: true, next: 'QUARANTINED' });
  });

  it('is a no-op when the retry fails the same way', () => {
    // The worker retries on a schedule; rewriting the same state on every
    // attempt would make updatedAt useless for spotting a stuck asset.
    expect(decide('SCAN_FAILED', failed())).toEqual({ write: false, reason: 'NO_CHANGE' });
  });

  it('does not fall back to PENDING when the scanner becomes unavailable', () => {
    expect(decide('SCAN_FAILED', unavailable())).toEqual({ write: false, reason: 'NO_CHANGE' });
  });
});

describe('a verdict already recorded', () => {
  it('ignores a duplicate CLEAN', () => {
    expect(decide('CLEAN', clean())).toEqual({ write: false, reason: 'NO_CHANGE' });
  });

  it('ignores a duplicate INFECTED', () => {
    expect(decide('QUARANTINED', infected())).toEqual({ write: false, reason: 'NO_CHANGE' });
  });

  it('never un-quarantines a file, however many times a scanner clears it', () => {
    // The one transition that would be catastrophic. A signature update, a
    // replayed event, or a second scanner disagreeing must not release
    // something already judged malicious.
    expect(decide('QUARANTINED', clean())).toEqual({ write: false, reason: 'ALREADY_TERMINAL' });
  });

  it('never un-rejects a file', () => {
    expect(decide('REJECTED', clean())).toEqual({ write: false, reason: 'ALREADY_TERMINAL' });
    expect(decide('REJECTED', infected())).toEqual({ write: false, reason: 'ALREADY_TERMINAL' });
  });

  it('lets a rescan TIGHTEN a clean file to quarantined', () => {
    // The only overwrite of a terminal state that is allowed, because it is
    // the only one that makes the system more restrictive. Signature databases
    // improve; a file cleared last month can be recognised today.
    expect(decide('CLEAN', infected())).toEqual({ write: true, next: 'QUARANTINED' });
  });

  it('does NOT let an outage or an error undo CLEAN', () => {
    // A reviewer may already have acted on this document. A transient scanner
    // problem is not evidence about the file.
    expect(decide('CLEAN', failed())).toEqual({ write: false, reason: 'ALREADY_TERMINAL' });
    expect(decide('CLEAN', unavailable())).toEqual({ write: false, reason: 'ALREADY_TERMINAL' });
  });
});

describe('the whole matrix stays fail-closed', () => {
  const states: PersistedScanState[] = [
    'PENDING',
    'CLEAN',
    'QUARANTINED',
    'SCAN_FAILED',
    'REJECTED',
  ];
  const verdicts: ScanVerdict[] = [clean(), infected(), failed(), unavailable()];

  it('never produces REJECTED from a scan verdict', () => {
    // REJECTED means "we refused this file", which is a validation decision.
    // A scanner has no opinion about it, and conflating the two would report
    // a malformed upload as a malware finding.
    for (const s of states) {
      for (const v of verdicts) {
        const d = decide(s, v);
        if (d.write) expect(d.next).not.toBe('REJECTED');
      }
    }
  });

  it('only ever reaches CLEAN via a real scanner saying CLEAN', () => {
    for (const s of states) {
      for (const v of verdicts) {
        for (const scanner of [REAL, FAKE]) {
          const d = decide(s, v, scanner);
          if (d.write && d.next === 'CLEAN') {
            expect(v.state).toBe('CLEAN');
            expect(scanner.isRealScanner).toBe(true);
          }
        }
      }
    }
  });

  it('never writes a state that is not one of the five', () => {
    for (const s of states) {
      for (const v of verdicts) {
        const d = decide(s, v);
        if (d.write) expect(states).toContain(d.next);
      }
    }
  });
});
