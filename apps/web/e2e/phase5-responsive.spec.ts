import { expect, test, type Page } from '@playwright/test';

import { installPrecondition, reachState } from './phase5-app-states';
import { RESPONSIVE_VIEWPORTS, LOCALES, PROVISIONAL_ROOT } from './phase5-evidence-ledger';
import { PHASE5_STATES, type Phase5State } from './phase5-visual-states';
import { writeArtifact } from './phase5-capture';
import { phase5RunId } from './phase5-run-id';
import { assertFontsReady, freezeMotion } from './prototype-assets';

// Sprint 09B.29 Phase 5A — the eighteen states at every required width.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md
// .claude/rules/provider-onboarding-v2.md
//
// WHAT THIS IS FOR, AND WHY IT IS NOT THE PIXEL GATE
//
// Pixel parity is asserted at 390x844 and ONLY there, because 390 is the only
// width at which the frozen prototype supplies a target. The other five widths
// have no reference image and never will — asserting a ratio against one would
// be asserting against a picture nobody approved.
//
// What they do have is a CONTRACT, and it is the one the acceptance criteria
// state: a full-width single column below 640, a centred 480px column at and
// above it, no horizontal overflow anywhere, actions that stay reachable, and
// editable text that never drops below the size a phone will zoom to avoid.
// Those are measurable without a reference, and this is where they are
// measured.
//
// ONE TEST PER (STATE, LOCALE), SIX WIDTHS INSIDE IT
//
// The state is installed once and the viewport is resized, rather than booting
// the app 216 times. The checks are independent of each other and of order —
// each one reads the DOM as it stands at that width — so the saving costs
// nothing in isolation.
//
// Run:  E2E_PHASE5=1 E2E_PREBUILT=1 pnpm exec playwright test phase5-responsive --project=chromium-desktop

const RUN_ID = phase5RunId();

/** The width at which the approved design stops being a full-bleed column. */
const COLUMN_BREAKPOINT = 640;
/** The focused column's cap above that breakpoint. */
const COLUMN_MAX = 480;

interface WidthFinding {
  width: number;
  /** Every failure at this width, as a sentence. Empty is a pass. */
  problems: string[];
}

/**
 * Measure one width.
 *
 * Every check answers a rule from the acceptance criteria rather than a
 * preference, and each returns a SENTENCE rather than a boolean so a failure
 * names the rule it broke instead of printing `false`.
 */
async function measure(page: Page, state: Phase5State, width: number): Promise<string[]> {
  return page.evaluate(
    ({ width: w, breakpoint, columnMax, readySelector, primaryAction }) => {
      const problems: string[] = [];

      // ── No horizontal overflow, anywhere ──────────────────────────────
      //
      // The document first, then the specific element responsible — a page
      // that scrolls sideways is the single most common way a phone layout
      // fails, and "something overflows" is not a finding anybody can act on.
      const doc = document.documentElement;
      if (doc.scrollWidth > w + 1) {
        const culprits = [...document.querySelectorAll<HTMLElement>('body *')]
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && (rect.right > w + 1 || rect.left < -1);
          })
          .slice(0, 3)
          .map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)}`);
        problems.push(
          `document scrolls sideways (${doc.scrollWidth}px in ${w}px); widest: ${culprits.join(', ') || 'unknown'}`,
        );
      }

      // ── The screen is actually there ──────────────────────────────────
      const ready = document.querySelector(readySelector);
      if (!ready) {
        problems.push(`the state's own surface (${readySelector}) is not rendered`);
        return problems;
      }

      // ── The column policy ─────────────────────────────────────────────
      const shell = document.querySelector<HTMLElement>('[data-testid="onboarding-v2-shell"]');
      if (shell) {
        const rect = shell.getBoundingClientRect();
        if (w < breakpoint) {
          // Full-bleed below the breakpoint: no card inside a phone.
          if (Math.round(rect.width) !== w) {
            problems.push(`the column is ${Math.round(rect.width)}px wide in a ${w}px viewport`);
          }
        } else {
          if (Math.round(rect.width) > columnMax) {
            problems.push(
              `the column is ${Math.round(rect.width)}px wide, past the ${columnMax}px cap`,
            );
          }
          // Centred, not pinned to an edge.
          const leftGap = Math.round(rect.left);
          const rightGap = Math.round(w - rect.right);
          if (Math.abs(leftGap - rightGap) > 2) {
            problems.push(`the column is not centred (${leftGap}px left, ${rightGap}px right)`);
          }
        }
      }

      // ── The one dominant action stays reachable ───────────────────────
      if (primaryAction) {
        const action = document.querySelector<HTMLElement>(`[data-testid="${primaryAction}"]`);
        if (!action) {
          problems.push(`the primary action (${primaryAction}) is not rendered`);
        } else {
          const rect = action.getBoundingClientRect();
          if (rect.height < 44) {
            problems.push(`the primary action is ${Math.round(rect.height)}px tall, under 44`);
          }
          if (rect.right > w + 1 || rect.left < -1) {
            problems.push('the primary action runs off the side of the screen');
          }
          if (rect.top >= window.innerHeight || rect.bottom <= 0) {
            problems.push('the primary action is off-screen vertically');
          }
          // Nothing may sit on top of it — a sticky bar that covers its own
          // button is the defect the flex-sibling footer exists to prevent.
          const midX = rect.left + rect.width / 2;
          const midY = rect.top + rect.height / 2;
          const hit = document.elementFromPoint(midX, midY);
          if (hit && !action.contains(hit) && !hit.contains(action)) {
            problems.push(
              `the primary action is covered by ${hit.tagName.toLowerCase()}.${hit.className.toString().slice(0, 40)}`,
            );
          }
        }
      }

      // ── Editable text is never smaller than a phone will zoom for ─────
      for (const field of document.querySelectorAll<HTMLElement>('input, textarea, select')) {
        const style = getComputedStyle(field);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        // A visually-hidden file input is a real control with an accessible
        // name and no rendered text; its font size is not what a phone zooms
        // against.
        const rect = field.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) continue;
        if ((field as HTMLInputElement).type === 'checkbox') continue;
        const size = Number.parseFloat(style.fontSize);
        if (size < 16) {
          problems.push(
            `${field.tagName.toLowerCase()}[${(field as HTMLInputElement).type ?? ''}] renders text at ${size}px, under the 16px a phone zooms for`,
          );
        }
      }

      // ── Direction and language are declared, not assumed ──────────────
      if (!document.documentElement.lang) problems.push('the document declares no language');
      if (!document.documentElement.dir) problems.push('the document declares no direction');

      return problems;
    },
    {
      width,
      breakpoint: COLUMN_BREAKPOINT,
      columnMax: COLUMN_MAX,
      readySelector: state.readySelector,
      primaryAction: state.primaryAction,
    },
  );
}

test.describe('Phase 5A — the eighteen states at every required width', () => {
  test.describe.configure({ timeout: 180_000 });

  for (const state of PHASE5_STATES) {
    for (const locale of LOCALES) {
      test(`state ${state.id} (${state.slug}) ${locale}`, async ({ page }) => {
        await installPrecondition(page, state, locale);

        // Boot at the canonical width so the app starts in the geometry the
        // design was drawn for, then walk outward.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(state.route);
        await reachState(page, state);
        await page.waitForSelector(state.readySelector, { timeout: 20_000 });
        await assertFontsReady(page);
        await freezeMotion(page);

        const findings: WidthFinding[] = [];
        for (const viewport of RESPONSIVE_VIEWPORTS) {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          // Two frames: one for the resize, one for anything that reflows in
          // response to it.
          await page.evaluate(
            () =>
              new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          findings.push({
            width: viewport.width,
            problems: await measure(page, state, viewport.width),
          });
        }

        writeArtifact(
          `${PROVISIONAL_ROOT}/${state.slug}/${locale}`,
          'responsive.json',
          `${JSON.stringify(
            {
              runId: RUN_ID,
              stateId: state.id,
              slug: state.slug,
              locale,
              route: state.route,
              widths: findings,
            },
            null,
            2,
          )}\n`,
        );

        // Reported all at once rather than failing on the first width: a
        // layout that breaks at 320 usually breaks at 430 too, and fixing them
        // one run at a time is six runs.
        const broken = findings.filter((f) => f.problems.length > 0);
        expect(
          broken.map((f) => `${f.width}px: ${f.problems.join('; ')}`),
          'responsive contract',
        ).toEqual([]);
      });
    }
  }
});
