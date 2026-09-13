import { randomUUID } from 'node:crypto';

// Sprint 09B.29 Phase 5A — one run id for the whole run, across every worker.
//
// WHY THIS IS NOT A MODULE CONSTANT
//
// It was, and the ledger caught it. `const RUN_ID = randomUUID()` at module
// scope is evaluated once per WORKER PROCESS, not once per run — and Playwright
// recycles workers freely, so a 36-cell run produced several ids and filed
// cells of the same screen under different ones. The ledger refuses that, by
// design:
//
//     evidence mixes runs: phase5-0ecd4524…, phase5-f4da6df9…
//
// and it is right to. Artifacts from two worker generations describe two
// moments, and "the screen passed" has to mean one build was photographed
// once. The failure was in the instrument, not in the rule.
//
// The fix is an environment variable, because that is the one thing a worker
// inherits from the process that launched it. Playwright's global setup runs in
// the parent before any worker is forked, so a value written there is visible
// to all of them and stays constant for the run.
export const PHASE5_RUN_ID_ENV = 'PHASE5_RUN_ID';

/** Read the run id, failing loudly rather than inventing a second one. */
export function phase5RunId(): string {
  const id = process.env[PHASE5_RUN_ID_ENV];
  if (!id) {
    throw new Error(
      `${PHASE5_RUN_ID_ENV} is not set. The Phase 5 global setup assigns it; ` +
        'running a phase5 spec without it would file evidence under a per-worker id.',
    );
  }
  return id;
}

/**
 * Global setup: stamp the run, once, in the parent process.
 *
 * An id supplied by the caller wins, so a CI job can correlate this run with
 * the build that produced the bundle it photographed.
 */
export default function globalSetup(): void {
  if (!process.env[PHASE5_RUN_ID_ENV]) {
    process.env[PHASE5_RUN_ID_ENV] = `phase5-${randomUUID()}`;
  }
}
