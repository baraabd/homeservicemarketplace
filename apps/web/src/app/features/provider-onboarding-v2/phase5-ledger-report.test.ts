import { describe, it } from 'vitest';

import {
  PROVISIONAL_ROOT,
  TASK_SCREENS,
  countersFrom,
  creditFor,
} from '../../../../e2e/phase5-evidence-ledger';
import { isSourceConformant } from './phase5-conformance.test';

// Sprint 09B.29 Phase 5 — the counters, printed.
//
// Not an assertion: a REPORT. The counters are computed by the ledger from
// artifacts on disk, and this prints them so a run's output says plainly what
// is credited and what each screen is still missing. A reviewer should never
// have to take a number from a commit message.

describe('Phase 5 ledger', () => {
  it('reports the official counters and the gaps behind them', () => {
    const credits = TASK_SCREENS.map((s) => creditFor(PROVISIONAL_ROOT, s, isSourceConformant(s)));
    const c = countersFrom(credits);

    const lines = [
      '',
      `presentation migrated:       ${c.presentationMigrated}/${c.total}`,
      `production-route integrated: ${c.productionRouteIntegrated}/${c.total}`,
      `real-API persisted:          ${c.realApiPersisted}/${c.total}`,
      '',
      ...credits.map(
        (cr) =>
          `  ${cr.screen.padEnd(28)} source=${cr.missing.includes('source conformance') ? 'FAIL' : 'ok'}` +
          `  missing: ${cr.missing.length === 0 ? '(none)' : cr.missing.join(', ')}`,
      ),
      '',
    ];
    console.log(lines.join('\n'));
  });
});
