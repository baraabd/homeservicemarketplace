import { describe, it } from 'vitest';

import {
  FINAL_REAL_API_ROOT,
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
    // Two roots, because there are two runs. The visual gate writes cells
    // under PROVISIONAL_UI with every /v1/** call stubbed; the real-API job
    // writes route and persistence markers under FINAL_REAL_API with nothing
    // stubbed at all. Reading both from one root is what held route and
    // persistence at 0/6 after the markers started being written.
    const credits = TASK_SCREENS.map((s) =>
      creditFor(PROVISIONAL_ROOT, s, isSourceConformant(s), {}, FINAL_REAL_API_ROOT),
    );
    const c = countersFrom(credits);

    const lines = [
      '',
      `presentation migrated:       ${c.presentationMigrated}/${c.total}`,
      `production-route integrated: ${c.productionRouteIntegrated}/${c.total}`,
      `real-API persisted:          ${c.realApiPersisted}/${c.total}`,
      '',
      ...credits.flatMap((cr) => [
        `  ${cr.screen}`,
        `      presentation: ${cr.presentationMigrated ? 'CREDITED' : cr.missing.presentation.join(' | ') || 'incomplete'}`,
        `      route:        ${cr.productionRouteIntegrated ? 'CREDITED' : cr.missing.route.join(' | ') || 'incomplete'}`,
        `      persistence:  ${cr.realApiPersisted ? 'CREDITED' : cr.missing.persistence.join(' | ') || 'incomplete'}`,
      ]),
      '',
    ];
    console.log(lines.join('\n'));
  });
});
