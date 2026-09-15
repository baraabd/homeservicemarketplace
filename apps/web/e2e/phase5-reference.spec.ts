import { test } from '@playwright/test';

import { captureReference, cellDir, writeArtifact } from './phase5-capture';
import { LOCALES, PROVISIONAL_ROOT } from './phase5-evidence-ledger';
import { PHASE5_STATES } from './phase5-visual-states';

// Sprint 09B.29 Phase 5A — the REFERENCE half of the visual gate.
//
// Writes `expected.png` for all eighteen approved states in both languages,
// taken from the frozen prototype and from nowhere else.
//
// WHY IT IS ITS OWN SPEC
//
// Because the target must be capturable while the implementation is still
// wrong. Producing the expected image inside the comparison test would mean no
// target exists until the screen that is measured against it already renders —
// which is the wrong way round, and would leave the eighteen screens to be
// built from a reading of the HTML rather than from the picture it draws.
//
// It also needs no application, no API and no network: the prototype is a
// file:// document and every external asset is vendored. So it runs in seconds
// and is the first thing to re-run whenever the reference, the pinned icon
// build or the vendored fonts change.
//
// Run:  E2E_PHASE5=1 pnpm exec playwright test phase5-reference --project=chromium-desktop

test.describe('Phase 5A — approved prototype reference capture', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const state of PHASE5_STATES) {
    for (const locale of LOCALES) {
      test(`state ${state.id} (${state.slug}) ${locale}`, async ({ page }) => {
        const expected = await captureReference(page, state, locale);
        writeArtifact(cellDir(PROVISIONAL_ROOT, state, locale), 'expected.png', expected);
      });
    }
  }
});
