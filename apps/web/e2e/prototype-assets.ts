import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// These specs run as ES modules, so `__dirname` does not exist.
const HERE = dirname(fileURLToPath(import.meta.url));

// Sprint 09B.29 — the deterministic asset layer for the visual gate.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md
//
// WHAT PROBLEM THIS SOLVES
//
// Two, and they are different:
//
//  1. The approved prototype loads its ICON SET from unpkg at runtime. A
//     baseline captured with the network up and one captured without it differ
//     on every screen, and neither is wrong — which makes the gate meaningless.
//
//  2. The prototype and the implementation disagree about FONTS. The prototype
//     declares `font-family: Inter` / `Cairo` and ships no `@font-face`, so on
//     a machine without those families installed it renders in Arial. The
//     implementation loads the real families from Google Fonts. Comparing the
//     two would report a glyph-level difference on every screen that has
//     nothing to do with the design.
//
//     The reference's own delivery README settles it: "Ensure Cairo and Inter
//     are available for correct Arabic/English rendering." So both surfaces are
//     served the SAME pinned font files.
//
// Everything is served from `e2e/assets/vendor/`, pinned by version and
// recorded with a SHA-256 in `manifest.json`. Nothing reaches the network
// during a capture, and a missing asset FAILS rather than silently rendering a
// fallback glyph or a system font.
//
// The immutable reference file is never modified — interception happens at
// request time.

const VENDOR = join(HERE, 'assets', 'vendor');

interface ManifestEntry {
  kind: string;
  source: string;
  file: string;
  licence: string;
  bytes: number;
  sha256: string;
}

function manifest(): ManifestEntry[] {
  const p = join(VENDOR, 'manifest.json');
  if (!existsSync(p)) {
    throw new Error(
      `Vendored assets are missing (${p}). Run: node e2e/assets/vendor-prototype-assets.mjs`,
    );
  }
  return (JSON.parse(readFileSync(p, 'utf8')) as { entries: ManifestEntry[] }).entries;
}

/** Remote source URL -> local file, from the manifest. */
function bySource(): Map<string, ManifestEntry> {
  return new Map(manifest().map((e) => [e.source, e]));
}

const CONTENT_TYPE: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

function contentTypeFor(file: string): string {
  const ext = file.slice(file.lastIndexOf('.'));
  return CONTENT_TYPE[ext] ?? 'application/octet-stream';
}

/**
 * The host of a URL, or `''` if it will not parse.
 *
 * Route matching must compare the parsed hostname rather than search the raw
 * string: a host name appearing in a path or query is not the host, and
 * treating it as one lets an unexpected origin be served a vendored asset.
 */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Serve every external asset from the vendored set, and fail loudly on anything
 * that is not vendored.
 *
 * The failure mode this prevents is the quiet one: an un-intercepted icon
 * request that 404s leaves an empty `<i>` and a baseline that looks plausible
 * and is wrong. `missing` is returned so the caller can assert on it after the
 * page has settled.
 */
export async function serveVendoredAssets(page: Page): Promise<{ missing: string[] }> {
  const sources = bySource();
  const missing: string[] = [];

  const fulfilFromVendor = async (route: import('@playwright/test').Route, file: string) => {
    await route.fulfill({
      status: 200,
      contentType: contentTypeFor(file),
      body: readFileSync(join(VENDOR, file)),
      headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
    });
  };

  // The rewritten font URLs inside the vendored stylesheet.
  await page.route('**/__vendor__/**', async (route) => {
    const file = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    if (!existsSync(join(VENDOR, file))) {
      missing.push(route.request().url());
      await route.abort();
      return;
    }
    await fulfilFromVendor(route, file);
  });

  // Everything the prototype and the app fetch from a CDN.
  for (const pattern of [
    '**://unpkg.com/**',
    '**://fonts.googleapis.com/**',
    '**://fonts.gstatic.com/**',
  ]) {
    await page.route(pattern, async (route) => {
      const url = route.request().url();
      const entry =
        sources.get(url) ??
        // Google Fonts CSS is requested with varying query order; match on the
        // stylesheet kind rather than the exact string.
        //
        // Compared as a parsed HOSTNAME, not as a substring. `includes()` here
        // was a real defect, not a lint nicety: `https://evil.test/?x=
        // fonts.googleapis.com` contains the string, so any intercepted URL
        // could claim the vendored stylesheet by carrying the host name
        // anywhere in a path or query. Equality on `new URL().hostname` can
        // only be satisfied by the host itself.
        (hostnameOf(url) === 'fonts.googleapis.com'
          ? manifest().find((e) => e.kind === 'stylesheet')
          : undefined);

      if (!entry) {
        missing.push(url);
        await route.abort();
        return;
      }
      await fulfilFromVendor(route, entry.file);
    });
  }

  return { missing };
}

/**
 * Block the capture until the two families are genuinely usable.
 *
 * `document.fonts.ready` alone is not enough: it resolves once loading has
 * settled, including when a face FAILED. `check()` asks the question that
 * matters — can this family be rendered at this size — so a capture cannot
 * proceed on a silent Arial fallback.
 */
export async function assertFontsReady(
  target: Page | import('@playwright/test').Frame,
): Promise<void> {
  await target.evaluate(async () => {
    // `@font-face` REGISTERS a face; it does not fetch it. Nothing is fetched
    // until something is laid out in that family, so `check()` answers false
    // for a face that is merely declared — which is what "70 faces loaded, Inter
    // unusable" meant on the first run.
    //
    // Requesting the specific weights the two screens use forces the fetch, and
    // `fonts.ready` then waits for those requests rather than for nothing.
    await Promise.all(
      ['Inter', 'Cairo'].flatMap((family) =>
        ['400', '600', '700'].map((weight) =>
          (document as Document).fonts.load(`${weight} 16px ${family}`).catch(() => []),
        ),
      ),
    );
    await (document as Document).fonts.ready;
  });

  const available = await target.evaluate(() => ({
    inter: document.fonts.check('16px Inter'),
    cairo: document.fonts.check('16px Cairo'),
    count: document.fonts.size,
  }));

  expect(
    available.inter,
    `Inter is not usable for rendering (faces loaded: ${available.count}). The capture would silently fall back to Arial.`,
  ).toBe(true);
  expect(
    available.cairo,
    `Cairo is not usable for rendering (faces loaded: ${available.count}). The Arabic capture would silently fall back.`,
  ).toBe(true);
}

/** Inject the vendored font stylesheet into a document that has none.
 *
 *  The prototype names Inter and Cairo but ships no `@font-face`; on a machine
 *  without them installed it renders in Arial. This gives it the same faces the
 *  implementation uses, which is what its own delivery README asks for. It
 *  changes no file on disk. */
export async function injectVendoredFonts(
  target: Page | import('@playwright/test').Frame,
): Promise<void> {
  const css = readFileSync(join(VENDOR, 'fonts.css'), 'utf8');
  await target.evaluate((text) => {
    const style = document.createElement('style');
    style.setAttribute('data-vendored-fonts', 'true');
    style.textContent = text;
    document.head.appendChild(style);
  }, css);
}

/**
 * Neutralise the prototype wrapper's own body font-weight.
 *
 * The generic "visualize" scaffolding the prototype is wrapped in sets
 * `--font-weight-normal: 430` and applies it to `body`, so every paragraph in
 * the reference renders in a 430-weight Inter while the product renders 400.
 * The difference is a fraction of a pixel per glyph and it accumulates into
 * different LINE BREAKS, which is most of what the diff was reporting.
 *
 * It is safe to remove because the prototype file labels that whole block
 * "Internal implementation variables; not part of the agent contract" — it is
 * scaffolding, like the device bezel and the 1rem page gutter, and it is
 * excluded on the same grounds. The design's own weights (700 headings, 600
 * labels) are declared on the components themselves and are untouched.
 *
 * Applied to the reference only. Nothing on disk changes.
 */
export async function neutraliseHarnessFontWeight(
  target: import('@playwright/test').Frame,
): Promise<void> {
  await target.evaluate(() => {
    const style = document.createElement('style');
    style.setAttribute('data-harness-weight-reset', 'true');
    // Scoped to the elements that inherit it; anything with its own weight
    // (headings, labels, badges) keeps it.
    style.textContent = [
      // The wrapper's body weight — scaffolding, see above.
      '#hsm-provider-journey, #hsm-provider-journey p, #hsm-provider-journey span, #hsm-provider-journey small { font-weight: 400 }',
      // The device bezel's 28px radius clips the product surface's bottom
      // corners through `overflow: hidden`. The bezel is already excluded from
      // the capture (we screenshot the content, not the phone); this stops the
      // same bezel reaching INSIDE the capture and rounding its corners.
      '#hsm-provider-journey .hsm-phone { border-radius: 0 }',
    ].join(' ');
    document.head.appendChild(style);
  });
}

/** Kill every animation and transition, in whichever document is passed. */
export async function freezeMotion(target: Page | import('@playwright/test').Frame): Promise<void> {
  await target.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`;
    document.head.appendChild(style);
  });
}

/** The manifest, for the evidence record. */
export function vendoredAssetSummary(): string {
  return manifest()
    .map((e) => `${e.file} (${e.kind}, ${e.licence}) sha256=${e.sha256}`)
    .join('\n');
}
