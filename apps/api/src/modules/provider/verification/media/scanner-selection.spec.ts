import {
  resolveScannerSelection,
  ScannerMisconfiguredError,
  SCANNER_DRIVERS,
  type ScannerDriver,
} from './scanner-selection';

// Sprint 9B.4 — which scanner adapter this process is allowed to bind.
//
// The rule with teeth:
//
//   A PROCESS THAT BELIEVES IT IS PRODUCTION MUST NOT BIND THE TEST SCANNER.
//
// DeterministicTestScanner reports isRealScanner = true, because inside a test
// it IS the authority and the quarantine path has to be reachable. That makes
// it the one adapter capable of writing CLEAN without scanning anything, and
// the only thing standing between it and production is this selection. So the
// refusal is an exception at boot, not a warning in a log nobody reads.
//
// Pure, so it is asserted without booting Nest.

const sel = (driver: string, isProduction = false) =>
  resolveScannerSelection({ driver, isProduction });

describe('the driver list', () => {
  it('is exactly none, test and clamav', () => {
    expect([...SCANNER_DRIVERS].sort()).toEqual(['clamav', 'none', 'test']);
  });
});

describe('development and test environments', () => {
  it('defaults to none when nothing is configured', () => {
    // The default must be the adapter that never returns CLEAN. A developer who
    // configures nothing gets evidence that uploads and is unreadable, which is
    // a visible, diagnosable failure rather than silent trust.
    expect(sel('').kind).toBe('none');
    expect(sel(undefined as unknown as string).kind).toBe('none');
  });

  it('allows the deterministic test scanner', () => {
    expect(sel('test').kind).toBe('test');
  });

  it('allows clamav', () => {
    expect(sel('clamav').kind).toBe('clamav');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(sel('  ClamAV ').kind).toBe('clamav');
  });

  it('refuses a driver it does not recognise rather than falling back', () => {
    // Falling back to `none` on a typo would mean CLAMAV_DRIVER=clamv silently
    // disables scanning. Refusing at boot makes the typo cost one restart
    // instead of a quarter of unscanned evidence.
    expect(() => sel('clamv')).toThrow(ScannerMisconfiguredError);
  });
});

describe('production', () => {
  it('REFUSES the deterministic test scanner', () => {
    // The assertion this file exists for.
    expect(() => sel('test', true)).toThrow(ScannerMisconfiguredError);
  });

  it('names the problem without naming a secret', () => {
    let message = '';
    try {
      sel('test', true);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/production/i);
    expect(message).toMatch(/test/i);
  });

  it('allows a real scanner', () => {
    expect(sel('clamav', true).kind).toBe('clamav');
  });

  it('allows none, loudly', () => {
    // `none` is not a fake clean scanner — it never returns CLEAN, so it
    // cannot launder anything. Refusing to boot on it would take the whole API
    // down for a feature that is merely degraded, so it boots and says so.
    const s = sel('', true);
    expect(s.kind).toBe('none');
    expect(s.warn).toBe(true);
  });

  it('does not warn when a real scanner is configured', () => {
    expect(sel('clamav', true).warn).toBe(false);
  });

  it('still refuses an unrecognised driver', () => {
    expect(() => sel('nope', true)).toThrow(ScannerMisconfiguredError);
  });
});

describe('every driver resolves to itself outside production', () => {
  it.each([...SCANNER_DRIVERS])('%s', (driver: ScannerDriver) => {
    expect(sel(driver).kind).toBe(driver);
  });
});
