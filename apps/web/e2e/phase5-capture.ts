import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { expect, type Frame, type Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

import {
  assertFontsReady,
  freezeMotion,
  injectVendoredFonts,
  neutraliseHarnessFontWeight,
  serveVendoredAssets,
} from './prototype-assets';
import { CANONICAL_VIEWPORT, type Locale } from './phase5-evidence-ledger';
import type { Phase5State } from './phase5-visual-states';

// Sprint 09B.29 Phase 5A — the capture instrument.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md
//
// WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
//
// It is the shared geometry pipeline for BOTH halves of the visual gate, so
// the reference and the implementation are photographed the same way. It is
// NOT a judge: it writes artifacts and measures pixels, and the ledger — which
// this file cannot reach — decides what any of it is worth.
//
// The expected image ALWAYS comes from the frozen prototype. Nothing here can
// produce an expected.png from the React tree, which is the one substitution
// that would make the whole gate self-referential.

const HERE = dirname(fileURLToPath(import.meta.url));

export const PROTOTYPE_URL = pathToFileURL(
  join(
    HERE,
    '..',
    '..',
    '..',
    'docs',
    'provider-experience-v2',
    'reference',
    'provider-onboarding-prototype.html',
  ),
).href;

/**
 * The prototype's own design width, and the 32px gutter its wrapper adds.
 *
 * `body { padding: 1rem }` on the outer document plus a `width: 100%` iframe
 * means the phone column is the viewport minus 32px. Widening the page by the
 * gutter gives the phone its natural 390px; `assertCanonicalGeometry` below is
 * what stops that drifting silently.
 */
const PROTOTYPE_VIEWPORT = {
  width: CANONICAL_VIEWPORT.width + 32,
  height: CANONICAL_VIEWPORT.height + 120,
};

/**
 * Normalise the reference to the canonical capture box.
 *
 * Three harness facts are removed, and each is harness rather than design:
 *
 *   the 1px bezel   `.hsm-phone` is the prototype's DEVICE MOCK — a 28px
 *                   radius, a border and a drop shadow, sitting next to a
 *                   toolbar labelled "Prototype controls". Its border steals
 *                   2px from the surface inside it, so the product area is
 *                   388px rather than the 390px the design names. Recorded as
 *                   conflict C4 in SPRINT_09B29_BASELINE.md §7.
 *
 *   the 764px box   the mock is a fixed-height phone; the product is a
 *                   viewport. Pinning the content box to the canonical 844px
 *                   is what makes `.hsm-sticky` (absolute, bottom: 0) sit
 *                   where the product's sticky bar sits, instead of 80px up.
 *
 *   overflow        a real viewport clips; the mock grows. Without this an
 *                   Arabic screen that runs long produces a 900px-tall
 *                   "390x844" capture and the comparison is refused for a
 *                   geometry mismatch that is really a harness artefact.
 *
 * Nothing on disk is modified. The frozen file is opened read-only and these
 * rules are injected into the rendered document, which is exactly what
 * `injectVendoredFonts` and `neutraliseHarnessFontWeight` already do.
 */
async function pinReferenceGeometry(frame: Frame): Promise<void> {
  await frame.evaluate(
    ({ width, height }) => {
      const style = document.createElement('style');
      style.setAttribute('data-phase5-geometry', 'true');
      style.textContent = [
        `#hsm-provider-journey .hsm-phone{width:${width}px;min-width:${width}px;`,
        `border:0!important;border-radius:0!important;box-shadow:none!important;`,
        `min-height:${height}px!important;height:${height}px!important;overflow:hidden}`,
        `#hsm-provider-journey #hsm-phone-content{width:${width}px;`,
        `min-height:${height}px!important;height:${height}px!important;overflow:hidden}`,
        `#hsm-provider-journey .hsm-phone-inner{min-height:${height}px!important;`,
        `height:${height}px!important;overflow:hidden}`,
        // The safe-area strip lives inside the bezel and outside the captured
        // surface; hiding it stops it eating 16px of the pinned height.
        `#hsm-provider-journey .hsm-safe-top{display:none!important}`,
      ].join('');
      document.head.appendChild(style);
    },
    { width: CANONICAL_VIEWPORT.width, height: CANONICAL_VIEWPORT.height },
  );
}

/** Open the frozen prototype and return the frame its markup lives in. */
export async function openPrototype(page: Page): Promise<Frame> {
  const { missing } = await serveVendoredAssets(page);

  await page.setViewportSize(PROTOTYPE_VIEWPORT);
  await page.goto(PROTOTYPE_URL);

  // The markup is inside a sandboxed `srcdoc` iframe. Playwright reaches it
  // over the browser protocol, so the absent `allow-same-origin` is not a
  // barrier the way it would be for script in the page.
  await page.waitForSelector('iframe');
  const frame = page.frames().find((f) => f !== page.mainFrame());
  expect(frame, 'the prototype iframe should be attached').toBeTruthy();

  await frame!.waitForSelector('#hsm-screen-picker');
  await frame!.waitForSelector('#hsm-phone-content');

  await injectVendoredFonts(frame!);
  await neutraliseHarnessFontWeight(frame!);
  await pinReferenceGeometry(frame!);
  await freezeMotion(frame!);
  await assertFontsReady(frame!);
  await waitForIcons(frame!);

  expect(missing, `every external asset must be vendored; unserved: ${missing.join(', ')}`).toEqual(
    [],
  );

  return frame!;
}

/**
 * Icons are drawn by the pinned lucide build, and re-created on every render.
 *
 * Without this a capture can be taken between the innerHTML swap and the icon
 * pass, which produces a plausible-looking screen with empty `<i>` boxes where
 * every glyph should be — the failure mode that is hardest to notice by eye
 * and impossible to notice in a ratio.
 */
async function waitForIcons(frame: Frame): Promise<void> {
  await frame.waitForFunction(
    () => document.querySelectorAll('#hsm-phone-content svg').length > 0,
    undefined,
    { timeout: 15_000 },
  );
}

/** Select a prototype screen by its own `hsmScreens` index. */
export async function selectPrototypeScreen(frame: Frame, index: number): Promise<void> {
  await frame.selectOption('#hsm-screen-picker', String(index));
  await frame.waitForFunction(
    (i) => (document.getElementById('hsm-screen-picker') as HTMLSelectElement).value === String(i),
    index,
  );
  await waitForIcons(frame);
}

/**
 * Put the prototype into a language.
 *
 * `#hsm-lang` is a TOGGLE that starts in Arabic and whose label names the
 * language it will switch TO. Reading the current direction and pressing only
 * when it disagrees is what makes this idempotent — clicking blindly flips
 * whatever it happens to find, which silently swapped half the matrix.
 */
export async function setPrototypeLanguage(frame: Frame, locale: Locale): Promise<void> {
  const want = locale === 'ar' ? 'rtl' : 'ltr';
  const current = await frame.getAttribute('.hsm-phone-inner', 'dir');
  if (current !== want) await frame.click('#hsm-lang');
  await frame.waitForFunction(
    (dir) => document.querySelector('.hsm-phone-inner')?.getAttribute('dir') === dir,
    want,
  );
  await waitForIcons(frame);
}

/** The captured surface must be exactly the canonical box, and it is asserted. */
export async function assertCanonicalGeometry(frame: Frame): Promise<void> {
  const box = await frame.locator('#hsm-phone-content').boundingBox();
  expect(Math.round(box?.width ?? 0), 'reference surface width').toBe(CANONICAL_VIEWPORT.width);
  expect(Math.round(box?.height ?? 0), 'reference surface height').toBe(CANONICAL_VIEWPORT.height);
}

/**
 * Capture one approved screen from the frozen prototype.
 *
 * The language is set, the screen selected, and then the language set AGAIN:
 * selecting a screen re-renders it through `hsmRefresh`, and the direction has
 * to be re-asserted against the markup that actually ended up on screen rather
 * than the one that was there when the request was made.
 */
export async function captureReference(
  page: Page,
  state: Phase5State,
  locale: Locale,
): Promise<Buffer> {
  const frame = await openPrototype(page);
  await setPrototypeLanguage(frame, locale);
  await selectPrototypeScreen(frame, state.referenceIndex);
  await setPrototypeLanguage(frame, locale);

  const surface = frame.locator('#hsm-phone-content');
  await expect(surface).toBeVisible();
  await assertCanonicalGeometry(frame);

  return surface.screenshot();
}

// ── Artifacts ───────────────────────────────────────────────────────────────

export function cellDir(root: string, state: Phase5State, locale: Locale): string {
  return join(root, state.slug, locale, String(CANONICAL_VIEWPORT.width));
}

export function writeArtifact(dir: string, name: string, bytes: Buffer | string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), bytes);
}

export interface DiffOutcome {
  readonly diffPixelRatio: number;
  readonly diff: Buffer;
  readonly comparable: boolean;
  readonly note: string | null;
}

/**
 * Measure the difference, and DRAW it.
 *
 * The ratio written to `metrics.json` is this number; the ledger recomputes it
 * from the two images independently and refuses the cell if the two disagree.
 * That is deliberate — a writer that could choose its own score would make the
 * threshold decorative — and it means there is no value in being clever here.
 */
export function diffImages(expected: Buffer, actual: Buffer): DiffOutcome {
  const a = PNG.sync.read(expected);
  const b = PNG.sync.read(actual);

  if (a.width !== b.width || a.height !== b.height) {
    // Still produce a diff of the right shape so the cell fails on the
    // geometry problem it actually has, rather than on a missing file.
    const out = new PNG({ width: a.width, height: a.height });
    return {
      diffPixelRatio: 1,
      diff: PNG.sync.write(out),
      comparable: false,
      note: `size mismatch: expected ${a.width}x${a.height}, actual ${b.width}x${b.height}`,
    };
  }

  const out = new PNG({ width: a.width, height: a.height });
  const changed = pixelmatch(a.data, b.data, out.data, a.width, a.height, { threshold: 0.1 });

  return {
    diffPixelRatio: changed / (a.width * a.height),
    diff: PNG.sync.write(out),
    comparable: true,
    note: null,
  };
}
