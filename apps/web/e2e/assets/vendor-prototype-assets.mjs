// Sprint 09B.29 — vendor the assets the visual gate needs, once, deterministically.
//
// WHY THIS EXISTS
//
// The approved prototype pulls its icon set from unpkg at runtime, and neither
// it nor the implementation can be compared pixel-for-pixel while one of them
// is fetching over the network. Worse, the two disagree about FONTS: the
// prototype declares `font-family: Inter` / `Cairo` but ships no `@font-face`,
// so on a machine without those fonts installed it silently renders in Arial —
// while the implementation loads the real families from Google Fonts. That is a
// glyph-level difference on every screen and it is an artefact of the harness,
// not a design deviation.
//
// The reference's own delivery README settles the intent: "Ensure Cairo and
// Inter are available for correct Arabic/English rendering." So both surfaces
// are served the SAME pinned font files, and the icon script is pinned to the
// exact version the prototype names.
//
// Run once:  node e2e/assets/vendor-prototype-assets.mjs
// Output:    e2e/assets/vendor/  + manifest.json (source, version, licence, sha256)
//
// The immutable reference files are never touched — interception happens at
// request time in the spec.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'vendor');
mkdirSync(OUT, { recursive: true });

/** A modern Chrome UA, so Google Fonts serves woff2 rather than ttf. The
 *  capture browser is Chromium, so this is the format it would really get. */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function fetchBuffer(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const manifest = [];

function record(entry) {
  manifest.push(entry);
  console.log(`  ${entry.file.padEnd(46)} ${entry.sha256.slice(0, 16)}…  ${entry.bytes} B`);
}

// ── 1. the prototype's pinned scripts ──────────────────────────────────────
//
// Exactly the versions `provider-onboarding-prototype.html` names. A different
// lucide version draws different icons, which is a silent baseline change.
const SCRIPTS = [
  {
    url: 'https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js',
    file: 'lucide-1.17.0.umd.js',
    licence: 'ISC (lucide)',
  },
  {
    url: 'https://unpkg.com/@floating-ui/core@1.7.3/dist/floating-ui.core.umd.min.js',
    file: 'floating-ui.core-1.7.3.umd.min.js',
    licence: 'MIT (@floating-ui/core)',
  },
  {
    url: 'https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js',
    file: 'floating-ui.dom-1.7.4.umd.min.js',
    licence: 'MIT (@floating-ui/dom)',
  },
];

console.log('scripts:');
for (const s of SCRIPTS) {
  const buf = await fetchBuffer(s.url);
  writeFileSync(join(OUT, s.file), buf);
  record({
    kind: 'script',
    source: s.url,
    file: s.file,
    licence: s.licence,
    bytes: buf.length,
    sha256: sha256(buf),
  });
}

// ── 2. Inter and Cairo, and the CSS that names them ────────────────────────
//
// The same request the application makes (`src/styles/fonts.css`), so the
// vendored copy is the one production actually uses.
const FONT_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Cairo:wght@300;400;500;600;700;800;900&display=swap';

console.log('fonts:');
const cssBuf = await fetchBuffer(FONT_CSS_URL);
let css = cssBuf.toString('utf8');

const fontUrls = [
  ...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1])),
];
console.log(`  ${fontUrls.length} font files referenced`);

for (const url of fontUrls) {
  // Deterministic local name derived from the remote path, so a re-run
  // produces identical filenames.
  const file = `font-${sha256(Buffer.from(url)).slice(0, 20)}.woff2`;
  const buf = await fetchBuffer(url);
  writeFileSync(join(OUT, file), buf);
  record({
    kind: 'font',
    source: url,
    file,
    licence: 'SIL Open Font License 1.1',
    bytes: buf.length,
    sha256: sha256(buf),
  });
}

// The stylesheet keeps its ORIGINAL fonts.gstatic.com URLs, deliberately.
//
// Rewriting them to a relative path was the first attempt and it cannot work:
// the prototype's markup lives in a `srcdoc` iframe, so a relative URL resolves
// against the parent document — a `file://` URL, which Playwright does not
// intercept — and the prototype's own CSP `font-src` does not list `file:`
// either. Both failures are silent: the face is registered, never fetched, and
// the capture quietly renders Arial.
//
// `https://fonts.gstatic.com` is already in that CSP allowlist and is reliably
// interceptable, so the URLs stay as they are and the manifest maps each one to
// its local copy.

writeFileSync(join(OUT, 'fonts.css'), css);
record({
  kind: 'stylesheet',
  source: FONT_CSS_URL,
  file: 'fonts.css',
  licence: 'SIL Open Font License 1.1 (font data)',
  bytes: Buffer.byteLength(css),
  sha256: sha256(Buffer.from(css)),
});

writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify({ generated: new Date().toISOString(), entries: manifest }, null, 2),
);

console.log(`\n${manifest.length} assets vendored into e2e/assets/vendor/`);
