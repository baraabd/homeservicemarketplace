import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { captureReference, cellDir, diffImages, writeArtifact } from './phase5-capture';
import { installPrecondition, reachState } from './phase5-app-states';
import {
  CANONICAL_VIEWPORT,
  LOCALES,
  PROVISIONAL_ROOT,
  REQUIRED_AXE_TAGS,
} from './phase5-evidence-ledger';
import { PHASE5_STATES, type Phase5State } from './phase5-visual-states';
import { assertFontsReady, freezeMotion } from './prototype-assets';
import { phase5RunId } from './phase5-run-id';

// Sprint 09B.29 Phase 5A — the eighteen approved states, measured.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md
//
// ONE TEST PER CANONICAL CELL, AND WHY IT IS SELF-CONTAINED
//
// Each test captures the REFERENCE from the frozen prototype, captures the
// APPLICATION at the same canonical box, measures the difference, draws it,
// and scans the rendered screen for accessibility violations. Doing all four
// in one test is what makes the four artifacts describe the same moment: a
// reference captured by an earlier run and an implementation captured by a
// later one would be a comparison across two builds, which the ledger refuses
// by run id and which would otherwise be easy to produce by accident.
//
// WHAT THIS RUN CAN AND CANNOT EARN
//
// Presentation credit only. It is filed under `PROVISIONAL_UI` because it
// stubs the API — see `phase5-app-states.ts` — and the ledger keeps that
// namespace permanently separate from `FINAL_REAL_API`. A screen that passes
// every cell here has been shown to RENDER correctly and to be free of axe
// violations. It has not been shown to talk to a server, and nothing here
// claims it has.
//
// Run:  E2E_PHASE5=1 E2E_PREBUILT=1 pnpm exec playwright test phase5-visual --project=chromium-desktop

/**
 * One id for the whole run, assigned in global setup.
 *
 * NOT generated here: this module is evaluated once per WORKER, and Playwright
 * recycles workers, so a local constant produced several ids in one run and the
 * ledger correctly refused the mixed evidence. See phase5-run-id.ts.
 */
const RUN_ID = phase5RunId();

/**
 * Settle the application before the shutter opens.
 *
 * Fonts first, because a capture taken before Inter or Cairo is usable is a
 * capture of Arial and differs from the reference on every glyph. Motion is
 * frozen second so a transition that is mid-flight cannot contribute a blur
 * that reads as a layout difference.
 */
async function settle(page: Page, state: Phase5State): Promise<void> {
  await page.waitForSelector(state.readySelector, { timeout: 20_000 });
  await assertFontsReady(page);
  await freezeMotion(page);

  // The registry says where each state must be read from. `bottom` exists
  // because three approved screens are the LOWER half of a longer task — the
  // experience section, the portfolio grid, the terms block — and capturing
  // them at the top would photograph the wrong screen entirely.
  if (state.scroll === 'bottom') {
    await page.evaluate(() => {
      const scroller = document.querySelector('main');
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      else window.scrollTo(0, document.body.scrollHeight);
    });
  }

  // One frame for the scroll and the frozen styles to be painted.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

test.describe('Phase 5A — approved states, EN and AR at 390x844', () => {
  test.describe.configure({ timeout: 180_000 });

  for (const state of PHASE5_STATES) {
    for (const locale of LOCALES) {
      test(`state ${state.id} (${state.slug}) ${locale}`, async ({ page }) => {
        const dir = cellDir(PROVISIONAL_ROOT, state, locale);

        // ── The reference, from the frozen prototype and nowhere else ─────
        const expected = await captureReference(page, state, locale);
        writeArtifact(dir, 'expected.png', expected);

        // ── The application, at the canonical box ─────────────────────────
        await installPrecondition(page, state, locale);
        await page.setViewportSize({ ...CANONICAL_VIEWPORT });
        await page.goto(state.route);
        await reachState(page, state);
        await settle(page, state);

        const actual = await page.screenshot();
        writeArtifact(dir, 'actual.png', actual);

        // ── The words, in the locale under test ───────────────────────────
        //
        // A pixel ratio cannot tell a correct sentence from a plausible one:
        // two strings of the same length in the same font differ by a few
        // hundred pixels, which is well inside the budget. The registry names
        // what each state MUST say, and this is where that stops being a
        // comment.
        //
        // `innerText` rather than `textContent`, so it reads what is rendered —
        // including a deliberately screen-reader-only sentence, which the
        // approved confirmation uses to keep an ADR-0005 promise the design
        // makes with a shape rather than with words.
        const rendered = await page.locator('body').innerText();
        const missingCopy = state.requiredCopy[locale].filter(
          (phrase) => !rendered.includes(phrase),
        );
        writeArtifact(
          dir,
          'copy.json',
          `${JSON.stringify(
            {
              runId: RUN_ID,
              stateId: state.id,
              locale,
              required: state.requiredCopy[locale],
              missing: missingCopy,
            },
            null,
            2,
          )}\n`,
        );

        // ── The four lifecycle answers, row by row ────────────────────────
        //
        // Scoped to each row's own testid, never a body-wide text search. The
        // difference is not pedantry: state 14 shows "In review" on BOTH the
        // specialty row and the verification row, so a page-wide search for
        // that phrase still passes when the verification row has fallen back to
        // "Unavailable". Proven, not assumed — stubbing the case endpoint to
        // return null left a body search green and this check red.
        //
        // The tone travels with the word because the badge encodes status twice
        // over, which is a WCAG requirement rather than decoration: "Action
        // needed" in the waiting colour tells a provider to keep waiting.
        const axisAnswers: Record<string, { status: string; tone: string | null }> = {};
        const axisProblems: string[] = [];
        for (const [rowId, want] of Object.entries(state.axisAnswers ?? {})) {
          const row = page.locator(`[data-testid="axis-${rowId}"]`);
          if ((await row.count()) !== 1) {
            axisProblems.push(
              `axis-${rowId}: expected exactly one row, found ${await row.count()}`,
            );
            continue;
          }
          // The `dd` is the badge; the `dt` is the label. Reading the whole row
          // would let the label satisfy an assertion about the answer.
          const status = (await row.locator('dd').innerText()).trim();
          const tone = await row.getAttribute('data-tone');
          axisAnswers[rowId] = { status, tone };
          const wantStatus = locale === 'ar' ? want.ar : want.en;
          if (status !== wantStatus) {
            axisProblems.push(
              `axis-${rowId}: said "${status}", approved screen says "${wantStatus}"`,
            );
          }
          if (tone !== want.tone) {
            axisProblems.push(`axis-${rowId}: tone "${tone}", approved screen says "${want.tone}"`);
          }
        }
        writeArtifact(
          dir,
          'axes.json',
          `${JSON.stringify(
            {
              runId: RUN_ID,
              stateId: state.id,
              locale,
              expected: state.axisAnswers ?? null,
              rendered: axisAnswers,
              problems: axisProblems,
            },
            null,
            2,
          )}
`,
        );

        // ── The measurement ───────────────────────────────────────────────
        const outcome = diffImages(expected, actual);
        writeArtifact(dir, 'diff.png', outcome.diff);
        writeArtifact(
          dir,
          'metrics.json',
          `${JSON.stringify(
            {
              runId: RUN_ID,
              stateId: state.id,
              slug: state.slug,
              locale,
              referenceKey: state.referenceKey,
              route: state.route,
              viewport: CANONICAL_VIEWPORT,
              diffPixelRatio: outcome.diffPixelRatio,
              comparable: outcome.comparable,
              note: outcome.note,
            },
            null,
            2,
          )}\n`,
        );

        // ── Accessibility, on the same rendered screen ────────────────────
        //
        // No `disableRules`, no `exclude`. The ledger refuses a scan that
        // narrowed itself, because that is precisely how a contrast failure
        // becomes invisible.
        const axe = await new AxeBuilder({ page }).withTags([...REQUIRED_AXE_TAGS]).analyze();

        writeArtifact(
          dir,
          'axe.json',
          `${JSON.stringify(
            {
              runId: RUN_ID,
              stateId: state.id,
              locale,
              url: page.url(),
              viewport: CANONICAL_VIEWPORT,
              testEngine: axe.testEngine,
              toolOptions: axe.toolOptions,
              violations: axe.violations,
            },
            null,
            2,
          )}\n`,
        );

        // The assertions are LAST, so every artifact exists whatever the
        // verdict. A failing cell that produced no diff image is a cell
        // nobody can debug.
        expect(missingCopy, `required copy missing in ${locale}`).toEqual([]);
        expect(axisProblems, 'lifecycle axis answers').toEqual([]);
        expect(outcome.comparable, `geometry: ${outcome.note ?? 'comparable'}`).toBe(true);
        expect(
          axe.violations.map((v) => `${v.id} (${v.nodes.length})`),
          'accessibility violations',
        ).toEqual([]);
        expect(outcome.diffPixelRatio, 'diffPixelRatio').toBeLessThanOrEqual(0.005);
      });
    }
  }
});
