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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'vendor');
mkdirSync(OUT, { recursive: true });

// ── integrity: what is already pinned ──────────────────────────────────────
//
// Every byte below arrives over the network from a third-party CDN, and this
// script's whole job is to put those bytes on disk. That is only safe while
// the bytes are the ones already reviewed and pinned.
//
// So a re-run is a VERIFICATION, not a refresh: the previous manifest's
// SHA-256 is the expected value, and a download that does not match it is
// never written. Without this, a compromised or silently-updated CDN would
// rewrite the visual baselines and the change would show up as an unexplained
// pixel diff rather than as the supply-chain event it is.
//
// Deliberately opt-IN to accept new bytes, so bumping a pinned version is an
// explicit act that shows up in review:
//
//   REVENDOR_ACCEPT_NEW_HASHES=1 node e2e/assets/vendor-prototype-assets.mjs
const MANIFEST_PATH = join(OUT, 'manifest.json');
const ACCEPT_NEW = process.env.REVENDOR_ACCEPT_NEW_HASHES === '1';

/** source URL -> pinned sha256, from the manifest already in the repository. */
const pinned = new Map();
if (existsSync(MANIFEST_PATH)) {
  try {
    for (const e of JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')).entries ?? []) {
      if (e?.source && e?.sha256) pinned.set(e.source, e.sha256);
    }
  } catch {
    // A manifest that will not parse pins nothing; the guard below then refuses
    // every write unless the operator has explicitly opted in.
  }
}

/**
 * Write downloaded bytes only if they match what is already pinned.
 *
 * Throws — rather than warning — because a mismatch means the vendored set and
 * the committed baselines no longer describe the same third-party code, and
 * continuing would silently replace both.
 */
function writeVerified(file, buf, source) {
  const digest = sha256(buf);
  const expected = pinned.get(source);

  if (expected && expected !== digest) {
    throw new Error(
      `integrity: ${source}\n  pinned   ${expected}\n  received ${digest}\n` +
        '  Refusing to overwrite. The upstream bytes changed under a pinned ' +
        'URL. Review the change, then re-run with REVENDOR_ACCEPT_NEW_HASHES=1.',
    );
  }
  if (!expected && !ACCEPT_NEW && pinned.size > 0) {
    throw new Error(
      `integrity: ${source} is not in the existing manifest.\n` +
        '  Re-run with REVENDOR_ACCEPT_NEW_HASHES=1 to pin it for the first time.',
    );
  }

  writeFileSync(join(OUT, file), buf);
  return digest;
}

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
  const digest = writeVerified(s.file, buf, s.url);
  record({
    kind: 'script',
    source: s.url,
    file: s.file,
    licence: s.licence,
    bytes: buf.length,
    sha256: digest,
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
  const digest = writeVerified(file, buf, url);
  record({
    kind: 'font',
    source: url,
    file,
    licence: 'SIL Open Font License 1.1',
    bytes: buf.length,
    sha256: digest,
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

const cssDigest = writeVerified('fonts.css', Buffer.from(css), FONT_CSS_URL);
record({
  kind: 'stylesheet',
  source: FONT_CSS_URL,
  file: 'fonts.css',
  licence: 'SIL Open Font License 1.1 (font data)',
  bytes: Buffer.byteLength(css),
  sha256: cssDigest,
});

writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify({ generated: new Date().toISOString(), entries: manifest }, null, 2),
);

console.log(`\n${manifest.length} assets vendored into e2e/assets/vendor/`);
