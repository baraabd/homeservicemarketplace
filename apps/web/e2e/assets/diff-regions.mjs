// Sprint 09B.29 — region breakdown for a reference/actual pair.
//
// Answers "where are the differing pixels", with numbers, so a residual is
// never dismissed as antialiasing without evidence. Uses a headless Chromium
// canvas rather than an image library, so it needs no extra dependency.
//
//   node e2e/assets/diff-regions.mjs <reference.png> <actual.png>
//
// BANDS
//
// The onboarding surface has a fixed vertical structure, transcribed from the
// prototype: a 64px topbar, the 4px progress rule under it, the content area,
// and — where a screen has one — the 79px sticky action bar (12 + 48 + 18 + a
// 1px top border). Reporting per band is what turns "0.09 of the image" into
// "the sticky bar is missing", which is a different piece of work from "the
// text sits two pixels low".
//
// CLASSIFICATION
//
// `textEdge` — a differing pixel with <= 2 differing neighbours. Glyph edges
// are thin, so antialiasing lands here and displaced blocks do not.
//
// `background` — a differing pixel whose REFERENCE side is one of the flat
// design fills (page background, surface white, sunken). A cluster of these is
// an element the implementation draws where the reference draws nothing, or
// the reverse; it is never a font-rendering artefact.

import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const [refPath, actPath] = process.argv.slice(2);
if (!refPath || !actPath) {
  console.error('usage: node diff-regions.mjs <reference.png> <actual.png>');
  process.exit(2);
}

/** The shell's fixed vertical structure. See the header. */
const BANDS = { headerEnd: 64, progressEnd: 68, stickyHeight: 79 };

/** The prototype's flat fills: --hsm-bg, --hsm-surface, --hsm-sunken. */
const FLAT_FILLS = [
  [248, 250, 252],
  [255, 255, 255],
  [241, 245, 249],
];

const browser = await chromium.launch();
const page = await browser.newPage();

const result = await page.evaluate(
  async ([a, b, bands, fills]) => {
    const load = (b64) =>
      new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = `data:image/png;base64,${b64}`;
      });
    const [ra, aa] = await Promise.all([load(a), load(b)]);
    const w = Math.min(ra.width, aa.width);
    const h = Math.min(ra.height, aa.height);
    const data = (img) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.getContext('2d').getImageData(0, 0, w, h).data;
    };
    const A = data(ra);
    const B = data(aa);

    const mask = new Uint8Array(w * h);
    let total = 0;
    let onFlatFill = 0;
    let minX = w,
      minY = h,
      maxX = -1,
      maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const d =
          Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
        if (d > 24) {
          mask[y * w + x] = 1;
          total++;
          // Was the REFERENCE side a flat design fill here?
          for (const [r, g, bl] of fills) {
            if (
              Math.abs(A[i] - r) <= 2 &&
              Math.abs(A[i + 1] - g) <= 2 &&
              Math.abs(A[i + 2] - bl) <= 2
            ) {
              onFlatFill++;
              break;
            }
          }
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const band = (y0, y1) => {
      let c = 0;
      for (let y = Math.max(0, y0); y < Math.min(y1, h); y++)
        for (let x = 0; x < w; x++) c += mask[y * w + x];
      return c;
    };

    /** Tight bounding box of the differing pixels inside one band. */
    const bandBox = (y0, y1) => {
      let x0 = w,
        x1 = -1,
        ya = h,
        yb = -1;
      for (let y = Math.max(0, y0); y < Math.min(y1, h); y++)
        for (let x = 0; x < w; x++) {
          if (!mask[y * w + x]) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < ya) ya = y;
          if (y > yb) yb = y;
        }
      return x1 < 0 ? null : { x0, x1, y0: ya, y1: yb };
    };

    // Isolated pixels (<=2 differing neighbours) are text edges; clustered ones
    // are displaced or missing elements.
    let isolated = 0;
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        if (!mask[y * w + x]) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (!(dx === 0 && dy === 0) && mask[(y + dy) * w + (x + dx)]) n++;
        if (n <= 2) isolated++;
      }

    const rows = [];
    for (let y = 0; y < h; y++) {
      let c = 0;
      for (let x = 0; x < w; x++) c += mask[y * w + x];
      if (c > 0) rows.push({ y, c });
    }
    rows.sort((p, q) => q.c - p.c);

    const stickyTop = h - bands.stickyHeight;
    return {
      dims: `${w}x${h}`,
      totalPixels: w * h,
      differingPixels: total,
      ratio: +(total / (w * h)).toFixed(5),
      boundingBox: total ? { x0: minX, x1: maxX, y0: minY, y1: maxY } : null,
      regions: {
        header: {
          y: `0-${bands.headerEnd}`,
          pixels: band(0, bands.headerEnd),
          box: bandBox(0, bands.headerEnd),
        },
        progress: {
          y: `${bands.headerEnd}-${bands.progressEnd}`,
          pixels: band(bands.headerEnd, bands.progressEnd),
          box: bandBox(bands.headerEnd, bands.progressEnd),
        },
        content: {
          y: `${bands.progressEnd}-${stickyTop}`,
          pixels: band(bands.progressEnd, stickyTop),
          box: bandBox(bands.progressEnd, stickyTop),
        },
        sticky: { y: `${stickyTop}-${h}`, pixels: band(stickyTop, h), box: bandBox(stickyTop, h) },
      },
      textEdgePixels: isolated,
      clusteredPixels: total - isolated,
      backgroundPixels: onFlatFill,
      worstRows: rows.slice(0, 12).map((r) => `y${r.y}:${r.c}`),
    };
  },
  [
    readFileSync(refPath).toString('base64'),
    readFileSync(actPath).toString('base64'),
    BANDS,
    FLAT_FILLS,
  ],
);

console.log(JSON.stringify(result, null, 2));
await browser.close();
