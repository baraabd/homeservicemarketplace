// Sprint 9B.4 — which scanner adapter this process is allowed to bind.
//
// docs/adr/0009-restricted-identity-media.md §5
//
// The rule with teeth:
//
//   A PROCESS THAT BELIEVES IT IS PRODUCTION MUST NOT BIND THE TEST SCANNER.
//
// DeterministicTestScanner reports `isRealScanner = true`, and it has to:
// inside a test it IS the authority, and the quarantine path must be reachable.
// That also makes it the one adapter in the codebase capable of writing CLEAN
// without scanning anything. The only thing between it and production is this
// function, so the refusal is an exception at boot rather than a warning in a
// log nobody reads.
//
// `none` is treated differently on purpose. UnconfiguredMalwareScanner never
// returns CLEAN, so it cannot launder a verdict — evidence simply stays
// unreadable. Refusing to boot on it would take the whole API down for a
// feature that is merely degraded, so it boots and says so loudly.
//
// Pure, so all of it is asserted without booting Nest.

export const SCANNER_DRIVERS = ['none', 'test', 'clamav'] as const;
export type ScannerDriver = (typeof SCANNER_DRIVERS)[number];

/** Thrown at BOOT. A misconfigured scanner must stop the process, not degrade
 *  quietly into trusting every file. */
export class ScannerMisconfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScannerMisconfiguredError';
  }
}

export interface ScannerSelection {
  kind: ScannerDriver;
  /** True when the process should log that evidence cannot be cleared. */
  warn: boolean;
}

function isDriver(value: string): value is ScannerDriver {
  return (SCANNER_DRIVERS as readonly string[]).includes(value);
}

/**
 * Resolve the configured driver, refusing the combinations that are unsafe.
 *
 * An unrecognised value is an ERROR, never a fallback. Falling back to `none`
 * on a typo would mean `EVIDENCE_SCANNER_DRIVER=clamv` silently disables
 * scanning, and nothing downstream can tell the difference between "configured
 * off" and "misspelled". Refusing at boot makes a typo cost one restart
 * instead of a quarter of unscanned evidence.
 */
export function resolveScannerSelection(input: {
  driver: string | undefined | null;
  isProduction: boolean;
}): ScannerSelection {
  const raw = (input.driver ?? '').trim().toLowerCase();
  const driver: ScannerDriver = raw === '' ? 'none' : (raw as ScannerDriver);

  if (!isDriver(driver)) {
    throw new ScannerMisconfiguredError(
      `Unknown evidence scanner driver. Expected one of: ${SCANNER_DRIVERS.join(', ')}.`,
    );
  }

  if (driver === 'test' && input.isProduction) {
    // Deliberately says what is wrong and what to do, and names no value that
    // could be a secret.
    throw new ScannerMisconfiguredError(
      'The deterministic test scanner cannot be used in production: it can mark ' +
        'evidence CLEAN without scanning it. Configure a real scanner driver, or ' +
        'leave it unset to keep evidence unreadable.',
    );
  }

  return { kind: driver, warn: driver === 'none' && input.isProduction };
}
